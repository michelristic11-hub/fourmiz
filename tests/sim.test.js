// Tests de la simulation et du moteur serveur Fourmiz. Lancer : node --test tests/
const test = require('node:test');
const assert = require('node:assert');
const CONFIG = require('../functions/shared/config.js');
const SIM = require('../functions/shared/sim.js');
const AI = require('../functions/shared/ai.js');
const WORLD = require('../functions/shared/world.js');
const ENGINE = require('../functions/engine.js');

const clone = (x) => JSON.parse(JSON.stringify(x));

/** Monde factice : grille hexagonale axiale W x H. */
function fakeWorld(W = 30, H = 20, biome = 'forest', lat0 = 45) {
  const cells = {};
  const ids = [];
  const key = (q, r) => `c${q}_${r}`;
  for (let q = 0; q < W; q++) for (let r = 0; r < H; r++) {
    const id = key(q, r);
    cells[id] = { id, q, r, lat: lat0 + r * 0.5, lng: q, biome };
    ids.push(id);
  }
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, -1], [-1, 1]];
  return {
    ids, cells,
    neighbors(id) {
      const c = cells[id];
      return dirs.map(([dq, dr]) => key(c.q + dq, c.r + dr)).filter((k) => cells[k]);
    },
    distance(a, b) {
      const A = cells[a], B = cells[b];
      const dq = A.q - B.q, dr = A.r - B.r;
      return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
    },
  };
}

function cfgNoAI() {
  const cfg = clone(CONFIG);
  cfg.ai.count = 0;
  cfg.online.aiCount = 0;
  return cfg;
}

/** Simule l'aller-retour par Firebase : JSON, tableaux vides supprimés. */
function throughFirebase(state) {
  const strip = (v) => {
    if (Array.isArray(v)) return v.length ? v.map(strip) : undefined;
    if (v && typeof v === 'object') {
      const o = {};
      for (const k in v) { const s = strip(v[k]); if (s !== undefined && s !== null) o[k] = s; }
      return Object.keys(o).length ? o : undefined;
    }
    return v;
  };
  return strip(clone(state));
}

function worldWithPlayer(world, cfg = cfgNoAI()) {
  const s = SIM.createWorldState(world, cfg, { seed: 42 });
  const r = SIM.applyOrder(s, world, cfg, { uid: 'u1', type: 'join', name: 'Alice', cell: 'c5_5' });
  assert.ok(r.ok, r.reason);
  return s;
}

const ants = (c) => SIM.total(c);
const G = (w, s = 0, e = 0) => ({ w, s, e });

test('combat de Lanchester sur des forces', () => {
  const r = SIM.resolveCombat(10, 6);
  assert.strictEqual(r.attackerWins, true);
  assert.strictEqual(r.ratio, 0.8);
  const d = SIM.resolveCombat(6, 10);
  assert.strictEqual(d.attackerWins, false);
  assert.strictEqual(d.ratio, 0.8);
  assert.strictEqual(SIM.resolveCombat(10, 10).attackerWins, false);
});

test('castes : force, groupes et vitesse', () => {
  assert.strictEqual(SIM.power(G(10, 2, 5), CONFIG), 10 + 6 + 3);
  assert.deepStrictEqual(SIM.pickGroup(G(10, 4, 2), 's', 0.5), G(0, 2, 0));
  assert.deepStrictEqual(SIM.pickGroup(G(10, 4, 2), 'all', 1), G(10, 4, 2));
  assert.strictEqual(SIM.groupSpeed(CONFIG, G(0, 0, 5)), CONFIG.castes.e.speed);
  assert.strictEqual(SIM.groupSpeed(CONFIG, G(1, 0, 5)), 1);
});

test('monde neuf : des colonies IA, rien d’autre', () => {
  const w = fakeWorld(60, 40);
  const s = SIM.createWorldState(w, CONFIG, { seed: 1, aiCount: 3 });
  assert.strictEqual(s.colonies.length, 3);
  assert.ok(s.colonies.every((c) => c.isAI));
  assert.strictEqual(s.phase, 'playing');
});

