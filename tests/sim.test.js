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

test('combat de Lanchester', () => {
  assert.deepStrictEqual(SIM.resolveCombat(10, 6, 1), { attackerWins: true, survivors: 8 });
  const r = SIM.resolveCombat(5, 10, 1);
  assert.strictEqual(r.attackerWins, false);
  assert.strictEqual(r.survivors, 8);
  assert.strictEqual(SIM.resolveCombat(10, 10, 1).attackerWins, false);
});

test('monde neuf : des colonies IA, rien d’autre', () => {
  const w = fakeWorld(60, 40);
  const s = SIM.createWorldState(w, CONFIG, { seed: 1, aiCount: 3 });
  assert.strictEqual(s.colonies.length, 3);
  assert.ok(s.colonies.every((c) => c.isAI));
  assert.strictEqual(s.phase, 'playing');
});

test('rejoindre : nid + fourmiz de départ, une seule colonie par joueur, distance minimale', () => {
  const w = fakeWorld();
  const cfg = cfgNoAI();
  const s = worldWithPlayer(w, cfg);
  const me = SIM.colonyOf(s, 'u1');
  assert.strictEqual(me.name, 'Alice');
  assert.strictEqual(s.cells.c5_5.ants, cfg.start.ants);
  assert.strictEqual(SIM.applyOrder(s, w, cfg, { uid: 'u1', type: 'join', cell: 'c20_15' }).ok, false, 'deuxième colonie refusée');
  assert.strictEqual(SIM.applyOrder(s, w, cfg, { uid: 'u2', type: 'join', cell: 'c6_5' }).ok, false, 'trop près');
  assert.ok(SIM.applyOrder(s, w, cfg, { uid: 'u2', type: 'join', name: 'Bob', cell: 'c20_15' }).ok);
  assert.notStrictEqual(SIM.colonyOf(s, 'u2').color, me.color);
});

test('ordres : un joueur ne commande que sa propre colonie', () => {
  const w = fakeWorld();
  const cfg = cfgNoAI();
  const s = worldWithPlayer(w, cfg);
  SIM.applyOrder(s, w, cfg, { uid: 'u2', type: 'join', name: 'Bob', cell: 'c20_15' });
  const r = SIM.applyOrder(s, w, cfg, { uid: 'u2', type: 'send', from: 'c5_5', to: 'c6_5', ants: 10 });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(SIM.applyOrder(s, w, cfg, { uid: 'u1', type: 'send', from: 'c5_5', to: 'c9_9', ants: 5 }).ok, false, 'non adjacent');
  assert.strictEqual(SIM.applyOrder(s, w, cfg, { uid: 'u1', type: 'lay', mode: 'hack' }).ok, false);
  assert.strictEqual(SIM.applyOrder(s, w, cfg, { uid: 'u3', type: 'send', from: 'c5_5', to: 'c6_5', ants: 5 }).ok, false, 'sans colonie');
});

test('envoi puis conquête d’une case sauvage', () => {
  const w = fakeWorld();
  const cfg = cfgNoAI();
  const s = worldWithPlayer(w, cfg);
  assert.ok(SIM.applyOrder(s, w, cfg, { uid: 'u1', type: 'send', from: 'c5_5', to: 'c6_5', ants: 25 }).ok);
  for (let i = 0; i < 10; i++) SIM.step(s, w, cfg);
  assert.strictEqual(s.cells.c6_5.owner, SIM.colonyOf(s, 'u1').id);
});

test('production : la reine pond', () => {
  const w = fakeWorld();
  const s = worldWithPlayer(w);
  const before = SIM.colonyOf(s, 'u1').stats.ants;
  for (let i = 0; i < 30; i++) SIM.step(s, w, cfgNoAI());
  assert.ok(SIM.colonyOf(s, 'u1').stats.ants > before);
});

test('famine : sans nourriture, les fourmiz meurent', () => {
  const w = fakeWorld(30, 20, 'ice');
  const cfg = cfgNoAI();
  const s = worldWithPlayer(w, cfg);
  const me = SIM.colonyOf(s, 'u1');
  me.food = 0;
  s.cells.c5_5.ants = 500;
  SIM.setLayMode(s, cfg, me.id, 'stop');
  for (let i = 0; i < 20; i++) SIM.step(s, w, cfg);
  assert.ok(s.cells.c5_5.ants < 500);
});

