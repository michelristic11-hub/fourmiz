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
  return SIM.createWorldState(world, cfg, { aiCount: cfg.online.aiCount, era, now });
}

/**
 * Appelé chaque minute : crée le monde s'il n'existe pas, le fait avancer,
 * et en recrée un nouveau quelque temps après une victoire.
 */
function runTick(state, world, cfg, now) {
  if (!state || state.landCount !== world.ids.length) return freshWorld(world, cfg, now, state ? (state.era || 0) + 1 : 1);
  advance(state, world, cfg, now);
  if (state.phase === 'over' && now - state.overAt >= cfg.online.resetAfterMinutes * 60000) {
    return freshWorld(world, cfg, now, (state.era || 1) + 1);
  }
  return state;
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

module.exports = { runTick, runOrder, advance };
