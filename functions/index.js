/**
 * Fourmiz — serveur (Firebase Cloud Functions, 2e génération).
 *
 *  - tick  : toutes les minutes, rattrape le temps écoulé (production, combats, IA, saisons).
 *  - order : à chaque ordre envoyé par un joueur, rattrape le temps puis valide et applique l'ordre.
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
const h3 = require('h3-js');
const topojson = require('topojson-client');
const land = require('world-atlas/land-110m.json');
const CONFIG = require('./shared/sim.js').onlineConfig(require('./shared/config.js'));
const WORLD = require('./shared/world.js');
const ENGINE = require('./engine.js');

/** Doit être la région de ta Realtime Database (us-central1 par défaut). */
const REGION = 'us-central1';

setGlobalOptions({ region: REGION, memory: '1GiB', cpu: 1, maxInstances: 3 });
admin.initializeApp();

let world = null;
/** Le monde (grille H3 + biomes) est construit une fois par instance, au démarrage. */
function getWorld() {
  if (!world) world = WORLD.buildWorld(h3, topojson.feature(land, land.objects.land), CONFIG);
  return world;
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
  const w = getWorld();
  const now = Date.now();
  const s = await updateState(admin.database().ref(statePath(CONFIG.online.gameId)), (cur) => ENGINE.runTick(cur, w, CONFIG, now));
  if (s) logger.info(`Ère ${s.era} · tick ${s.tick} · ${s.colonies ? Object.keys(s.colonies).length : 0} colonies`);
});

exports.order = onValueCreated({ ref: '/games/{gameId}/orders/{orderId}' }, async (event) => {
  const order = event.data.val();
  const { gameId, orderId } = event.params;
  const db = admin.database();
  await event.data.ref.remove();
  if (gameId !== CONFIG.online.gameId || !order || !order.uid) return;

  const w = getWorld();
  const now = Date.now();
  let result = { ok: false, reason: 'Ordre non traité.' };
  await updateState(db.ref(statePath(gameId)), (cur) => {
    // Premier passage : le cache local est vide, Firebase rappelle avec la vraie valeur.
    if (cur === null) {
      result = { ok: false, reason: 'Le monde est en cours de création, réessaie dans une minute.' };
      return null;
    }
    const out = ENGINE.runOrder(cur, w, CONFIG, order, now);
    result = out.result;
    return out.result.ok ? out.state : undefined; // undefined = ordre refusé, rien n'est écrit
  });
  await db.ref(`games/${gameId}/results/${order.uid}`).set({
    orderId,
    type: String(order.type || ''),
    ok: result.ok,
    reason: result.reason || null,
    at: admin.database.ServerValue.TIMESTAMP,
  });
});