test('saisons : hémisphères inversés, pas d’hiver aux tropiques', () => {
  const winterTick = CONFIG.seasons.lengthTicks * 3 + 1;
  assert.strictEqual(SIM.seasonAt(winterTick, 48, CONFIG).name, 'Hiver');
  assert.strictEqual(SIM.seasonAt(winterTick, -35, CONFIG).name, 'Été');
  assert.strictEqual(SIM.seasonAt(winterTick, 5, CONFIG).factor, 1);
});

test('prise du nid : la reine meurt, une nouvelle reine peut être élevée', () => {
  const w = fakeWorld();
  const cfg = cfgNoAI();
  const s = worldWithPlayer(w, cfg);
  SIM.applyOrder(s, w, cfg, { uid: 'u2', type: 'join', name: 'Bob', cell: 'c9_5' });
  const me = SIM.colonyOf(s, 'u1');
  const bob = SIM.colonyOf(s, 'u2');
  s.cells.c6_5 = { owner: me.id, ants: 40 };
  s.cells.c2_2 = { owner: me.id, ants: 40 };
  s.cells.c8_5 = { owner: bob.id, ants: 0 };
  s.cells.c7_5 = { owner: bob.id, ants: 900 };
  SIM.applyOrder(s, w, cfg, { uid: 'u2', type: 'send', from: 'c7_5', to: 'c6_5', ants: 400 });
  for (let i = 0; i < 10; i++) SIM.step(s, w, cfg);
  SIM.applyOrder(s, w, cfg, { uid: 'u2', type: 'send', from: 'c6_5', to: 'c5_5', ants: 300 });
  for (let i = 0; i < 10; i++) SIM.step(s, w, cfg);
  assert.strictEqual(me.queenAlive, false, 'reine morte');
  me.food = 200;
  const r = SIM.applyOrder(s, w, cfg, { uid: 'u1', type: 'queen', cell: 'c2_2' });
  assert.ok(r.ok, r.reason);
  assert.strictEqual(me.nest, 'c2_2');
});

test('IA : les colonies rivales s’étendent', () => {
  const w = fakeWorld(40, 30);
  const s = SIM.createWorldState(w, CONFIG, { seed: 7, aiCount: 4 });
  for (let i = 0; i < 300; i++) { SIM.step(s, w, CONFIG); AI.thinkAll(s, w, CONFIG, SIM); }
  assert.ok(s.colonies.some((c) => c.alive && c.stats.territories > 3));
});

test('serveur : temps continu, rattrapage, ordres, aller-retour Firebase', () => {
  const w = fakeWorld(40, 30);
  const cfg = clone(CONFIG);
  cfg.online.aiCount = 2;
  cfg.victory.landShare = 1; // pas de fin de partie pendant ce test
  const ms = cfg.time.tickSeconds * 1000;
  let s = ENGINE.runTick(null, w, cfg, 1000);
  assert.strictEqual(s.tick, 0);
  assert.strictEqual(s.startedAt, 1000);
  s = ENGINE.runTick(throughFirebase(s), w, cfg, 1000 + 60000);
  assert.strictEqual(s.tick, 60000 / ms, 'une minute = 30 ticks de 2 s');
  let out = ENGINE.runOrder(throughFirebase(s), w, cfg, { uid: 'u1', type: 'join', name: 'Alice', cell: w.ids[123] }, 1000 + 61000);
  assert.ok(out.result.ok, out.result.reason);
  assert.strictEqual(out.state.tick, 30, 'l’ordre rattrape le temps avant de s’appliquer (61 s → tick 30)');
  s = out.state;
  const me = SIM.colonyOf(s, 'u1');
  out = ENGINE.runOrder(throughFirebase(s), w, cfg, { uid: 'u1', type: 'send', from: me.nest, to: w.neighbors(me.nest)[0], ants: 10 }, 1000 + 62000);
  assert.ok(out.result.ok, out.result.reason);
  s = ENGINE.runTick(throughFirebase(out.state), w, cfg, 1000 + 10 * 60000);
  assert.strictEqual(s.tick, 300);
  assert.ok(SIM.colonyOf(s, 'u1'));
  // Long arrêt du serveur : on ne rattrape pas plus que maxCatchUpTicks
  s = ENGINE.runTick(throughFirebase(s), w, cfg, 1000 + 10 * 3600000);
  assert.strictEqual(s.tick, 300 + cfg.online.maxCatchUpTicks);
});

