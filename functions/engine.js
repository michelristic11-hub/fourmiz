/**
 * Fourmiz — moteur serveur : fonctions pures appelées par les Cloud Functions.
 * Séparées de index.js pour pouvoir les tester sans Firebase.
 *
 * Il n'y a pas de tours : le monde avance en continu. Le tick courant se déduit de l'heure
 * (state.startedAt + tick × durée d'un tick). À chaque appel (toutes les minutes, ou à chaque
 * ordre d'un joueur), le serveur « rattrape » le temps écoulé avant d'agir.
 */
'use strict';
const SIM = require('./shared/sim.js');
const AI = require('./shared/ai.js');

/**
 * Fait avancer le monde jusqu'à l'instant « now » (ms).
 * @returns {object} l'état, modifié sur place
 */
function advance(state, world, cfg, now) {
  SIM.hydrate(state);
  const ms = SIM.tickMs(cfg);
  if (!state.startedAt) {
    // Monde créé par une ancienne version (tours d'une minute) : on le raccroche au temps continu.
    state.startedAt = (state.lastTickAt || now) - state.tick * ms;
  }
  delete state.lastTickAt;
  if (state.tickMs !== ms) {
    // La durée d'un tick a changé (réglage modifié) : on garde le tick actuel, à partir de maintenant.
    if (state.tickMs) state.startedAt = now - state.tick * ms;
    state.tickMs = ms;
  }
  if (state.phase !== 'playing') {
    if (!state.overAt) state.overAt = now;
    return state;
  }
  let target = SIM.tickAt(state, cfg, now);
  const max = cfg.online.maxCatchUpTicks;
  if (target - state.tick > max) {
    // Trop de retard (serveur arrêté longtemps) : on saute le surplus de temps.
    state.startedAt += (target - state.tick - max) * ms;
    target = state.tick + max;
  }
  while (state.tick < target && state.phase === 'playing') {
    SIM.step(state, world, cfg);
    AI.thinkAll(state, world, cfg, SIM);
  }
  if (state.phase === 'over' && !state.overAt) state.overAt = now;
  return state;
}

function freshWorld(world, cfg, now, era) {
  const s = SIM.createWorldState(world, cfg, { aiCount: cfg.online.aiCount, era, now, mapSeed: world.seed });
  s.tickMs = SIM.tickMs(cfg);
  return s;
}

/**
 * Appelé chaque minute : crée le monde s'il n'existe pas (ou si la carte a changé), puis le fait avancer.
 * Le monde est permanent : il n'y a plus de fin de partie.
 */
function runTick(state, world, cfg, now, presence) {
  if (!state || state.landCount !== world.ids.length || (state.worldVersion || 1) !== cfg.online.worldVersion ||
      (world.seed != null && state.mapSeed !== world.seed)) {
    return freshWorld(world, cfg, now, state ? (state.era || 0) + 1 : 1);
  }
  applyPresence(state, cfg, presence);
  advance(state, world, cfg, now);
  applyPresence(state, cfg, presence);
  return state;
}

/**
 * Présence des joueurs (games/<id>/presence/<uid> = heure du dernier signal du navigateur) :
 * la colonie est « vue » à ce moment-là, ce qui garde son bouclier d'absence éteint.
 */
function applyPresence(state, cfg, presence) {
  if (!presence || !state || !state.startedAt) return;
  SIM.hydrate(state);
  for (const col of state.colonies) {
    if (!col.alive || col.isAI || !col.uid) continue;
    const ts = presence[col.uid];
    if (typeof ts !== 'number') continue;
    const t = Math.min(state.tick, SIM.tickAt(state, cfg, ts));
    if (col.lastSeenTick == null || t > col.lastSeenTick) col.lastSeenTick = t;
  }
}

/** Le serveur peut-il dormir ? Oui si aucun joueur n'a donné signe de vie depuis online.idleMinutes. */
function isIdle(presence, cfg, now) {
  let last = 0;
  for (const uid in presence || {}) if (typeof presence[uid] === 'number' && presence[uid] > last) last = presence[uid];
  return now - last > cfg.online.idleMinutes * 60000;
}

/**
 * Applique l'ordre d'un joueur, après avoir rattrapé le temps écoulé.
 * @returns {{state:object|null, result:{ok:boolean, reason?:string}}}
 */
function runOrder(state, world, cfg, order, now) {
  if (!state) return { state, result: { ok: false, reason: 'Le monde est en cours de création, réessaie dans une minute.' } };
  advance(state, world, cfg, now == null ? Date.now() : now);
  const result = SIM.applyOrder(state, world, cfg, order);
  return { state, result: { ok: !!result.ok, reason: result.reason || null } };
}

/**
 * Nettoie l'état avant écriture dans Firebase : arrondit les nombres à virgule (6 décimales)
 * et remplace NaN/Infini par 0. Firebase refuse NaN, et des flottants comme 4.4e-16 font échouer
 * les transactions (« maxretry »).
 * @returns {number} nombre de valeurs invalides corrigées
 */
function clean(x) {
  let bad = 0;
  (function walk(o) {
    for (const k in o) {
      const v = o[k];
      if (typeof v === 'number') {
        if (!Number.isFinite(v)) { o[k] = 0; bad++; }
        else if (!Number.isInteger(v)) o[k] = Math.round(v * 1e6) / 1e6;
      } else if (v && typeof v === 'object') walk(v);
    }
  })(x);
  return bad;
}

module.exports = { clean, runTick, runOrder, advance, applyPresence, isIdle };
