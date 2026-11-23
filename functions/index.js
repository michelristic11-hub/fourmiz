/**
 * Fourmiz — serveur (Firebase Cloud Functions, 2e génération).
 *
 *  - tick  : toutes les minutes, rattrape le temps écoulé (production, combats, IA, saisons).
 *            S'il n'y a aucun joueur depuis online.idleMinutes, il ne fait rien (le serveur dort : presque gratuit).
 *  - order : à chaque ordre envoyé par un joueur, rattrape le temps puis valide et applique l'ordre.
 *
 * Autres chemins : games/<id>/presence/<uid> (signal « je suis là » des navigateurs, écrit directement),
 * users/<uid>/unlocks (combattants débloqués, gardés d'une colonie à l'autre).
 *
 * Le monde avance en continu (un tick toutes les 2 s) : il n'y a pas de tours.
 *
 * Tout l'état du monde est dans la Realtime Database, sous games/<gameId>/state.
 * Les deux fonctions le modifient par transaction, donc jamais en même temps.
 */
'use strict';
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onValueCreated } = require('firebase-functions/v2/database');
const { setGlobalOptions, logger } = require('firebase-functions/v2');
const admin = require('firebase-admin');
const CONFIG = require('./shared/sim.js').onlineConfig(require('./shared/config.js'));
const GARDEN = require('./shared/garden.js');
const ENGINE = require('./engine.js');

/** Doit être la région de ta Realtime Database (us-central1 par défaut). */
const REGION = 'us-central1';

setGlobalOptions({ region: REGION, memory: '1GiB', cpu: 1, maxInstances: 3 });
admin.initializeApp();

const worlds = {};
/** La carte « jardin » d'une graine, recalculée une fois par instance (quelques millisecondes). */
function getWorld(seed) {
  if (seed == null) seed = CONFIG.online.mapSeed;
  if (!worlds[seed]) worlds[seed] = GARDEN.buildGarden(seed, CONFIG);
  return worlds[seed];
}
/** Carte à utiliser pour un état : la sienne, ou celle du réglage si le monde doit être recréé. */
function worldOf(state) {
  const ok = state && (state.worldVersion || 1) === CONFIG.online.worldVersion && state.mapSeed != null;
  return getWorld(ok ? state.mapSeed : CONFIG.online.mapSeed);
}

/** Enregistre sur le compte des joueurs les combattants qu'ils viennent de débloquer. */
async function saveUnlocks(state) {
  const ev = state && state.unlockEvents ? Object.values(state.unlockEvents) : [];
  await Promise.all(ev.filter((e) => e && e.uid && e.key).map((e) =>
    admin.database().ref(`users/${e.uid}/unlocks/${e.key}`).set(true)));
}

const statePath = (gameId) => `games/${gameId}/state`;

/**
 * Transaction sur l'état du monde, avec repli : si Firebase n'arrive pas à la valider (maxretry…),
 * on relit l'état et on l'écrit directement. update(cur) renvoie le nouvel état, ou undefined pour ne rien écrire.
 */
async function updateState(ref, update) {
  const wrapped = (cur) => {
    const out = update(cur);
    if (out) {
      const bad = ENGINE.clean(out);
      if (bad) logger.warn(`${bad} valeur(s) invalide(s) remise(s) à 0 dans l'état`);
    }
    return out;
  };
  try {
    const res = await ref.transaction(wrapped);
    return res.snapshot.val();
  } catch (e) {
    logger.warn(`Transaction échouée (${e.message}) : écriture directe.`);
    const snap = await ref.once('value');
    const out = wrapped(snap.val());
    if (out === undefined) return snap.val();
    await ref.set(out);
    return out;
  }
}

exports.tick = onSchedule({ schedule: 'every 1 minutes', timeoutSeconds: 120, maxInstances: 1 }, async () => {
  const gid = CONFIG.online.gameId;
  const now = Date.now();
  const presence = (await admin.database().ref(`games/${gid}/presence`).once('value')).val() || {};
  if (ENGINE.isIdle(presence, CONFIG, now)) return; // personne : le monde attend (il rattrapera au plus quelques minutes)
  const s = await updateState(admin.database().ref(statePath(gid)), (cur) => ENGINE.runTick(cur, worldOf(cur), CONFIG, now, presence));
  await saveUnlocks(s);
  if (s) logger.info(`Ère ${s.era} · tick ${s.tick} · ${s.colonies ? Object.keys(s.colonies).length : 0} colonies`);
});

exports.order = onValueCreated({ ref: '/games/{gameId}/orders/{orderId}' }, async (event) => {
  const order = event.data.val();
  const { gameId, orderId } = event.params;
  const db = admin.database();
  await event.data.ref.remove();
  if (gameId !== CONFIG.online.gameId || !order || !order.uid) return;

  // Les combattants débloqués viennent du compte du joueur, jamais du navigateur
  delete order.unlocks;
  if (order.type === 'join') order.unlocks = (await db.ref(`users/${order.uid}/unlocks`).once('value')).val() || {};
  const now = Date.now();
  let result = { ok: false, reason: 'Ordre non traité.' };
  const after = await updateState(db.ref(statePath(gameId)), (cur) => {
    // Premier passage : le cache local est vide, Firebase rappelle avec la vraie valeur.
    if (order.type === 'admin') {
      if (cur === null && order.action !== 'reset' && order.action !== 'newmap') {
        result = { ok: false, reason: 'Aucun monde en cours.' };
        return null; // premier passage à vide : Firebase rappelle avec la vraie valeur
      }
      const out = ENGINE.runAdmin(cur, getWorld, CONFIG, order, now);
      result = out.result;
      return out.result.ok ? out.state : undefined;
    }
    if (cur === null) {
      result = { ok: false, reason: 'Le monde est en cours de création, réessaie dans une minute.' };
      return null;
    }
    const out = ENGINE.runOrder(cur, worldOf(cur), CONFIG, order, now);
    result = out.result;
    return out.result.ok ? out.state : undefined; // undefined = ordre refusé, rien n'est écrit
  });
  await saveUnlocks(after);
  await db.ref(`games/${gameId}/results/${order.uid}`).set({
    orderId,
    type: String(order.type || ''),
    ok: result.ok,
    reason: result.reason || null,
    at: admin.database.ServerValue.TIMESTAMP,
  });
});