test('serveur : migration d’un monde de l’ancienne version (tours d’une minute)', () => {
  const w = fakeWorld();
  const cfg = cfgNoAI();
  const old = worldWithPlayer(w, cfg);
  delete old.startedAt;
  old.tick = 50;
  old.lastTickAt = 5000000;
  old.moves = [{ id: 1, owner: 0, from: 'c5_5', to: 'c6_5', ants: 3, depart: 49, arrive: 53 }];
  const s = ENGINE.runTick(throughFirebase(old), w, cfg, 5000000 + 4000);
  assert.strictEqual(s.tick, 52);
  assert.ok(!('lastTickAt' in s));
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

test('trajet longue distance par les galeries, plus rapide chez soi', () => {
  const w = fakeWorld();
  const cfg = cfgNoAI();
  const s = worldWithPlayer(w, cfg);
  const me = SIM.colonyOf(s, 'u1');
  for (let q = 6; q <= 12; q++) s.cells[`c${q}_5`] = { owner: me.id, ants: 1 };
  // Renfort lointain vers une case à soi
  let r = SIM.applyOrder(s, w, cfg, { uid: 'u1', type: 'send', from: 'c5_5', to: 'c12_5', ants: 10 });
  assert.ok(r.ok, r.reason);
  const mv = s.moves[s.moves.length - 1];
  assert.strictEqual(mv.path.length, 8);
  const direct = SIM.findPath(s, w, cfg, me.id, 'c5_5', 'c6_5');
  assert.deepStrictEqual(direct.path, ['c5_5', 'c6_5']);
  assert.ok(mv.arrive - mv.depart < 7 * cfg.movement.baseTravelTicks * 1.1, 'les galeries accélèrent');
  // Attaque à distance : la cible touche le territoire
  r = SIM.applyOrder(s, w, cfg, { uid: 'u1', type: 'send', from: 'c5_5', to: 'c13_5', ants: 10 });
  assert.ok(r.ok, r.reason);
  // Cible loin de tout : refusée
  r = SIM.applyOrder(s, w, cfg, { uid: 'u1', type: 'send', from: 'c5_5', to: 'c20_15', ants: 5 });
  assert.strictEqual(r.ok, false);
  for (let i = 0; i < 60; i++) SIM.step(s, w, cfg);
  assert.ok(s.cells.c12_5.ants >= 11, 'le renfort est arrivé');
  assert.strictEqual(s.cells.c13_5.owner, me.id, 'la case lointaine est prise');
});

test('rassembler ici : les fourmiz en trop convergent', () => {
  const w = fakeWorld();
  const cfg = cfgNoAI();
  const s = worldWithPlayer(w, cfg);
  const me = SIM.colonyOf(s, 'u1');
  for (let q = 6; q <= 10; q++) s.cells[`c${q}_5`] = { owner: me.id, ants: 20 };
  SIM.setLayMode(s, cfg, me.id, 'stop');
  const before = Object.keys(s.cells).reduce((t, k) => t + s.cells[k].ants, 0);
  const r = SIM.applyOrder(s, w, cfg, { uid: 'u1', type: 'rally', cell: 'c10_5' });
  assert.ok(r.ok, r.reason);
  assert.strictEqual(s.cells.c6_5.ants, cfg.movement.rallyKeep);
  me.food = 1000;
  for (let i = 0; i < 60; i++) SIM.step(s, w, cfg);
  assert.ok(s.cells.c10_5.ants >= before - 5 * cfg.movement.rallyKeep - 2, 'presque tout est arrivé au point de ralliement');
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
