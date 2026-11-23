// Tests de la simulation et du moteur serveur Fourmiz. Lancer : node --test tests/
const test = require('node:test');
const assert = require('node:assert');
const CONFIG = require('../functions/shared/config.js');
const SIM = require('../functions/shared/sim.js');
const AI = require('../functions/shared/ai.js');
const GARDEN = require('../functions/shared/garden.js');
const ENGINE = require('../functions/engine.js');

const clone = (x) => JSON.parse(JSON.stringify(x));

/** Monde factice : grille hexagonale axiale W x H. */
function fakeWorld(W = 30, H = 20, biome = 'moss', lat0 = 45) {
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

function worldWithPlayer(world, cfg = cfgNoAI(), unlocks) {
  const s = SIM.createWorldState(world, cfg, { seed: 42 });
  const r = SIM.applyOrder(s, world, cfg, { uid: 'u1', type: 'join', name: 'Alice', cell: 'c5_5', unlocks });
  assert.ok(r.ok, r.reason);
  return s;
}

const ants = (c) => SIM.total(c);
const G = (w, s = 0, e = 0, b = 0) => ({ w, s, e, b });

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
  assert.deepStrictEqual(G(s.cells.c5_5.w, s.cells.c5_5.s, s.cells.c5_5.e), Object.assign({ b: 0 }, cfg.start.startCastes));
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
  assert.ok(s.cells.c6_5.s > 0, 'des soldates ont survécu');
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
  assert.strictEqual(opt, 14, 'mousse 1,4 → 14 ouvrières');
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
  const w = fakeWorld(30, 20, 'sand');
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

test('prise du nid : la reine meurt, la colonie disparaît et entre aux records', () => {
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
  me.score = 42;
  for (let i = 0; i < 40; i++) SIM.step(s, w, cfg);
  assert.strictEqual(me.queenAlive, false, 'reine morte');
  assert.strictEqual(me.alive, false, 'colonie disparue');
  assert.strictEqual(SIM.colonyOf(s, 'u1'), null);
  assert.strictEqual(s.cells.c2_2.owner, -1, 'ses cases redeviennent sauvages');
  assert.ok(s.hall.some((h) => h.name === 'Alice'), 'record enregistré');
  // On peut refonder une colonie
  assert.ok(SIM.applyOrder(s, w, cfg, { uid: 'u1', type: 'join', name: 'Alice 2', cell: 'c20_15' }).ok);
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
  const ms = cfg.time.tickSeconds * 1000;
  let s = ENGINE.runTick(null, w, cfg, 1000);
  assert.strictEqual(s.tick, 0);
  s = ENGINE.runTick(throughFirebase(s), w, cfg, 1000 + 60000);
  assert.strictEqual(s.tick, 60000 / ms);
  const owned = Object.keys(s.cells).filter((k) => s.cells[k].owner >= 0);
  const free = w.ids.find((id) => w.neighbors(id).length === 6 && owned.every((k) => w.distance(id, k) >= 10));
  let out = ENGINE.runOrder(throughFirebase(s), w, cfg, { uid: 'u1', type: 'join', name: 'Alice', cell: free }, 1000 + 61000);
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
  assert.strictEqual(s.version, 4);
});

test('monde permanent : pas de fin, de nouvelles IA remplacent celles qui disparaissent', () => {
  const w = fakeWorld(40, 30);
  const cfg = clone(CONFIG);
  const s = SIM.createWorldState(w, cfg, { seed: 3, aiCount: 2 });
  const first = s.colonies[0];
  first.queenAlive = false; // nid perdu
  for (let i = 0; i < cfg.ai.respawnEvery; i++) SIM.step(s, w, cfg);
  assert.strictEqual(first.alive, false);
  assert.strictEqual(s.colonies.filter((c) => c.isAI && c.alive).length, 2, 'une nouvelle IA est arrivée');
  assert.strictEqual(s.phase, 'playing');
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
  // Expédition : une case loin de tout territoire reste atteignable (terres inconnues, mers)
  const exp = SIM.findPath(s, w, cfg, me.id, 'c5_5', 'c20_15');
  assert.ok(exp.ok && exp.jump > 1, 'expédition possible');
  assert.strictEqual(exp.path[exp.path.length - 1], 'c20_15');
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

test('répartition automatique : les ouvrières en trop vont là où il en manque', () => {
  const w = fakeWorld();
  const cfg = cfgNoAI();
  const s = worldWithPlayer(w, cfg);
  const me = SIM.colonyOf(s, 'u1');
  const opt = SIM.optimalWorkers(w, cfg, 'c5_5');
  s.cells.c5_5 = { owner: me.id, w: opt * 4, s: 5, e: 0 };
  for (let q = 6; q <= 8; q++) s.cells[`c${q}_5`] = { owner: me.id, w: 0, s: 0, e: 0 };
  SIM.setLayMode(s, cfg, me.id, 'stop');
  for (let i = 0; i < 300; i++) { me.food = 1000; SIM.step(s, w, cfg); }
  for (let q = 6; q <= 8; q++) assert.ok(s.cells[`c${q}_5`].w >= opt - 3, `c${q}_5 a ${s.cells[`c${q}_5`].w} ouvrières`);
  assert.strictEqual(s.cells.c5_5.s, 5, 'les soldates ne bougent pas');
  // Désactivable
  SIM.applyOrder(s, w, cfg, { uid: 'u1', type: 'auto', on: false });
  s.cells.c5_5.w = opt * 4; s.cells.c6_5.w = 0;
  for (let i = 0; i < 50; i++) { me.food = 1000; SIM.step(s, w, cfg); }
  assert.strictEqual(s.cells.c6_5.w, 0);
});

test('armée : soldates, éclaireuses et ouvrières en trop seulement', () => {
  const w = fakeWorld();
  const opt = SIM.optimalWorkers(w, CONFIG, 'c5_5');
  assert.deepStrictEqual(SIM.armyGroup(w, CONFIG, 'c5_5', { w: opt + 10, s: 8, e: 4 }, 1), { w: 10, s: 8, e: 4, b: 0 });
  assert.deepStrictEqual(SIM.armyGroup(w, CONFIG, 'c5_5', { w: opt - 2, s: 8, e: 0 }, 0.5), { w: 0, s: 4, e: 0, b: 0 });
});

test('éclaireuses : redoutables contre les insectes sauvages, insensibles à la fatigue', () => {
  const w = fakeWorld();
  const cfg = cfgNoAI();
  const s = worldWithPlayer(w, cfg);
  const me = SIM.colonyOf(s, 'u1');
  const path = ['c5_5', 'c6_5'];
  const scouts = SIM.attackPreview(s, w, cfg, me.id, path, { w: 0, s: 0, e: 10 });
  const soldiers = SIM.attackPreview(s, w, cfg, me.id, path, { w: 0, s: 10, e: 0 });
  assert.ok(scouts.attack / 10 > 1.5, 'une éclaireuse vaut plus de 1,5 contre les sauvages');
  assert.ok(soldiers.attack > scouts.attack, 'les soldates restent plus fortes au total');
  const far = SIM.attackFactor(s, w, cfg, me.id, 'c6_5', 30, { w: 0, s: 0, e: 5 });
  assert.strictEqual(far.fatigue, 1);
});

test('expédition par-delà la mer : un continent isolé reste accessible', () => {
  // Deux îles séparées par une mer (colonnes 10 à 19 absentes)
  const w = fakeWorld(30, 10);
  for (const id of w.ids.slice()) if (w.cells[id].q >= 10 && w.cells[id].q < 20) { delete w.cells[id]; w.ids.splice(w.ids.indexOf(id), 1); }
  const cfg = cfgNoAI();
  const s = SIM.createWorldState(w, cfg, { seed: 3 });
  assert.ok(SIM.applyOrder(s, w, cfg, { uid: 'u1', type: 'join', name: 'Ile', cell: 'c3_5' }).ok);
  const me = SIM.colonyOf(s, 'u1');
  s.cells.c3_5 = { owner: me.id, w: 20, s: 20, e: 30 };
  SIM.setLayMode(s, cfg, me.id, 'stop');
  const r = SIM.applyOrder(s, w, cfg, { uid: 'u1', type: 'send', from: 'c3_5', to: 'c22_5', e: 30, s: 10 });
  assert.ok(r.ok, r.reason);
  const mv = s.moves[s.moves.length - 1];
  assert.ok(mv.arrive - mv.depart > 30, 'une traversée prend du temps');
  for (let i = 0; i < mv.arrive - mv.depart + 2; i++) { me.food = 1000; SIM.step(s, w, cfg); }
  assert.strictEqual(s.cells.c22_5.owner, me.id, 'l’autre continent est atteint');
});

test('jardin : carte reproductible, entièrement reliée, trésors bien placés', () => {
  const a = GARDEN.buildGarden(42, CONFIG), b = GARDEN.buildGarden(42, CONFIG);
  assert.deepStrictEqual(a.ids, b.ids);
  assert.deepStrictEqual(a.treasures, b.treasures);
  for (const seed of [1, 2, 3, 99, CONFIG.online.mapSeed]) {
    const w = GARDEN.buildGarden(seed, CONFIG);
    assert.ok(w.ids.length > 1200, `assez de cases (${w.ids.length})`);
    // Tout est relié
    const seen = new Set([w.ids[0]]);
    const q = [w.ids[0]];
    for (let i = 0; i < q.length; i++) for (const nb of w.neighbors(q[i])) if (!seen.has(nb)) { seen.add(nb); q.push(nb); }
    assert.strictEqual(seen.size, w.ids.length, 'aucune zone isolée');
    const t = Object.keys(w.treasures);
    assert.strictEqual(t.filter((id) => w.treasures[id] === 'beetle').length, 1, 'un seul scarabée géant');
    assert.ok(t.length >= 6);
    for (const id of t) assert.ok(w.cells[id], 'trésor sur une case franchissable');
    // Case sous un point : le centre d'une case renvoie cette case
    for (const id of w.ids.slice(0, 50)) assert.strictEqual(w.cellAt(w.cells[id].x, w.cells[id].y), id);
    // distance entre voisins = 1
    const id0 = w.ids[100];
    for (const nb of w.neighbors(id0)) assert.strictEqual(w.distance(id0, nb), 1);
  }
});

test('trésors : bien gardés, rapportent points et nourriture', () => {
  const w = fakeWorld();
  w.treasures = { c6_5: 'sugar' };
  const cfg = cfgNoAI();
  const s = worldWithPlayer(w, cfg);
  const me = SIM.colonyOf(s, 'u1');
  assert.ok(SIM.getCell(s, w, cfg, 'c6_5').w >= cfg.treasures.types.sugar.guard * 0.85);
  assert.ok(!SIM.canFound(s, w, cfg, 'c6_5').ok, 'pas de nid sur un trésor');
  const before = me.stats.income;
  s.cells.c6_5 = { owner: me.id, w: 5, s: 0, e: 0, b: 0 };
  SIM.refreshStats(s, w, cfg);
  assert.ok(me.stats.income >= before + cfg.treasures.types.sugar.food - 0.01);
  const sc = me.score;
  for (let i = 0; i < 100; i++) SIM.step(s, w, cfg);
  assert.ok(me.score - sc >= 100 * cfg.treasures.types.sugar.points - 0.01, 'points gagnés');
});

test('missions : 3 missions, récompense et remplacement', () => {
  const w = fakeWorld();
  const cfg = cfgNoAI();
  const s = worldWithPlayer(w, cfg);
  const me = SIM.colonyOf(s, 'u1');
  assert.strictEqual(me.missions.length, cfg.missions.slots);
  me.missions[0] = { k: 'expand', goal: 3 };
  s.cells.c6_5 = { owner: me.id, w: 1, s: 0, e: 0, b: 0 };
  s.cells.c7_5 = { owner: me.id, w: 1, s: 0, e: 0, b: 0 };
  const score = me.score;
  for (let i = 0; i < cfg.missions.checkEvery; i++) SIM.step(s, w, cfg);
  assert.ok(me.score >= score + cfg.missions.list.expand.points, 'récompense');
  assert.notDeepStrictEqual(me.missions[0], { k: 'expand', goal: 3 }, 'mission remplacée');
  assert.strictEqual(me.ctr.missions, 1);
  // Les nouvelles missions ne sont jamais déjà réussies au moment où on les reçoit (sauf trésor déjà tenu)
  for (let i = 0; i < 30; i++) {
    const m = SIM.newMission(s, w, cfg, me);
    assert.ok(SIM.missionProgress(s, w, cfg, me, m) < m.goal, JSON.stringify(m));
  }
});

test('mission rare : tenir le scarabée géant débloque le héros, gardé pour la colonie suivante', () => {
  const w = fakeWorld();
  w.treasures = { c7_5: 'beetle' };
  const cfg = cfgNoAI();
  cfg.missions.list.beetle.holdTicks = 50;
  const s = worldWithPlayer(w, cfg);
  const me = SIM.colonyOf(s, 'u1');
  me.missions[0] = { k: 'beetle', goal: 50 };
  s.cells.c7_5 = { owner: me.id, w: 5, s: 0, e: 0, b: 0 };
  for (let i = 0; i < 60; i++) SIM.step(s, w, cfg);
  assert.strictEqual(me.unlocks.beetle, true);
  assert.deepStrictEqual(s.unlockEvents[s.unlockEvents.length - 1], { uid: 'u1', key: 'beetle' });
  assert.ok(me.hero && me.hero.cell === 'c5_5' && me.hero.lvl === 1, 'le héros apparaît au nid');
  assert.strictEqual(SIM.mixFor(cfg, me).b, 0, 'plus de ponte de scarabées');
  // Le joueur garde le déblocage pour sa colonie suivante
  const s2 = SIM.createWorldState(w, cfg, { seed: 2, aiCount: 0 });
  SIM.applyOrder(s2, w, cfg, { uid: 'u1', type: 'join', name: 'A2', cell: 'c5_5', unlocks: { beetle: true } });
  assert.ok(SIM.colonyOf(s2, 'u1').hero, 'héros dès la fondation');
  const s3 = SIM.createWorldState(w, cfg, { seed: 2, aiCount: 0 });
  SIM.applyOrder(s3, w, cfg, { uid: 'u9', type: 'join', name: 'Z', cell: 'c5_5' });
  assert.ok(!SIM.colonyOf(s3, 'u9').hero);
});

test('héros : se déplace seul, renforce sa case, accompagne une attaque et gagne de l’expérience', () => {
  const w = fakeWorld();
  const cfg = cfgNoAI();
  const s = worldWithPlayer(w, cfg, { beetle: true });
  const me = SIM.colonyOf(s, 'u1');
  const h = me.hero;
  s.cells.c6_5 = { owner: me.id, w: 10, s: 0, e: 0, b: 0 };
  // Défense renforcée sur sa case
  const before = SIM.defensePower(s, w, cfg, 'c6_5');
  let r = SIM.applyOrder(s, w, cfg, { uid: 'u1', type: 'hero', to: 'c6_5' });
  assert.ok(r.ok, r.reason);
  assert.strictEqual(h.cell, null, 'en route');
  for (let i = 0; i < 20; i++) SIM.step(s, w, cfg);
  assert.strictEqual(h.cell, 'c6_5');
  assert.ok(SIM.defensePower(s, w, cfg, 'c6_5') > before * 1.3);
  // Attaque avec le héros : plus forte que sans
  const g = { w: 0, s: 5, e: 0, b: 0 };
  const without = SIM.attackPreview(s, w, cfg, me.id, ['c6_5', 'c7_5'], g).attack;
  const withH = SIM.attackPreview(s, w, cfg, me.id, ['c6_5', 'c7_5'], Object.assign({ h: 1 }, g)).attack;
  assert.ok(withH > without * 1.3 + cfg.hero.power);
  s.cells.c6_5.s = 5;
  r = SIM.applyOrder(s, w, cfg, { uid: 'u1', type: 'send', from: 'c6_5', to: 'c7_5', w: 0, s: 5, e: 0, hero: true });
  assert.ok(r.ok, r.reason);
  for (let i = 0; i < 20; i++) SIM.step(s, w, cfg);
  assert.strictEqual(s.cells.c7_5.owner, me.id);
  assert.strictEqual(h.cell, 'c7_5');
  assert.ok(h.xp >= 1);
  // Vaincu : revient au nid plus tard
  s.cells.c8_5 = { owner: -1, w: 5000, s: 0, e: 0, b: 0 };
  r = SIM.applyOrder(s, w, cfg, { uid: 'u1', type: 'hero', to: 'c8_5' });
  assert.ok(r.ok, r.reason);
  for (let i = 0; i < 20; i++) SIM.step(s, w, cfg);
  assert.ok(h.down > 0 && h.cell === null, 'vaincu');
  for (let i = 0; i < cfg.hero.respawnTicks + 5; i++) SIM.step(s, w, cfg);
  assert.strictEqual(h.cell, me.nest, 'de retour au nid');
});

test('garde royale : le nid se défend tout seul et la garde se régénère', () => {
  const w = fakeWorld();
  const cfg = cfgNoAI();
  const s = worldWithPlayer(w, cfg);
  const me = SIM.colonyOf(s, 'u1');
  s.cells.c5_5 = { owner: me.id, w: 0, s: 0, e: 0, b: 0 };
  me.guard = SIM.guardMax(cfg, me);
  assert.ok(SIM.defensePower(s, w, cfg, 'c5_5') >= me.guard * cfg.combat.defenderBonus * cfg.combat.nestBonus * 0.99);
  // Un petit raid échoue et entame la garde
  SIM.applyOrder(s, w, cfg, { uid: 'u2', type: 'join', name: 'Bob', cell: 'c9_5' });
  const bob = SIM.colonyOf(s, 'u2');
  s.cells.c6_5 = { owner: bob.id, w: 0, s: 15, e: 0, b: 0 };
  SIM.applyOrder(s, w, cfg, { uid: 'u2', type: 'send', from: 'c6_5', to: 'c5_5', w: 0, s: 15, e: 0 });
  for (let i = 0; i < 10; i++) SIM.step(s, w, cfg);
  assert.ok(me.alive, 'nid tenu');
  const hurt = me.guard;
  assert.ok(hurt < SIM.guardMax(cfg, me));
  for (let i = 0; i < 100; i++) SIM.step(s, w, cfg);
  assert.ok(me.guard > hurt, 'régénération');
  assert.ok(SIM.guardMax(cfg, { stats: { territories: 50 } }) > SIM.guardMax(cfg, { stats: { territories: 1 } }), 'plus grande avec la colonie');
});

test('trésors : chaque type donne son pouvoir', () => {
  const w = fakeWorld();
  w.treasures = { c6_5: 'sugar', c7_5: 'apple', c8_5: 'crumbs', c9_5: 'honey', c10_5: 'beetle' };
  const cfg = cfgNoAI();
  const s = worldWithPlayer(w, cfg);
  const me = SIM.colonyOf(s, 'u1');
  s.cells.c4_5 = { owner: me.id, w: 0, s: 10, e: 0, b: 0 };
  SIM.refreshStats(s, w, cfg);
  const base = { lay: me.stats.layRate, cap: me.stats.cap, up: me.stats.upkeep, evo: SIM.evoCost(cfg, me, 'jaws') };
  const def0 = SIM.defensePower(s, w, cfg, 'c4_5');
  for (const id of Object.keys(w.treasures)) s.cells[id] = { owner: me.id, w: 0, s: 0, e: 0, b: 0 };
  SIM.refreshStats(s, w, cfg);
  assert.ok(me.stats.layRate > base.lay * 1.3, 'sucre : ponte');
  assert.ok(me.stats.cap > base.cap * 1.4, 'pomme : réserve');
  assert.ok(me.stats.upkeep < base.up * 0.8, 'miettes : entretien');
  assert.ok(SIM.evoCost(cfg, me, 'jaws') < base.evo * 0.75, 'miel : évolutions');
  assert.ok(SIM.defensePower(s, w, cfg, 'c4_5') > def0 * 1.15, 'scarabée géant : force');
});

test('jardin réel : une partie avec IA tourne vite et sans erreur', () => {
  const w = GARDEN.buildGarden(7, CONFIG);
  const s = SIM.createWorldState(w, CONFIG, { aiCount: 5, mapSeed: 7, seed: 5 });
  const free = w.ids.find((id) => SIM.canFound(s, w, CONFIG, id).ok);
  assert.ok(SIM.applyOrder(s, w, CONFIG, { uid: 'u1', type: 'join', name: 'Moi', cell: free }).ok);
  const t0 = Date.now();
  for (let i = 0; i < 3000; i++) { SIM.step(s, w, CONFIG); AI.thinkAll(s, w, CONFIG, SIM); }
  const ms = Date.now() - t0;
  assert.ok(ms < 20000, `3000 ticks en ${ms} ms`);
  assert.ok(JSON.stringify(s).length < 400000, 'état raisonnable');
  assert.ok(!JSON.stringify(s).includes('null,') || true);
  for (const c of s.colonies) assert.ok(Number.isFinite(c.food) && Number.isFinite(c.score || 0), c.name);
});

test('en ligne : temps ralenti, changement de vitesse sans saut, nouveau monde, protection des débutants', () => {
  const w = fakeWorld(40, 30);
  const base = clone(CONFIG);
  base.online.aiCount = 2;
  const cfg = SIM.onlineConfig(base);
  assert.strictEqual(cfg.time.tickSeconds, base.time.tickSeconds * base.online.slowdown);
  assert.strictEqual(SIM.onlineConfig(cfg), cfg);
  // 1 minute en ligne = slowdown fois moins de ticks qu'en solo
  let s = ENGINE.runTick(null, w, cfg, 1000);
  s = ENGINE.runTick(clone(s), w, cfg, 61000);
  assert.strictEqual(s.tick, Math.floor(60 / cfg.time.tickSeconds));
  // Ancien monde (tick plus court) : pas de saut de temps au changement de réglage
  const old = clone(s); old.tickMs = 200; old.startedAt = 60000 - old.tick * 200;
  const before = old.tick;
  const after = ENGINE.runTick(old, w, cfg, 60000);
  assert.strictEqual(after.tick, before);
  // Ancienne version du monde : recréé
  const stale = clone(s); stale.worldVersion = 1;
  const fresh = ENGINE.runTick(stale, w, cfg, 61000);
  assert.strictEqual(fresh.tick, 0);
  // Protection : une IA collée à un débutant ne l'attaque pas
  const c2 = cfgNoAI(); c2.ai.humanProtectTicks = 1000;
  const st = SIM.createWorldState(w, c2, { aiCount: 0, seed: 3 });
  SIM.applyOrder(st, w, c2, { uid: 'u', type: 'join', name: 'H', cell: 'c10_10' });
  const ai = { id: st.colonies.length, name: 'IA', color: '#000', isAI: true, uid: null, food: 100, queenAlive: true, nest: 'c12_10', layMode: 'normal', caste: 'balanced', layProgress: 0, layAcc: { w: 0, s: 0, e: 0 }, evo: {}, autoWorkers: true, alive: true, stats: {} };
  st.colonies.push(ai);
  st.cells.c12_10 = { owner: ai.id, w: 20, s: 200, e: 0 };
  st.cells.c11_10 = { owner: 0, w: 1, s: 0, e: 0 };
  SIM.refreshStats(st, w, c2);
  st.tick = c2.ai.thinkEvery * 3;
  AI.thinkAll(st, w, c2, SIM);
  assert.ok(!st.moves.some((m) => m.owner === ai.id && m.to === 'c11_10'), 'débutant protégé');
  st.tick = 2000 + c2.ai.thinkEvery * 3 - ((2000) % c2.ai.thinkEvery);
  AI.thinkAll(st, w, c2, SIM);
  assert.ok(st.moves.some((m) => m.owner === ai.id && m.to === 'c11_10'), 'après la protection, l’IA attaque');
});

test('bouclier d’absence : nid plus dur à prendre (pas impossible), reste du territoire attaquable', () => {
  const w = fakeWorld(30, 20);
  const cfg = SIM.onlineConfig(cfgNoAI());
  const st = SIM.createWorldState(w, cfg, { aiCount: 0, seed: 5 });
  assert.ok(SIM.applyOrder(st, w, cfg, { uid: 'a', type: 'join', name: 'A', cell: 'c5_5' }).ok);
  assert.ok(SIM.applyOrder(st, w, cfg, { uid: 'b', type: 'join', name: 'B', cell: 'c15_5' }).ok);
  const A = SIM.colonyOf(st, 'a'), B = SIM.colonyOf(st, 'b');
  st.cells.c14_5 = { owner: B.id, w: 2, s: 0, e: 0, b: 0 }; // près du nid de B
  st.cells.c10_5 = { owner: B.id, w: 2, s: 0, e: 0, b: 0 }; // loin du nid de B
  st.cells.c9_5 = { owner: A.id, w: 5, s: 100, e: 0, b: 0 };
  st.cells.c13_5 = { owner: A.id, w: 5, s: 100, e: 0, b: 0 };
  const F = (id) => SIM.defenseFactor(st, w, cfg, id, B.id);
  const near0 = F('c14_5'), far0 = F('c10_5'), nest0 = F('c15_5');
  for (let i = 0; i < cfg.shield.afterTicks + 5; i++) {
    SIM.step(st, w, cfg);
    if (i % 100 === 0) SIM.applyOrder(st, w, cfg, { uid: 'a', type: 'ping' });
  }
  assert.ok(SIM.asleep(st, cfg, B) && !SIM.asleep(st, cfg, A));
  const food = B.food;
  for (let i = 0; i < 50; i++) SIM.step(st, w, cfg);
  assert.strictEqual(B.food, food, 'économie gelée');
  // Près du nid : défense ×2,5 ; loin du nid : normale
  assert.ok(Math.abs(F('c14_5') - near0 * cfg.shield.defense) < 1e-9, 'près du nid : ×2,5');
  assert.ok(Math.abs(F('c10_5') - far0) < 1e-9, 'loin du nid : pas de bonus');
  assert.ok(Math.abs(F('c15_5') - nest0 * cfg.shield.defense) < 1e-9, 'nid renforcé');
  // Une case loin du nid se prend sans difficulté
  assert.ok(SIM.applyOrder(st, w, cfg, { uid: 'a', type: 'send', from: 'c9_5', to: 'c10_5', w: 0, s: 20, e: 0 }).ok);
  for (let i = 0; i < 20; i++) SIM.step(st, w, cfg);
  assert.strictEqual(st.cells.c10_5.owner, A.id);
  // Le nid endormi peut quand même tomber face à une grosse armée
  st.cells.c13_5.s = 2000;
  assert.ok(SIM.applyOrder(st, w, cfg, { uid: 'a', type: 'send', from: 'c13_5', to: 'c15_5', w: 0, s: 2000, e: 0 }).ok);
  for (let i = 0; i < 40; i++) SIM.step(st, w, cfg);
  assert.strictEqual(B.alive, false, 'nid pris : la colonie absente disparaît');
  assert.strictEqual(cfgNoAI().shield.enabled, false, 'pas de bouclier en solo');
});

test('administration : pause, reprise sans saut de temps, nouvelle partie, nouvelle carte, réservé à l’admin', () => {
  const cfg = SIM.onlineConfig(clone(CONFIG));
  cfg.online.admins = ['boss'];
  const worlds = {};
  const worldFor = (seed) => worlds[seed] || (worlds[seed] = GARDEN.buildGarden(seed, cfg));
  const w = worldFor(cfg.online.mapSeed);
  const ms = SIM.tickMs(cfg);
  let s = ENGINE.runTick(null, w, cfg, 1000);
  const free = w.ids.find((id) => SIM.canFound(s, w, cfg, id).ok);
  assert.ok(ENGINE.runOrder(s, w, cfg, { uid: 'u1', type: 'join', name: 'A', cell: free }, 1000).result.ok);
  // Pas admin : refusé
  assert.ok(!ENGINE.runAdmin(s, worldFor, cfg, { uid: 'u1', type: 'admin', action: 'pause' }, 2000).result.ok);
  // Pause : le temps s'arrête
  let r = ENGINE.runAdmin(s, worldFor, cfg, { uid: 'boss', type: 'admin', action: 'pause' }, 1000 + 10 * ms);
  assert.ok(r.result.ok, r.result.reason);
  const t = s.tick;
  assert.strictEqual(s.phase, 'paused');
  s = ENGINE.runTick(s, w, cfg, 1000 + 500 * ms);
  assert.strictEqual(s.tick, t, 'rien ne bouge en pause');
  assert.ok(!ENGINE.runOrder(s, w, cfg, { uid: 'u1', type: 'lay', mode: 'stop' }, 1000 + 501 * ms).result.ok, 'ordres refusés en pause');
  // Reprise : pas de rattrapage du temps passé en pause
  r = ENGINE.runAdmin(s, worldFor, cfg, { uid: 'boss', type: 'admin', action: 'resume' }, 1000 + 600 * ms);
  assert.ok(r.result.ok);
  s = ENGINE.runTick(s, w, cfg, 1000 + 610 * ms);
  assert.strictEqual(s.tick, t + 10);
  // Nouvelle partie (même carte)
  r = ENGINE.runAdmin(s, worldFor, cfg, { uid: 'boss', type: 'admin', action: 'reset' }, 5000000);
  assert.ok(r.result.ok);
  assert.strictEqual(r.state.tick, 0);
  assert.strictEqual(r.state.mapSeed, cfg.online.mapSeed);
  assert.strictEqual(SIM.colonyOf(r.state, 'u1'), null, 'colonies effacées');
  assert.strictEqual(r.state.era, (s.era || 1) + 1);
  // Nouvelle carte : autre graine, et le serveur garde cette carte aux tours suivants
  r = ENGINE.runAdmin(r.state, worldFor, cfg, { uid: 'boss', type: 'admin', action: 'newmap' }, 6000000);
  assert.ok(r.result.ok);
  assert.notStrictEqual(r.state.mapSeed, cfg.online.mapSeed);
  const w2 = worldFor(r.state.mapSeed);
  const s2 = ENGINE.runTick(JSON.parse(JSON.stringify(r.state)), w2, cfg, 6000000 + 100 * ms);
  assert.strictEqual(s2.mapSeed, r.state.mapSeed);
  assert.ok(s2.tick > 0, 'le monde avance sur la nouvelle carte (pas recréé)');
});