test('rejoindre : nid + castes de départ, une seule colonie par joueur, distance minimale', () => {
  const w = fakeWorld();
  const cfg = cfgNoAI();
  const s = worldWithPlayer(w, cfg);
  const me = SIM.colonyOf(s, 'u1');
  assert.strictEqual(me.name, 'Alice');
  assert.deepStrictEqual(G(s.cells.c5_5.w, s.cells.c5_5.s, s.cells.c5_5.e), cfg.start.startCastes);
  assert.strictEqual(SIM.applyOrder(s, w, cfg, { uid: 'u1', type: 'join', cell: 'c20_15' }).ok, false);
  assert.strictEqual(SIM.applyOrder(s, w, cfg, { uid: 'u2', type: 'join', cell: 'c6_5' }).ok, false, 'trop près');
  assert.ok(SIM.applyOrder(s, w, cfg, { uid: 'u2', type: 'join', name: 'Bob', cell: 'c20_15' }).ok);
});

test('ordres : un joueur ne commande que sa propre colonie, quantités bornées', () => {
  const w = fakeWorld();
  const cfg = cfgNoAI();
  const s = worldWithPlayer(w, cfg);
  SIM.applyOrder(s, w, cfg, { uid: 'u2', type: 'join', name: 'Bob', cell: 'c20_15' });
  assert.strictEqual(SIM.applyOrder(s, w, cfg, { uid: 'u2', type: 'send', from: 'c5_5', to: 'c6_5', w: 5 }).ok, false);
  assert.strictEqual(SIM.applyOrder(s, w, cfg, { uid: 'u1', type: 'lay', mode: 'hack' }).ok, false);
  assert.strictEqual(SIM.applyOrder(s, w, cfg, { uid: 'u1', type: 'caste', preset: 'hack' }).ok, false);
  const r = SIM.applyOrder(s, w, cfg, { uid: 'u1', type: 'send', from: 'c5_5', to: 'c6_5', w: 999, s: 999 });
  assert.ok(r.ok);
  assert.strictEqual(ants(s.cells.c5_5), 0, 'on ne peut pas envoyer plus que ce qu’on a');
  // Ancien format (nombre total) toujours accepté
  s.cells.c5_5.w = 10;
  assert.ok(SIM.applyOrder(s, w, cfg, { uid: 'u1', type: 'send', from: 'c5_5', to: 'c6_5', ants: 4 }).ok);
});

test('envoi puis conquête d’une case sauvage avec des soldates', () => {
  const w = fakeWorld();
  const cfg = cfgNoAI();
  const s = worldWithPlayer(w, cfg);
  s.cells.c5_5.s = 20;
  assert.ok(SIM.applyOrder(s, w, cfg, { uid: 'u1', type: 'send', from: 'c5_5', to: 'c6_5', s: 10 }).ok);
  for (let i = 0; i < 20; i++) SIM.step(s, w, cfg);
  assert.strictEqual(s.cells.c6_5.owner, SIM.colonyOf(s, 'u1').id);
  assert.ok(s.cells.c6_5.s > 0 && s.cells.c6_5.w === 0, 'les survivantes sont des soldates');
});

test('ponte : respecte la répartition des castes', () => {
  const w = fakeWorld();
  const cfg = cfgNoAI();
  const s = worldWithPlayer(w, cfg);
  const me = SIM.colonyOf(s, 'u1');
  me.food = 100000;
  s.cells.c5_5 = { owner: me.id, w: 0, s: 0, e: 0 };
  SIM.applyOrder(s, w, cfg, { uid: 'u1', type: 'caste', preset: 'war' });
  for (let i = 0; i < 200; i++) SIM.step(s, w, cfg);
  const c = s.cells.c5_5;
  const n = ants(c);
  assert.ok(n > 50);
  assert.ok(Math.abs(c.s / n - cfg.castePresets.war.mix.s) < 0.05, `soldates ${c.s}/${n}`);
});

