/**
 * Fourmiz — génération de la carte « jardin » : une grille hexagonale à l'échelle des fourmiz.
 *
 * Terrains (herbe, mousse, fleurs, litière de feuilles, terre, sable, racines) et obstacles
 * infranchissables (flaques, cailloux). Toutes les cases franchissables sont reliées entre elles :
 * aucune zone isolée. Des trésors (sucre, pomme, miettes, scarabée géant) sont posés sur la carte.
 *
 * La carte ne dépend que d'une graine (seed) : le serveur et les navigateurs la recalculent
 * à l'identique, sans rien télécharger.
 *
 * Interface « world » fournie à la simulation (voir sim.js) :
 *   ids, cells[id] = { id, col, row, x, y, lat, biome }, neighbors(id), distance(a, b),
 *   plus : seed, width, height, obstacles [{ col, row, x, y, kind }], treasures { id: type }.
 * Coordonnées x, y : centre de la case, en rayons d'hexagone (hexagones « pointe en haut »).
 */
(function (root) {
  'use strict';

  const SQ3 = Math.sqrt(3);

  function mulberry(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** Bruit de valeur lissé (plusieurs octaves), valeurs dans [0, 1]. */
  function noiseField(rnd, w, h, scale, octaves) {
    const layers = [];
    for (let o = 0; o < octaves; o++) {
      const s = scale / Math.pow(2, o);
      const gw = Math.ceil(w / s) + 2, gh = Math.ceil(h / s) + 2;
      const g = [];
      for (let i = 0; i < gw * gh; i++) g.push(rnd());
      layers.push({ s, gw, g });
    }
    const smooth = (t) => t * t * (3 - 2 * t);
    return function (x, y) {
      let v = 0, amp = 1, sum = 0;
      for (const L of layers) {
        const fx = x / L.s, fy = y / L.s;
        const ix = Math.floor(fx), iy = Math.floor(fy);
        const tx = smooth(fx - ix), ty = smooth(fy - iy);
        const at = (a, b) => L.g[b * L.gw + a];
        const top = at(ix, iy) * (1 - tx) + at(ix + 1, iy) * tx;
        const bot = at(ix, iy + 1) * (1 - tx) + at(ix + 1, iy + 1) * tx;
        v += (top * (1 - ty) + bot * ty) * amp;
        sum += amp;
        amp *= 0.5;
      }
      return v / sum;
    };
  }

  const key = (c, r) => c + '_' + r;
  const center = (c, r) => ({ x: SQ3 * (c + 0.5 * (r & 1)), y: 1.5 * r });

  // Voisins en coordonnées « odd-r » (lignes impaires décalées vers la droite)
  const DIRS = [
    [[1, 0], [0, -1], [-1, -1], [-1, 0], [-1, 1], [0, 1]],
    [[1, 0], [1, -1], [0, -1], [-1, 0], [0, 1], [1, 1]],
  ];
  function toCube(c, r) {
    const q = c - (r - (r & 1)) / 2;
    return { q, r, s: -q - r };
  }

  /**
   * Construit le jardin.
   * @param {number} seed
   * @param {object} cfg FZ.CONFIG (cfg.map, cfg.biomes, cfg.treasures)
   */
  function buildGarden(seed, cfg) {
    const M = cfg.map;
    const W = M.width, H = M.height;
    const rnd = mulberry(seed || 1);
    const wet = noiseField(rnd, W, H, 9, 3);
    const stone = noiseField(rnd, W, H, 6, 2);
    const bloom = noiseField(rnd, W, H, 5, 2);
    const litter = noiseField(rnd, W, H, 7, 2);

    // Seuils en quantiles : chaque carte a la même proportion de flaques, cailloux, fleurs…
    const q = (f, share) => {
      const v = [];
      for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) v.push(f(c, r));
      v.sort((x, y) => x - y);
      return (p) => v[Math.min(v.length - 1, Math.floor(p * v.length))];
    };
    const qWet = q(wet), qStone = q(stone), qBloom = q(bloom), qLitter = q(litter);
    const T = {
      water: qWet(1 - M.waterShare), moss: qWet(1 - M.waterShare - 0.1), sand: qWet(0.16), dirt: qWet(0.3),
      rock: qStone(1 - M.rockShare), roots: qStone(1 - M.rockShare - 0.07),
      flowers: qBloom(0.85), leaves: qLitter(0.85),
    };
    const kind = {}; // id -> biome, ou 'water' / 'rock'
    for (let r = 0; r < H; r++) {
      for (let c = 0; c < W; c++) {
        const p = center(c, r);
        const m = wet(c, r), st = stone(c, r), fl = bloom(c, r), li = litter(c, r);
        const edge = Math.min(c, r, W - 1 - c, H - 1 - r);
        let k;
        if (m > T.water) k = 'water';
        else if (st > T.rock || (edge === 0 && rnd() < 0.35)) k = 'rock';
        else if (st > T.roots) k = 'roots';
        else if (m > T.moss) k = 'moss';
        else if (m < T.sand) k = 'sand';
        else if (fl > T.flowers) k = 'flowers';
        else if (li > T.leaves) k = 'leaves';
        else if (m < T.dirt) k = 'dirt';
        else k = 'grass';
        kind[key(c, r)] = { k, c, r, x: p.x, y: p.y };
      }
    }

    const passable = (id) => kind[id] && kind[id].k !== 'water' && kind[id].k !== 'rock';
    const rawNeighbors = (c, r) => DIRS[r & 1].map(([dc, dr]) => [c + dc, r + dr])
      .filter(([a, b]) => a >= 0 && b >= 0 && a < W && b < H).map(([a, b]) => key(a, b));

    // Une seule zone franchissable : les zones séparées par des flaques ou des cailloux sont reliées
    // au reste par des ponts de feuilles mortes ; seules les toutes petites poches deviennent des cailloux.
    function components() {
      const comp = {}, sizes = [];
      let n = 0;
      for (const id in kind) {
        if (!passable(id) || comp[id] !== undefined) continue;
        const q = [id];
        comp[id] = n;
        for (let i = 0; i < q.length; i++) {
          const { c, r } = kind[q[i]];
          for (const nb of rawNeighbors(c, r)) if (passable(nb) && comp[nb] === undefined) { comp[nb] = n; q.push(nb); }
        }
        sizes.push(q.length);
        n++;
      }
      return { comp, sizes };
    }
    let { comp, sizes } = components();
    const main = sizes.indexOf(Math.max.apply(null, sizes));
    // Parcours 0-1 depuis la zone principale : traverser un obstacle coûte 1.
    const dist = {}, prev = {};
    const dq = [];
    for (const id in kind) if (comp[id] === main) { dist[id] = 0; dq.push(id); }
    for (let head = 0; head < dq.length; head++) {
      // file simple + relâchement : suffisant ici (petite grille)
      const id = dq[head];
      const { c, r } = kind[id];
      for (const nb of rawNeighbors(c, r)) {
        const d = dist[id] + (passable(nb) ? 0 : 1);
        if (dist[nb] === undefined || d < dist[nb]) { dist[nb] = d; prev[nb] = id; dq.push(nb); }
      }
    }
    for (let k = 0; k < sizes.length; k++) {
      if (k === main || sizes[k] < 6) continue;
      let start = null;
      for (const id in comp) if (comp[id] === k && (start === null || dist[id] < dist[start])) start = id;
      for (let x = start; x && comp[x] !== main; x = prev[x]) if (!passable(x)) kind[x].k = 'leaves';
    }
    comp = components().comp;
    let bestN = -1, bestSize = 0;
    const count = {};
    for (const id in comp) count[comp[id]] = (count[comp[id]] || 0) + 1;
    for (const k in count) if (count[k] > bestSize) { bestSize = count[k]; bestN = Number(k); }

    const cells = {};
    const ids = [];
    const obstacles = [];
    for (const id in kind) {
      const K = kind[id];
      if (passable(id) && comp[id] === bestN) {
        cells[id] = { id, col: K.c, row: K.r, x: K.x, y: K.y, lat: 45, biome: K.k };
        ids.push(id);
      } else {
        obstacles.push({ col: K.c, row: K.r, x: K.x, y: K.y, kind: K.k === 'water' ? 'water' : 'rock' });
      }
    }
    ids.sort();

    const nbCache = {};
    const world = {
      seed: seed >>> 0, width: W, height: H, ids, cells, obstacles, treasures: {},
      size: { w: SQ3 * (W + 0.5), h: 1.5 * (H - 1) + 2 },
      neighbors(id) {
        let list = nbCache[id];
        if (!list) {
          const C = cells[id];
          list = nbCache[id] = C ? rawNeighbors(C.col, C.row).filter((x) => cells[x]) : [];
        }
        return list;
      },
      distance(a, b) {
        const A = cells[a], B = cells[b];
        const p = toCube(A.col, A.row), q = toCube(B.col, B.row);
        return (Math.abs(p.q - q.q) + Math.abs(p.r - q.r) + Math.abs(p.s - q.s)) / 2;
      },
      /** Case sous un point (x, y) en rayons d'hexagone, ou null. */
      cellAt(x, y) {
        const qf = (SQ3 / 3 * x - y / 3), rf = (2 / 3) * y;
        let q = Math.round(qf), r = Math.round(rf), s = Math.round(-qf - rf);
        const dq = Math.abs(q - qf), dr = Math.abs(r - rf), ds = Math.abs(s + qf + rf);
        if (dq > dr && dq > ds) q = -r - s; else if (dr > ds) r = -q - s;
        const c = q + (r - (r & 1)) / 2;
        const id = key(c, r);
        return cells[id] ? id : null;
      },
    };
    placeTreasures(world, cfg, rnd);
    return world;
  }

  /** Trésors : loin des bords et loin les uns des autres ; un seul scarabée géant, au milieu de la carte. */
  function placeTreasures(world, cfg, rnd) {
    const T = cfg.treasures;
    const count = Math.max(4, Math.round(world.ids.length / cfg.map.cellsPerTreasure));
    const types = Object.keys(T.types).filter((k) => !T.types[k].unique);
    const chosen = [];
    const far = (id, d) => chosen.every((t) => world.distance(id, t) >= d);
    const inner = world.ids.filter((id) => {
      const c = world.cells[id];
      return c.col > 2 && c.row > 2 && c.col < world.width - 3 && c.row < world.height - 3;
    });
    // Le scarabée géant : la case intérieure la plus proche du centre
    const cx = world.size.w / 2, cy = world.size.h / 2;
    let mid = inner[0], bestD = Infinity;
    for (const id of inner) {
      const c = world.cells[id];
      const d = (c.x - cx) ** 2 + (c.y - cy) ** 2;
      if (d < bestD) { bestD = d; mid = id; }
    }
    for (const k in T.types) if (T.types[k].unique && mid) { world.treasures[mid] = k; chosen.push(mid); }
    for (let tries = 0; chosen.length < count + 1 && tries < 4000; tries++) {
      const id = inner[Math.floor(rnd() * inner.length)];
      if (world.treasures[id] || !far(id, T.minDistance)) continue;
      world.treasures[id] = types[Math.floor(rnd() * types.length)];
      chosen.push(id);
    }
  }

  const GARDEN = { buildGarden, SQ3 };
  if (typeof module !== 'undefined' && module.exports) module.exports = GARDEN;
  else (root.FZ = root.FZ || {}).GARDEN = GARDEN;
})(typeof window !== 'undefined' ? window : globalThis);
