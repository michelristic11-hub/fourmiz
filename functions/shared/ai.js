/**
 * Fourmiz — colonies rivales contrôlées par l'ordinateur.
 * Comportement simple : s'étendre vers les cases rentables et faibles,
 * acheminer les renforts de l'intérieur vers la frontière, gérer la ponte.
 */
(function (root) {
  'use strict';

  /** Fait réfléchir toutes les IA (à appeler après SIM.step). */
  function thinkAll(state, world, cfg, SIM) {
    if (state.phase !== 'playing' || state.tick % cfg.ai.thinkEvery !== 0) return;
    const owned = {};
    for (const id in state.cells) {
      const c = state.cells[id];
      if (c.owner > 0) (owned[c.owner] = owned[c.owner] || []).push(id);
    }
    const incoming = {};
    for (const m of state.moves) incoming[m.owner + ':' + m.to] = true;
    for (const col of state.colonies) {
      if (col.isAI && col.alive) think(state, world, cfg, SIM, col, owned[col.id] || [], incoming);
    }
  }

  function think(state, world, cfg, SIM, col, cells, incoming) {
    const s = col.stats;
    // Ponte
    if (col.food < 15 && s.net < 0) col.layMode = 'stop';
    else if (col.food > s.cap * 0.6) col.layMode = 'intense';
    else col.layMode = 'normal';

    // Reine morte : en élever une nouvelle si possible
    if (!col.queenAlive) {
      const best = cells.slice().sort((a, b) => state.cells[b].ants - state.cells[a].ants)[0];
      if (best) SIM.raiseQueen(state, world, cfg, col.id, best);
    }

    const keep = cfg.ai.keepHome;
    for (const id of cells) {
      const c = state.cells[id];
      if (!c || c.owner !== col.id) continue;
      const reserve = id === col.nest ? keep * 3 : keep;
      let avail = c.ants - reserve;
      if (avail < 2) continue;

      const nbs = world.neighbors(id);
      let best = null;
      let bestScore = 0;
      let frontier = false;
      for (const nb of nbs) {
        const t = SIM.getCell(state, world, cfg, nb);
        if (t.owner === col.id) continue;
        frontier = true;
        if (incoming[col.id + ':' + nb]) continue;
        const need = SIM.forceNeeded(state, world, cfg, nb);
        const send = Math.ceil(need * cfg.ai.attackMargin);
        if (send > avail) continue;
        let value = cfg.biomes[world.cells[nb].biome].food + 0.3;
        if (t.owner >= 0) {
          const enemy = state.colonies[t.owner];
          value += enemy.nest === nb && enemy.queenAlive ? 3 : 0.5;
        }
        const score = value / (send + 1);
        if (score > bestScore) { bestScore = score; best = { to: nb, send }; }
      }
      if (best) {
        const r = SIM.sendAnts(state, world, cfg, col.id, id, best.to, best.send);
        if (r.ok) incoming[col.id + ':' + best.to] = true;
        continue;
      }
      if (!frontier && avail >= 4) {
        // Case intérieure : acheminer les fourmiz vers la frontière
        const ownNbs = nbs.filter((nb) => state.cells[nb] && state.cells[nb].owner === col.id);
        let target = null;
        for (const nb of ownNbs) {
          const isFrontier = world.neighbors(nb).some((x) => !state.cells[x] || state.cells[x].owner !== col.id);
          if (isFrontier) { target = nb; break; }
        }
        if (!target && ownNbs.length) target = ownNbs[Math.floor(SIM.rand(state) * ownNbs.length)];
        if (target) SIM.sendAnts(state, world, cfg, col.id, id, target, avail);
      }
    }
  }

  const AI = { thinkAll };
  if (typeof module !== 'undefined' && module.exports) module.exports = AI;
  else (root.FZ = root.FZ || {}).AI = AI;
})(typeof window !== 'undefined' ? window : globalThis);