test('récolte : nombre idéal d’ouvrières et logistique', () => {
  const w = fakeWorld();
  const cfg = cfgNoAI();
  const s = worldWithPlayer(w, cfg);
  const me = SIM.colonyOf(s, 'u1');
  const opt = SIM.optimalWorkers(w, cfg, 'c5_5');
  assert.strictEqual(opt, 13, 'forêt 1,3 → 13 ouvrières');
  s.cells.c5_5.w = opt;
  const full = SIM.harvestInfo(s, w, cfg, me, 'c5_5');
  s.cells.c5_5.w = Math.round(opt / 2);
  const half = SIM.harvestInfo(s, w, cfg, me, 'c5_5');
  s.cells.c5_5.w = opt * 3;
  const crowd = SIM.harvestInfo(s, w, cfg, me, 'c5_5');
  assert.ok(Math.abs(half.food / full.food - 0.5) < 0.05);
  assert.ok(crowd.food > full.food && crowd.food < full.food * 1.2, 'rendement décroissant au-delà de l’idéal');
  // Case lointaine : rapporte moins
  s.cells.c25_5 = { owner: me.id, w: opt, s: 0, e: 0 };
  s.cells.c5_5.w = opt;
  assert.ok(SIM.harvestInfo(s, w, cfg, me, 'c25_5').food < full.food * 0.6);
  // Évolution Phéromones : la logistique s'améliore
  const before = SIM.harvestInfo(s, w, cfg, me, 'c25_5').food;
  me.evo.trails = 2;
  assert.ok(SIM.harvestInfo(s, w, cfg, me, 'c25_5').food > before);
});

test('combat tactique : encerclement, fatigue, défense près du nid', () => {
  const w = fakeWorld();
  const cfg = cfgNoAI();
  const s = worldWithPlayer(w, cfg);
  const me = SIM.colonyOf(s, 'u1');
  s.cells.c6_5 = { owner: me.id, w: 1, s: 0, e: 0 };
  const one = SIM.attackFactor(s, w, cfg, me.id, 'c7_5', 1);
  s.cells.c7_4 = { owner: me.id, w: 1, s: 0, e: 0 };
  s.cells.c8_4 = { owner: me.id, w: 1, s: 0, e: 0 };
  const three = SIM.attackFactor(s, w, cfg, me.id, 'c7_5', 1);
  assert.ok(three.factor > one.factor, 'encerclement');
  assert.ok(SIM.attackFactor(s, w, cfg, me.id, 'c7_5', 20).factor < three.factor, 'fatigue');
  // Défense : le nid > près du nid > loin
  SIM.applyOrder(s, w, cfg, { uid: 'u2', type: 'join', name: 'Bob', cell: 'c20_10' });
  const bob = SIM.colonyOf(s, 'u2');
  s.cells.c21_10 = { owner: bob.id, w: 5, s: 0, e: 0 };
  s.cells.c26_10 = { owner: bob.id, w: 5, s: 0, e: 0 };
  const fNest = SIM.defenseFactor(s, w, cfg, 'c20_10', bob.id);
  const fNear = SIM.defenseFactor(s, w, cfg, 'c21_10', bob.id);
  const fFar = SIM.defenseFactor(s, w, cfg, 'c26_10', bob.id);
  assert.ok(fNest > fNear && fNear > fFar);
});

