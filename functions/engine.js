/**
 * Fourmiz — moteur serveur : fonctions pures appelées par les Cloud Functions.
 * Séparées de index.js pour pouvoir les tester sans Firebase.
 */
'use strict';
const SIM = require('./shared/sim.js');
const AI = require('./shared/ai.js');

/**
 * Fait avancer le monde (appelé chaque minute). Crée le monde s'il n'existe pas,
 * et en recrée un nouveau quelque temps après une victoire.
 * @param {object|null} state  état actuel (ou null)
 * @param {number} now         horodatage en ms
 */
function runTick(state, world, cfg, now) {
  const on = cfg.online;
  if (!state || state.landCount !== world.ids.length) {
    const fresh = SIM.createWorldState(world, cfg, { aiCount: on.aiCount, era: state ? (state.era || 0) + 1 : 1 });
    fresh.lastTickAt = now;
    return fresh;
  }
  SIM.hydrate(state);
  if (state.phase === 'over') {
    if (!state.overAt) state.overAt = now;
    if (now - state.overAt >= on.resetAfterTicks * on.tickSeconds * 1000) {
      const fresh = SIM.createWorldState(world, cfg, { aiCount: on.aiCount, era: (state.era || 1) + 1 });
      fresh.lastTickAt = now;
      return fresh;
    }
    state.lastTickAt = now;
    return state;
  }
  for (let i = 0; i < on.ticksPerRun && state.phase === 'playing'; i++) {
    SIM.step(state, world, cfg);
    AI.thinkAll(state, world, cfg, SIM);
  }
  if (state.phase === 'over') state.overAt = now;
  state.lastTickAt = now;
  return state;
}

/**
 * Applique l'ordre d'un joueur à l'état.
 * @returns {{state:object|null, result:{ok:boolean, reason?:string}}}
 */
function runOrder(state, world, cfg, order) {
  if (!state) return { state, result: { ok: false, reason: 'Le monde est en cours de création, réessaie dans une minute.' } };
  SIM.hydrate(state);
  const result = SIM.applyOrder(state, world, cfg, order);
  return { state, result: { ok: !!result.ok, reason: result.reason || null } };
}

module.exports = { runTick, runOrder };
