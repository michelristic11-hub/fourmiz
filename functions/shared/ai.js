/**
 * Fourmiz — colonies rivales contrôlées par l'ordinateur.
 * Comportement simple mais complet : garder les ouvrières utiles sur chaque case, attaquer avec
 * les soldates et le surplus vers les cases rentables et faibles, acheminer les renforts de
 * l'intérieur vers la frontière, gérer la ponte, les castes et les évolutions.
 */
(function (root) {
  'use strict';

  const EVO_ORDER = ['harvest', 'fertility', 'jaws', 'granary', 'trails', 'shell', 'tunnels', 'fungus', 'acid'];

  /** Fait réfléchir toutes les IA (à appeler après SIM.step). */
  function thinkAll(state, world, cfg, SIM) {
    if (state.phase !== 'playing' || state.tick % cfg.ai.thinkEvery !== 0) return;
    const owned = {};
    for (const id in state.cells) {
      const c = state.cells[id];
      if (c.owner >= 0 && state.colonies[c.owner].isAI) (owned[c.owner] = owned[c.owner] || []).push(id);
    }
    const incoming = {};
    for (const m of state.moves) incoming[m.owner + ':' + m.to] = true;
    for (const col of state.colonies) {
      if (col.isAI && col.alive) think(state, world, cfg, SIM, col, owned[col.id] || [], incoming);
    }
  }

  function think(state, world, cfg, SIM, col, cells, incoming) {
    const s = col.stats;
    // Ponte et castes
    if (col.food < 20 && s.net < 0) col.layMode = 'stop';
    else if (col.food > s.cap * 0.6) col.layMode = 'intense';
    else col.layMode = 'normal';
    col.caste = s.w < s.territories * 6 ? 'harvest' : 'balanced';

    // Évolutions : la moins chère de la liste dès qu'on a de la marge
    if (state.tick % (cfg.ai.thinkEvery * 20) === 0) {
      let best = null, bestCost = Infinity;
      for (const k of EVO_ORDER) {
        const cost = SIM.evoCost(cfg, col, k);
        if (cost != null && cost < bestCost) { best = k; bestCost = cost; }
      }
      if (best && col.food > bestCost * 1.5) SIM.evolve(state, cfg, col.id, best);
    }

    const keep = cfg.ai.keepHome;
    for (const id of cells) {
      const c = state.cells[id];
      if (!c || c.owner !== col.id) continue;
      // Fourmiz disponibles : on garde les ouvrières utiles et une petite garde
      const opt = SIM.optimalWorkers(world, cfg, id);
      const guard = id === col.nest ? keep * 3 : keep;
      const avail = { w: Math.max(0, c.w - opt), s: Math.max(0, c.s - Math.ceil(guard / 3)), e: c.e, b: id === col.nest ? 0 : (c.b || 0) };
      const availPow = SIM.power(avail, cfg, col);
      if (availPow < 2) continue;

      const nbs = world.neighbors(id);
      let best = null;
      let bestScore = 0;
      let frontier = false;
      for (const nb of nbs) {
        const t = SIM.getCell(state, world, cfg, nb);
        if (t.owner === col.id) continue;
        frontier = true;
        if (incoming[col.id + ':' + nb]) continue;
        const foe = t.owner >= 0 ? state.colonies[t.owner] : null;
        const human = foe && !foe.isAI;
        // Les débutants humains sont protégés un moment, puis l'IA ne les attaque qu'avec une grosse marge.
        if (human && state.tick - (foe.bornTick || 0) < (cfg.ai.humanProtectTicks || 0)) continue;
        const margin = human ? (cfg.ai.humanMargin || cfg.ai.attackMargin) : cfg.ai.attackMargin;
        const prev = SIM.attackPreview(state, world, cfg, col.id, [id, nb], avail);
        if (prev.attack < prev.defense * margin) continue;
        // On n'envoie que la part nécessaire (avec marge)
        const share = Math.min(1, (prev.defense * margin) / Math.max(0.01, prev.attack) + 0.05);
        let value = cfg.biomes[world.cells[nb].biome].food + 0.3;
        const tr = SIM.treasureAt(world, nb);
        if (tr) value += 3 + cfg.treasures.types[tr].points * 40;
        if (t.owner >= 0) {
          const enemy = state.colonies[t.owner];
          value += enemy.nest === nb && enemy.queenAlive ? 3 : 0.5;
        }
        const score = value / (prev.defense + 1);
        if (score > bestScore) { bestScore = score; best = { to: nb, g: SIM.scaleGroup(avail, share, true) }; }
      }
      if (best) {
        const r = SIM.sendAnts(state, world, cfg, col.id, id, best.to, best.g);
        if (r.ok) incoming[col.id + ':' + best.to] = true;
        continue;
      }
      if (!frontier && SIM.total(avail) >= 4) {
        // Case intérieure : acheminer le surplus vers la frontière par les galeries
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