test('évolutions : coût croissant, effets', () => {
  const w = fakeWorld();
  const cfg = cfgNoAI();
  const s = worldWithPlayer(w, cfg);
  const me = SIM.colonyOf(s, 'u1');
  me.food = 0;
  assert.strictEqual(SIM.applyOrder(s, w, cfg, { uid: 'u1', type: 'evolve', key: 'jaws' }).ok, false, 'pas assez de nourriture');
  me.food = 100000;
  s.stats = null;
  const c1 = SIM.evoCost(cfg, me, 'jaws');
  assert.ok(SIM.applyOrder(s, w, cfg, { uid: 'u1', type: 'evolve', key: 'jaws' }).ok);
  assert.ok(SIM.evoCost(cfg, me, 'jaws') > c1);
  SIM.applyOrder(s, w, cfg, { uid: 'u1', type: 'evolve', key: 'jaws' });
  SIM.applyOrder(s, w, cfg, { uid: 'u1', type: 'evolve', key: 'jaws' });
  assert.strictEqual(SIM.applyOrder(s, w, cfg, { uid: 'u1', type: 'evolve', key: 'jaws' }).ok, false, 'niveau maximum');
  assert.strictEqual(SIM.applyOrder(s, w, cfg, { uid: 'u1', type: 'evolve', key: 'nope' }).ok, false);
  // Acide : soldates plus fortes
  const p0 = SIM.power(G(0, 10), cfg, me);
  me.evo.acid = 1;
  assert.strictEqual(SIM.power(G(0, 10), cfg, me), p0 + 10);
});

test('famine : sans nourriture, les fourmiz meurent (soldates d’abord)', () => {
  const w = fakeWorld(30, 20, 'ice');
  const cfg = cfgNoAI();
  const s = worldWithPlayer(w, cfg);
  const me = SIM.colonyOf(s, 'u1');
  me.food = 0;
  s.cells.c5_5 = { owner: me.id, w: 500, s: 500, e: 0 };
  SIM.setLayMode(s, cfg, me.id, 'stop');
  for (let i = 0; i < 100; i++) SIM.step(s, w, cfg);
  assert.ok(s.cells.c5_5.s < 500 && s.cells.c5_5.w < 500);
});

test('hiver : récolte réduite et nourriture qui se gâte (moins avec les greniers)', () => {
  const w = fakeWorld();
  const cfg = cfgNoAI();
  const s = worldWithPlayer(w, cfg);
  const me = SIM.colonyOf(s, 'u1');
  s.tick = cfg.seasons.lengthTicks * 3 + 1;
  me.food = 1000;
  SIM.refreshStats(s, w, cfg);
  const spoil0 = me.stats.spoil;
  assert.ok(spoil0 > 0);
  me.evo.granary = 2;
  SIM.refreshStats(s, w, cfg);
  assert.ok(me.stats.spoil < spoil0);
  assert.strictEqual(SIM.seasonAt(s.tick, 48, cfg).name, 'Hiver');
  assert.strictEqual(SIM.seasonAt(s.tick, -35, cfg).name, 'Été');
  assert.strictEqual(SIM.seasonAt(s.tick, 5, cfg).factor, 1);
});

test('prise du nid : la reine meurt, une nouvelle reine peut être élevée', () => {
  const w = fakeWorld();
  const cfg = cfgNoAI();
  const s = worldWithPlayer(w, cfg);
  SIM.applyOrder(s, w, cfg, { uid: 'u2', type: 'join', name: 'Bob', cell: 'c9_5' });
  const me = SIM.colonyOf(s, 'u1');
  const bob = SIM.colonyOf(s, 'u2');
  s.cells.c2_2 = { owner: me.id, w: 40, s: 0, e: 0 };
  s.cells.c6_5 = { owner: bob.id, w: 0, s: 0, e: 0 };
  s.cells.c7_5 = { owner: bob.id, w: 0, s: 400, e: 0 };
  SIM.applyOrder(s, w, cfg, { uid: 'u2', type: 'send', from: 'c7_5', to: 'c5_5', s: 300 });
  for (let i = 0; i < 40; i++) SIM.step(s, w, cfg);
  assert.strictEqual(me.queenAlive, false, 'reine morte');
  me.food = 500;
  const r = SIM.applyOrder(s, w, cfg, { uid: 'u1', type: 'queen', cell: 'c2_2' });
  assert.ok(r.ok, r.reason);
  assert.strictEqual(me.nest, 'c2_2');
});

test('IA : les colonies rivales s’étendent et évoluent', () => {
  const w = fakeWorld(40, 30);
  const s = SIM.createWorldState(w, CONFIG, { seed: 7, aiCount: 4 });
  for (let i = 0; i < 3000; i++) { SIM.step(s, w, CONFIG); AI.thinkAll(s, w, CONFIG, SIM); }
  assert.ok(s.colonies.some((c) => c.alive && c.stats.territories > 5), s.colonies.map((c) => c.stats.territories).join(','));
  assert.ok(s.colonies.some((c) => Object.keys(c.evo).length > 0), 'au moins une IA a évolué');
});

test('serveur : temps continu, rattrapage, ordres, aller-retour Firebase', () => {
  const w = fakeWorld(40, 30);
  const cfg = clone(CONFIG);
  cfg.online.aiCount = 2;
  cfg.victory.landShare = 1; // pas de fin de partie pendant ce test
  const ms = cfg.time.tickSeconds * 1000;
  let s = ENGINE.runTick(null, w, cfg, 1000);
  assert.strictEqual(s.tick, 0);
  s = ENGINE.runTick(throughFirebase(s), w, cfg, 1000 + 60000);
  assert.strictEqual(s.tick, 60000 / ms);
  let out = ENGINE.runOrder(throughFirebase(s), w, cfg, { uid: 'u1', type: 'join', name: 'Alice', cell: w.ids[123] }, 1000 + 61000);
  assert.ok(out.result.ok, out.result.reason);
  assert.strictEqual(out.state.tick, 61000 / ms);
  s = out.state;
  const me = SIM.colonyOf(s, 'u1');
  out = ENGINE.runOrder(throughFirebase(s), w, cfg, { uid: 'u1', type: 'send', from: me.nest, to: w.neighbors(me.nest)[0], w: 5, s: 3 }, 1000 + 62000);
  assert.ok(out.result.ok, out.result.reason);
  SIM.colonyOf(out.state, 'u1').food = 500;
  out = ENGINE.runOrder(throughFirebase(out.state), w, cfg, { uid: 'u1', type: 'evolve', key: 'harvest' }, 1000 + 63000);
  assert.ok(out.result.ok, out.result.reason);
  s = ENGINE.runTick(throughFirebase(out.state), w, cfg, 1000 + 3 * 60000);
  assert.strictEqual(s.tick, 3 * 60000 / ms);
  assert.ok(SIM.colonyOf(s, 'u1'));
  assert.strictEqual(SIM.colonyOf(s, 'u1').evo.harvest, 1);
  s = ENGINE.runTick(throughFirebase(s), w, cfg, 1000 + 10 * 3600000);
  assert.strictEqual(s.tick, 3 * 60000 / ms + cfg.online.maxCatchUpTicks);
});

test('serveur : migration d’un monde de l’ancienne version (une seule caste, tours d’une minute)', () => {
  const w = fakeWorld();
  const cfg = cfgNoAI();
  const old = worldWithPlayer(w, cfg);
  delete old.startedAt;
  old.version = 2;
  old.tick = 50;
  old.lastTickAt = 5000000;
  old.cells.c5_5 = { owner: 0, ants: 42 };
  old.moves = [{ id: 1, owner: 0, from: 'c5_5', to: 'c6_5', ants: 3, depart: 49, arrive: 53 }];
  delete old.colonies[0].evo;
  const s = ENGINE.runTick(throughFirebase(old), w, cfg, 5000000 + 1000);
  assert.strictEqual(s.tick, 55);
  assert.ok(!('lastTickAt' in s));
  assert.ok(s.cells.c5_5.w >= 42 - 5 && !('ants' in s.cells.c5_5));
  assert.strictEqual(s.version, 3);
});

test('serveur : nouveau monde après une victoire', () => {
  const w = fakeWorld();
  const cfg = cfgNoAI();
  let s = ENGINE.runTick(null, w, cfg, 0);
  s.phase = 'over';
  s = ENGINE.runTick(s, w, cfg, 1000);
  assert.strictEqual(s.phase, 'over');
  s = ENGINE.runTick(s, w, cfg, 1000 + cfg.online.resetAfterMinutes * 60000);
  assert.strictEqual(s.phase, 'playing');
  assert.strictEqual(s.era, 2);
});

test('trajet longue distance par les galeries, éclaireuses plus rapides', () => {
  const w = fakeWorld();
  const cfg = cfgNoAI();
  const s = worldWithPlayer(w, cfg);
  const me = SIM.colonyOf(s, 'u1');
  for (let q = 6; q <= 12; q++) s.cells[`c${q}_5`] = { owner: me.id, w: 1, s: 0, e: 0 };
  s.cells.c5_5 = { owner: me.id, w: 40, s: 40, e: 40 };
  SIM.setLayMode(s, cfg, me.id, 'stop');
  let r = SIM.applyOrder(s, w, cfg, { uid: 'u1', type: 'send', from: 'c5_5', to: 'c12_5', w: 10 });
  assert.ok(r.ok, r.reason);
  const slow = s.moves[s.moves.length - 1];
  assert.strictEqual(slow.path.length, 8);
  r = SIM.applyOrder(s, w, cfg, { uid: 'u1', type: 'send', from: 'c5_5', to: 'c12_5', e: 10 });
  const fast = s.moves[s.moves.length - 1];
  assert.ok(fast.arrive - fast.depart < slow.arrive - slow.depart, 'éclaireuses plus rapides');
  r = SIM.applyOrder(s, w, cfg, { uid: 'u1', type: 'send', from: 'c5_5', to: 'c13_5', s: 20 });
  assert.ok(r.ok, r.reason);
  assert.strictEqual(SIM.applyOrder(s, w, cfg, { uid: 'u1', type: 'send', from: 'c5_5', to: 'c20_15', w: 5 }).ok, false);
  for (let i = 0; i < 30; i++) { me.food = 1000; SIM.step(s, w, cfg); }
  assert.ok(s.cells.c12_5.w >= 11 && s.cells.c12_5.e >= 10, 'renforts arrivés');
  assert.strictEqual(s.cells.c13_5.owner, me.id, 'la case lointaine est prise');
});

test('rassembler ici : les ouvrières utiles restent, le reste converge', () => {
  const w = fakeWorld();
  const cfg = cfgNoAI();
  const s = worldWithPlayer(w, cfg);
  const me = SIM.colonyOf(s, 'u1');
  for (let q = 6; q <= 10; q++) s.cells[`c${q}_5`] = { owner: me.id, w: 20, s: 10, e: 0 };
  SIM.setLayMode(s, cfg, me.id, 'stop');
  me.food = 10000;
  const r = SIM.applyOrder(s, w, cfg, { uid: 'u1', type: 'rally', cell: 'c10_5' });
  assert.ok(r.ok, r.reason);
  const opt = SIM.optimalWorkers(w, cfg, 'c6_5');
  assert.strictEqual(s.cells.c6_5.w, opt);
  assert.strictEqual(s.cells.c6_5.s, 0);
  for (let i = 0; i < 120; i++) SIM.step(s, w, cfg);
  assert.ok(s.cells.c10_5.s >= 50, 'les soldates sont arrivées');
  assert.strictEqual(SIM.applyOrder(s, w, cfg, { uid: 'u1', type: 'rally', cell: 'c20_15' }).ok, false);
});

test('biomes : quelques repères géographiques', () => {
  assert.strictEqual(WORLD.biomeFor(23, 10), 'desert');
  assert.strictEqual(WORLD.biomeFor(-3, -60), 'jungle');
  assert.strictEqual(WORLD.biomeFor(48, 2), 'forest');
  assert.strictEqual(WORLD.biomeFor(72, 100), 'tundra');
  assert.strictEqual(WORLD.biomeFor(46, 9), 'mountain');
  assert.strictEqual(WORLD.biomeFor(75, -40), 'ice');
});

test('point dans polygone avec trou', () => {
  const geo = { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]], [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]]] };
  const polys = WORLD.preparePolygons(geo);
  assert.strictEqual(WORLD.onLand(polys, 2, 2), true);
  assert.strictEqual(WORLD.onLand(polys, 5, 5), false);
});
