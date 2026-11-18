/**
 * Fourmiz — simulation pure (aucun accès au DOM ni à la carte), partagée par le navigateur et le serveur.
 *
 * L'état de jeu est un objet JSON sérialisable : il est sauvegardé tel quel (navigateur en solo,
 * Realtime Database en ligne) et le serveur utilise ce même code pour arbitrer les parties.
 *
 * Fourmiz : quatre castes, comptées séparément sur chaque case et dans chaque trajet.
 *   w = ouvrières (récoltent), s = soldates (combattent), e = éclaireuses (rapides),
 *   b = scarabées (combattants spéciaux, à débloquer par la mission rare).
 *
 * Le monde est permanent : pas de fin de partie. Si la reine meurt, la colonie disparaît.
 * Objectifs : tenir des trésors, réussir des missions, marquer des points (classement et records).
 *
 * Interface « world » attendue :
 *   world.ids                 : tableau des identifiants de cases (terre ferme)
 *   world.cells[id]           : { id, lat, lng, biome }
 *   world.neighbors(id)       : identifiants des cases voisines sur terre ferme
 *   world.distance(a, b)      : distance en nombre de cases
 *   world.treasures           : (facultatif) { id: type de trésor }
 */
(function (root) {
  'use strict';

  const CASTES = ['w', 's', 'e', 'b'];
  /** Valeurs par défaut pour hydrate() appelé sans configuration. */
  const DEFAULTS = { nest: { guardBase: 30 } };
  const emptyGroup = () => ({ w: 0, s: 0, e: 0, b: 0 });

  // ---------- Hasard reproductible ----------

  /** Générateur pseudo-aléatoire mulberry32, état stocké dans state.rng. */
  function rand(state) {
    let t = (state.rng = (state.rng + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Hachage stable d'une chaîne vers [0, 1). */
  function hash01(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return ((h >>> 0) % 100000) / 100000;
  }

  // ---------- Groupes de fourmiz (castes) ----------

  /** Nombre total de fourmiz d'une case ou d'un trajet. */
  function total(g) { return (g.w || 0) + (g.s || 0) + (g.e || 0) + (g.b || 0); }

  /** Force de combat brute d'un groupe (vsWild : contre des insectes sauvages, les éclaireuses excellent). */
  function power(g, cfg, col, vsWild) {
    const acid = col ? evoLevel(col, 'acid') * cfg.evolutions.list.acid.effect : 0;
    const e = cfg.castes.e.power * (vsWild ? cfg.castes.e.wildBonus : 1);
    return (g.w || 0) * cfg.castes.w.power + (g.s || 0) * (cfg.castes.s.power + acid) + (g.e || 0) * e + (g.b || 0) * cfg.castes.b.power;
  }

  /** Multiplie chaque caste d'un groupe (arrondi vers le bas, au moins 1 fourmi si min1). */
  function scaleGroup(g, f, min1) {
    const out = emptyGroup();
    for (const k of CASTES) out[k] = Math.floor((g[k] || 0) * f);
    if (min1 && total(out) === 0) {
      const best = CASTES.slice().sort((a, b) => (g[b] || 0) - (g[a] || 0))[0];
      out[best] = 1;
    }
    return out;
  }

  /**
   * Prend une part des fourmiz d'une case : caste = 'all' | 'w' | 's' | 'e' | 'b', share entre 0 et 1.
   * @returns {{w:number, s:number, e:number, b:number}}
   */
  function pickGroup(cell, caste, share) {
    const g = emptyGroup();
    const keys = caste && caste !== 'all' ? [caste] : CASTES;
    for (const k of keys) g[k] = Math.floor((cell[k] || 0) * share);
    if (total(g) === 0) {
      for (const k of keys) if ((cell[k] || 0) > 0) { g[k] = 1; break; }
    }
    return g;
  }

  /**
   * « Armée » d'une case : soldates, éclaireuses et ouvrières en trop (au-delà du nombre idéal),
   * pour attaquer sans désorganiser la récolte.
   */
  function armyGroup(world, cfg, id, cell, share) {
    const spare = Math.max(0, (cell.w || 0) - optimalWorkers(world, cfg, id));
    const base = { w: spare, s: cell.s || 0, e: cell.e || 0, b: cell.b || 0 };
    const g = emptyGroup();
    for (const k of CASTES) g[k] = Math.floor(base[k] * share);
    if (total(g) === 0) for (const k of ['b', 's', 'e', 'w']) if (base[k] > 0) { g[k] = 1; break; }
    return g;
  }

  // ---------- Accès aux cases ----------

  /** Garnison d'insectes sauvages d'une case neutre jamais touchée. */
  function wildGarrison(world, cfg, id) {
    const t = treasureAt(world, id);
    if (t) return Math.round(cfg.treasures.types[t].guard * (0.85 + 0.3 * hash01(id)));
    const b = cfg.biomes[world.cells[id].biome];
    return Math.round(b.wild[0] + hash01(id) * (b.wild[1] - b.wild[0]));
  }

  /** Type de trésor posé sur une case (ou null). */
  function treasureAt(world, id) {
    return (world.treasures && world.treasures[id]) || null;
  }

  /** Pouvoir cumulé des trésors tenus par une colonie (un seul compte par type). key : lay, harvest, storage, upkeep, evo, force. */
  function tpow(cfg, col, key) {
    const held = col && col.stats && col.stats.treasures;
    if (!held || !cfg.treasures) return 0;
    let v = 0;
    for (const t in held) {
      const P = held[t] > 0 && cfg.treasures.types[t] && cfg.treasures.types[t].power;
      if (P && P[key]) v += P[key];
    }
    return v;
  }

  // ---------- Héros scarabée ----------

  /** Le héros de la colonie s'il est débloqué (sinon null). */
  function heroOf(col) { return col && col.unlocks && col.unlocks.beetle && col.hero ? col.hero : null; }
  function ensureHero(state, cfg, col) {
    if (col && col.alive !== false && col.unlocks && col.unlocks.beetle && !col.hero) {
      col.hero = { cell: col.nest, lvl: 1, xp: 0, down: 0 };
    }
  }
  /** Le héros se bat-il sur cette case (posé dessus, pas vaincu) ? */
  function heroAt(col, id) { const h = heroOf(col); return !!(h && !h.down && h.cell === id); }
  function heroBoost(cfg, h) { return 1 + cfg.hero.bonus + cfg.hero.bonusPerLevel * ((h.lvl || 1) - 1); }
  function heroPower(cfg, h) { return cfg.hero.power + cfg.hero.powerPerLevel * ((h.lvl || 1) - 1); }
  function heroXp(state, cfg, col, n) {
    const h = heroOf(col);
    if (!h) return;
    h.xp = (h.xp || 0) + n;
    let lvl = 0;
    for (const x of cfg.hero.xpLevels) if (h.xp >= x) lvl++;
    if (lvl > (h.lvl || 1)) { h.lvl = lvl; addLog(state, `${cfg.hero.icon} Le héros de ${col.name} passe niveau ${lvl} !`, col.id); }
  }
  function heroDown(state, cfg, col) {
    const h = heroOf(col);
    if (!h) return;
    h.cell = null;
    h.down = state.tick + cfg.hero.respawnTicks;
    addLog(state, `${cfg.hero.icon} Le héros de ${col.name} est vaincu ; il rentre se soigner au nid.`, col.id);
  }

  // ---------- Garde royale ----------

  function guardMax(cfg, col) {
    const N = cfg.nest;
    const t = (col.stats && col.stats.territories) || 1;
    return Math.min(N.guardMax, N.guardBase + N.guardPerTerritory * t);
  }

  /** Renvoie l'état d'une case (owner = -1 pour neutre). Ne modifie pas l'état. */
  function getCell(state, world, cfg, id) {
    const c = state.cells[id];
    if (c) return c;
    return { owner: -1, w: wildGarrison(world, cfg, id), s: 0, e: 0, b: 0 };
  }

  /** Renvoie l'état modifiable d'une case (le crée si besoin). */
  function cellRef(state, world, cfg, id) {
    if (!state.cells[id]) state.cells[id] = { owner: -1, w: wildGarrison(world, cfg, id), s: 0, e: 0, b: 0 };
    return state.cells[id];
  }

  function owns(state, colonyId, id) {
    const c = state.cells[id];
    return !!c && c.owner === colonyId;
  }

  // ---------- Évolutions ----------

  function evoLevel(col, key) { return (col.evo && col.evo[key]) || 0; }

  /** Coût du prochain niveau d'une évolution (ou null si déjà au maximum). */
  function evoCost(cfg, col, key) {
    const e = cfg.evolutions.list[key];
    const lvl = evoLevel(col, key);
    if (!e || lvl >= cfg.evolutions.maxLevel) return null;
    return Math.round(e.cost * Math.pow(cfg.evolutions.costGrowth, lvl) * (1 + tpow(cfg, col, 'evo')));
  }

  /** Achète le niveau suivant d'une évolution. */
  function evolve(state, cfg, colonyId, key) {
    const col = state.colonies[colonyId];
    if (!cfg.evolutions.list[key]) return { ok: false, reason: 'Évolution inconnue.' };
    const cost = evoCost(cfg, col, key);
    if (cost == null) return { ok: false, reason: 'Niveau maximum atteint.' };
    if (col.food < cost) return { ok: false, reason: `Il faut ${cost} de nourriture.` };
    col.food -= cost;
    col.evo = col.evo || {};
    col.evo[key] = evoLevel(col, key) + 1;
    col.ctr = col.ctr || {};
    col.ctr.evo = (col.ctr.evo || 0) + 1;
    if (!col.isAI) addLog(state, `${col.name} évolue : ${cfg.evolutions.list[key].name} niveau ${col.evo[key]}.`, colonyId);
    return { ok: true };
  }

  // ---------- Saisons ----------

  /**
   * Saison vue depuis une latitude donnée (l'hémisphère sud est décalé de 2 saisons).
   * @returns {{index:number, name:string, factor:number, tropical:boolean, year:number}}
   */
  function seasonAt(tick, lat, cfg) {
    const s = cfg.seasons;
    const global = Math.floor(tick / s.lengthTicks);
    const year = Math.floor(global / 4) + 1;
    const tropical = Math.abs(lat) < s.tropicsLatitude;
    const index = (global + (lat < 0 ? 2 : 0)) % 4;
    return { index, name: s.names[index], factor: tropical ? 1 : s.foodFactor[index], tropical, year };
  }

  /** Facteur de saison pour une colonie (la champignonnière adoucit l'hiver). */
  function seasonFactor(state, cfg, col, lat) {
    const s = seasonAt(state.tick, lat, cfg);
    if (s.tropical || s.index !== 3) return s.factor;
    return Math.min(1, s.factor + evoLevel(col, 'fungus') * cfg.evolutions.list.fungus.effect);
  }

  // ---------- Récolte (micro-gestion) ----------

  /** Nombre idéal d'ouvrières sur une case. */
  function optimalWorkers(world, cfg, id) {
    return Math.max(1, Math.round(cfg.biomes[world.cells[id].biome].food * cfg.food.optimalWorkersPerFood));
  }

  /** Efficacité de récolte selon le nombre d'ouvrières (1 = idéal). */
  function workEfficiency(cfg, w, opt) {
    if (w <= 0) return 0;
    if (w <= opt) return w / opt;
    return 1 + cfg.food.overcrowdBonus * Math.log(w / opt);
  }

  /** Facteur logistique : plus une case est loin du nid, moins elle rapporte. */
  /** Distance (en cases) depuis un nid, mise en cache sur le monde (le monde ne change jamais). */
  function nestDistance(world, nest, id) {
    if (!world._nestDist) Object.defineProperty(world, '_nestDist', { value: {}, enumerable: false });
    const m = world._nestDist[nest] || (world._nestDist[nest] = {});
    let d = m[id];
    if (d === undefined) d = m[id] = world.distance(nest, id);
    return d;
  }

  function logistics(world, cfg, col, id) {
    if (!col.nest || !world.cells[col.nest]) return 0.5;
    const d = nestDistance(world, col.nest, id);
    const range = cfg.food.logisticsRange + evoLevel(col, 'trails') * cfg.evolutions.list.trails.effect;
    return 1 / (1 + Math.max(0, d - cfg.food.logisticsFree) / range);
  }

  /** Détail de la récolte d'une case de colonie (pour la simulation et l'interface). */
  function harvestInfo(state, world, cfg, col, id) {
    const c = state.cells[id];
    const cell = world.cells[id];
    const opt = optimalWorkers(world, cfg, id);
    const eff = workEfficiency(cfg, c.w || 0, opt);
    const logi = logistics(world, cfg, col, id);
    const season = seasonFactor(state, cfg, col, cell.lat);
    const bonus = 1 + evoLevel(col, 'harvest') * cfg.evolutions.list.harvest.effect;
    return { opt, eff, logi, season, food: cfg.biomes[cell.biome].food * eff * logi * season * bonus };
  }

  // ---------- Création du monde ----------

  /**
   * Crée un monde neuf, déjà en cours, peuplé de colonies IA.
   * Les joueurs humains le rejoignent ensuite avec joinColony.
   * @param {object} opts { seed, aiCount, era, now }
   */
  function createWorldState(world, cfg, opts) {
    opts = opts || {};
    const seed = (opts.seed >>> 0) || ((Math.random() * 2 ** 32) >>> 0);
    const state = {
      version: 4,
      /** Graine de la carte jardin (la carte se recalcule à partir d'elle). */
      mapSeed: opts.mapSeed == null ? (world.seed || 0) : opts.mapSeed,
      aiTarget: opts.aiCount == null ? cfg.ai.count : opts.aiCount,
      hall: [],
      unlockEvents: [],
      era: opts.era || 1,
      seed,
      rng: seed,
      tick: 0,
      /** Horodatage (ms) du tick 0 : le tick courant vaut (maintenant - startedAt) / durée d'un tick. */
      startedAt: opts.now || 0,
      phase: 'playing',
      landCount: world.ids.length,
      worldVersion: cfg.online.worldVersion,
      colonies: [],
      cells: {},
      moves: [],
      nextMoveId: 1,
      log: [],
      winner: -1,
      overTick: 0,
    };
    placeAIs(state, world, cfg, state.aiTarget);
    addLog(state, 'Un nouveau jardin est né.', -1);
    refreshStats(state, world, cfg);
    return state;
  }

  /**
   * Remet en forme un état relu depuis la base de données (Firebase supprime les tableaux
   * et objets vides) et met à niveau les mondes des versions précédentes.
   */
  function hydrate(state, cfg) {
    if (!state) return state;
    const cfg0 = cfg || DEFAULTS;
    state.colonies = toArray(state.colonies);
    state.moves = toArray(state.moves);
    state.log = toArray(state.log);
    state.hall = toArray(state.hall);
    state.unlockEvents = toArray(state.unlockEvents);
    state.cells = state.cells || {};
    if (state.aiTarget == null) state.aiTarget = state.colonies.filter((c) => c.isAI).length;
    for (const col of state.colonies) {
      if (col.nest === undefined) col.nest = null;
      col.stats = col.stats || {};
      if (col.uid === undefined) col.uid = null;
      col.evo = col.evo || {};
      col.caste = col.caste || 'balanced';
      col.layAcc = Object.assign(emptyGroup(), col.layAcc || {});
      if (col.autoWorkers === undefined) col.autoWorkers = true;
      col.missions = toArray(col.missions);
      col.ctr = col.ctr || {};
      col.unlocks = col.unlocks || {};
      col.score = col.score || 0;
      if (col.guard == null) col.guard = cfg0.nest.guardBase;
      ensureHero(state, cfg0, col);
    }
    for (const id in state.cells) {
      const c = state.cells[id];
      if ('ants' in c) { c.w = (c.w || 0) + c.ants; delete c.ants; } // version 2 : une seule caste
      c.w = c.w || 0; c.s = c.s || 0; c.e = c.e || 0; c.b = c.b || 0;
    }
    for (const m of state.moves) {
      if ('ants' in m) { m.w = (m.w || 0) + m.ants; delete m.ants; }
      m.w = m.w || 0; m.s = m.s || 0; m.e = m.e || 0; m.b = m.b || 0;
      if (!m.path) m.path = [m.from, m.to];
      if (!m.legs) m.legs = [0, m.arrive - m.depart];
      m.path = toArray(m.path);
      m.legs = toArray(m.legs);
    }
    if (state.winner == null) state.winner = -1;
    state.version = 4;
    return state;
  }

  /** Durée d'un tick en millisecondes. */
  function tickMs(cfg) { return cfg.time.tickSeconds * 1000; }

  /** La colonie dort-elle sous son bouclier d'absence ? */
  function asleep(state, cfg, col) {
    if (!col || col.isAI || !col.alive || !cfg.shield || !cfg.shield.enabled) return false;
    const seen = col.lastSeenTick != null ? col.lastSeenTick : (col.bornTick || 0);
    return state.tick - seen >= cfg.shield.afterTicks;
  }

  /** Réglages du mode en ligne : le même jeu, mais le temps passe online.slowdown fois moins vite. */
  function onlineConfig(cfg) {
    if (cfg._online) return cfg;
    const out = Object.assign({}, cfg, { time: Object.assign({}, cfg.time) });
    out.time.tickSeconds = cfg.time.tickSeconds * (cfg.online.slowdown || 1);
    out.shield = Object.assign({}, cfg.shield, { enabled: true });
    Object.defineProperty(out, '_online', { value: true });
    return out;
  }

  /** Nombre de ticks que le monde doit avoir atteint à l'instant « now » (ms). */
  function tickAt(state, cfg, now) {
    return Math.floor((now - state.startedAt) / tickMs(cfg));
  }

  function toArray(x) {
    if (!x) return [];
    if (Array.isArray(x)) return x.filter((v) => v != null);
    return Object.keys(x).sort((a, b) => a - b).map((k) => x[k]).filter((v) => v != null);
  }

  function newColony(id, name, color, isAI, cfg, uid) {
    return {
      id, name, color, isAI,
      uid: uid || null,
      food: cfg.start.food,
      queenAlive: true,
      nest: null,
      layMode: 'normal',
      caste: 'balanced',
      layProgress: 0,
      layAcc: emptyGroup(),
      evo: {},
      autoWorkers: true,
      score: 0,
      missions: [],
      /** Compteurs pour les missions (cases prises, évolutions achetées, temps passé sur le scarabée…). */
      ctr: {},
      /** Combattants spéciaux débloqués (gardés d'une colonie à l'autre pour un même joueur). */
      unlocks: {},
      /** Garde royale du nid (se régénère, voir cfg.nest). */
      guard: cfg.nest.guardBase,
      alive: true,
      stats: {},
    };
  }

  function startGarrison(cfg) {
    const g = cfg.start.startCastes;
    return { w: g.w, s: g.s, e: g.e, b: 0 };
  }

  function addLog(state, text, colony) {
    state.log.push({ tick: state.tick, text, colony: colony == null ? -1 : colony });
    if (state.log.length > 60) state.log.splice(0, state.log.length - 60);
  }

  /** Une case est libre si personne ne la possède. */
  function isFree(state, id) {
    const c = state.cells[id];
    return !c || c.owner === -1;
  }

  /** Colonie vivante d'un joueur (ou null). */
  function colonyOf(state, uid) {
    if (!uid) return null;
    for (const c of state.colonies) if (c.uid === uid && c.alive) return c;
    return null;
  }

  /** Vérifie qu'une case peut accueillir un nouveau nid. */
  function canFound(state, world, cfg, id) {
    if (state.phase !== 'playing') return { ok: false, reason: 'Le monde redémarre bientôt.' };
    if (!world.cells[id]) return { ok: false, reason: 'Choisis une case libre (pas une flaque ni un caillou).' };
    if (!isFree(state, id)) return { ok: false, reason: 'Cette case est déjà occupée.' };
    if (treasureAt(world, id)) return { ok: false, reason: 'Impossible de fonder un nid sur un trésor.' };
    const d = cfg.start.minNestDistance;
    for (const k in state.cells) {
      if (state.cells[k].owner >= 0 && world.distance(id, k) < d) {
        return { ok: false, reason: `Trop près d'une autre colonie (minimum ${d} cases).` };
      }
    }
    return { ok: true };
  }

  /**
   * Un joueur fonde sa colonie : la reine et toutes les fourmiz de départ sur la case choisie.
   * @param {object} who { uid, name, unlocks }
   */
  function joinColony(state, world, cfg, who, id) {
    if (colonyOf(state, who.uid)) return { ok: false, reason: 'Tu as déjà une colonie dans ce monde.' };
    const can = canFound(state, world, cfg, id);
    if (!can.ok) return can;
    const humans = state.colonies.filter((c) => !c.isAI).length;
    const palette = cfg.colors.players;
    const name = cleanName(who.name, cfg) || 'Colonie ' + (humans + 1);
    const col = newColony(state.colonies.length, name, palette[humans % palette.length], false, cfg, who.uid);
    col.bornTick = state.tick;
    col.nest = id;
    if (who.unlocks) for (const k in who.unlocks) if (who.unlocks[k] === true) col.unlocks[k] = true;
    ensureHero(state, cfg, col);
    state.colonies.push(col);
    state.cells[id] = Object.assign({ owner: col.id }, startGarrison(cfg));
    refreshStats(state, world, cfg);
    for (let i = 0; i < cfg.missions.slots; i++) col.missions.push(newMission(state, world, cfg, col));
    addLog(state, `${col.name} fonde sa colonie.`, col.id);
    refreshStats(state, world, cfg);
    return { ok: true, colony: col };
  }

  function cleanName(name, cfg) {
    const max = (cfg.online && cfg.online.maxNameLength) || 24;
    return String(name || '').replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, max);
  }

  function placeAIs(state, world, cfg, n) {
    const taken = Object.keys(state.cells).filter((id) => state.cells[id].owner >= 0);
    const minD = cfg.start.minNestDistance * 2;
    const goodBiomes = ['grass', 'moss', 'leaves', 'flowers', 'dirt'];
    const already = state.colonies.filter((c) => c.isAI).length;
    for (let i = 0; i < n; i++) {
      let chosen = null;
      for (let attempt = 0; attempt < 400 && !chosen; attempt++) {
        const id = world.ids[Math.floor(rand(state) * world.ids.length)];
        if (!isFree(state, id) || treasureAt(world, id)) continue;
        if (attempt < 300 && goodBiomes.indexOf(world.cells[id].biome) < 0) continue;
        const d = attempt < 300 ? minD : cfg.start.minNestDistance;
        let ok = true;
        for (const t of taken) {
          if (world.distance(id, t) < d) { ok = false; break; }
        }
        if (ok) chosen = id;
      }
      if (!chosen) continue;
      const idx = state.colonies.length;
      const k = (state.aiBorn || already) + i;
      const gen = Math.floor(k / cfg.ai.names.length);
      const aiName = cfg.ai.names[k % cfg.ai.names.length] + (gen ? ' ' + ['II', 'III', 'IV', 'V', 'VI'][Math.min(gen - 1, 4)] : '');
      const col = newColony(idx, aiName, cfg.colors.ai[k % cfg.colors.ai.length], true, cfg);
      col.nest = chosen;
      state.colonies.push(col);
      state.cells[chosen] = Object.assign({ owner: idx }, startGarrison(cfg));
      taken.push(chosen);
      state.aiBorn = k + 1;
      if (state.tick > 0) addLog(state, `Une nouvelle colonie sauvage s'installe : ${col.name}.`, idx);
    }
  }

  /**
   * Applique l'ordre d'un joueur. C'est la seule porte d'entrée pour les joueurs :
   * le serveur l'utilise pour valider tout ce que les navigateurs envoient.
   * @param {object} order { uid, type: 'join'|'send'|'lay'|'caste'|'queen'|'rally'|'evolve', ... }
   * @returns {{ok:boolean, reason?:string}}
   */
  function applyOrder(state, world, cfg, order) {
    if (!order || !order.uid) return { ok: false, reason: 'Ordre invalide.' };
    if (order.type === 'join') return joinColony(state, world, cfg, { uid: order.uid, name: order.name, unlocks: order.unlocks }, String(order.cell));
    const col = colonyOf(state, order.uid);
    if (!col) return { ok: false, reason: 'Tu n’as pas de colonie dans ce monde.' };
    const wasAsleep = asleep(state, cfg, col);
    col.lastSeenTick = state.tick; // tout ordre (même un simple « ping ») réveille la colonie
    if (wasAsleep) addLog(state, `${col.name} se réveille.`, col.id);
    let r;
    if (order.type === 'ping') return { ok: true };
    if (order.type === 'send') {
      let g;
      if (order.ants != null && order.w == null) {
        // Ancien format : un nombre total, réparti proportionnellement
        const c = state.cells[String(order.from)];
        g = c ? scaleGroup(c, Math.min(1, (Number(order.ants) || 0) / Math.max(1, total(c))), true) : emptyGroup();
      } else {
        g = { w: Number(order.w) || 0, s: Number(order.s) || 0, e: Number(order.e) || 0, b: Number(order.b) || 0 };
      }
      r = sendAnts(state, world, cfg, col.id, String(order.from), String(order.to), g, !!order.hero);
    } else if (order.type === 'hero') {
      const h = heroOf(col);
      if (!h || h.down || !h.cell) r = { ok: false, reason: h && h.down ? 'Ton héros se soigne au nid.' : 'Ton héros est déjà en route.' };
      else r = sendAnts(state, world, cfg, col.id, h.cell, String(order.to), emptyGroup(), true);
    } else if (order.type === 'lay') r = setLayMode(state, cfg, col.id, String(order.mode));
    else if (order.type === 'caste') r = setCaste(state, cfg, col.id, String(order.preset));
    else if (order.type === 'rally') r = rally(state, world, cfg, col.id, String(order.cell));
    else if (order.type === 'evolve') r = evolve(state, cfg, col.id, String(order.key));
    else if (order.type === 'auto') { col.autoWorkers = !!order.on; r = { ok: true }; }
    else return { ok: false, reason: 'Ordre inconnu.' };
    refreshStats(state, world, cfg);
    return r;
  }

  // ---------- Déplacements ----------

  /** Durée d'un pas vers une case (terrain d'arrivée, galeries, évolution « Galeries »). */
  function stepTicks(world, cfg, to, tunnel, col) {
    let t = cfg.movement.baseTravelTicks * cfg.biomes[world.cells[to].biome].travel * (tunnel ? cfg.movement.tunnelFactor : 1);
    if (col) t *= Math.max(0.2, 1 - evoLevel(col, 'tunnels') * cfg.evolutions.list.tunnels.effect);
    return Math.max(1, Math.round(t));
  }

  /** Durée d'un trajet direct vers une case voisine. */
  function travelTicks(world, cfg, to) {
    return stepTicks(world, cfg, to, false, null);
  }

  /** Vitesse d'un groupe : celle de sa caste la plus lente. */
  function groupSpeed(cfg, g) {
    let sp = 0;
    for (const k of CASTES) if ((g[k] || 0) > 0) sp = Math.max(sp, cfg.castes[k].speed);
    return sp || 1;
  }

  /**
   * Plus court chemin d'une case à soi vers une case cible, en passant uniquement par ses propres cases
   * (les galeries). La cible peut être à soi (renfort) ou toucher son territoire (attaque, expansion).
   * @returns {{ok:boolean, reason?:string, path?:string[]}}
   */
  function findPath(state, world, cfg, colonyId, from, to) {
    if (!owns(state, colonyId, from)) return { ok: false, reason: 'Cette case ne t’appartient pas.' };
    if (!world.cells[to]) return { ok: false, reason: 'Case invalide.' };
    if (from === to) return { ok: false, reason: 'Choisis une autre case.' };
    const max = cfg.movement.maxPathLength;
    const prev = { [from]: null };
    const depth = { [from]: 0 };
    const queue = [from];
    for (let qi = 0; qi < queue.length; qi++) {
      const cur = queue[qi];
      if (depth[cur] >= max) continue;
      for (const nb of world.neighbors(cur)) {
        if (nb in prev) continue;
        if (nb === to) {
          prev[nb] = cur;
          const path = [nb];
          for (let x = cur; x != null; x = prev[x]) path.push(x);
          return { ok: true, path: path.reverse() };
        }
        if (!owns(state, colonyId, nb)) continue;
        prev[nb] = cur;
        depth[nb] = depth[cur] + 1;
        queue.push(nb);
      }
    }
    // Pas de chemin par les galeries : expédition. On part de la case de son réseau la plus proche
    // de la cible, puis on traverse terres inconnues ou mers (radeaux de fourmiz) en ligne droite.
    let best = null, bestD = Infinity;
    for (const id of queue) {
      const d = world.distance(id, to);
      if (d < bestD) { bestD = d; best = id; }
    }
    const path = [to];
    for (let x = best; x != null; x = prev[x]) path.push(x);
    return { ok: true, path: path.reverse(), jump: Math.max(1, Math.round(bestD)) };
  }

  /** Durées cumulées (en ticks) pour atteindre chaque case d'un chemin. */
  function pathLegs(state, world, cfg, colonyId, path, g) {
    const col = state.colonies[colonyId];
    const speed = g ? groupSpeed(cfg, g) : 1;
    const legs = [0];
    for (let i = 1; i < path.length; i++) {
      const tunnel = owns(state, colonyId, path[i]);
      const cells = Math.max(1, world.distance(path[i - 1], path[i])); // > 1 pour le saut d'une expédition
      const factor = cells > 1.5 ? cfg.movement.expeditionFactor : 1;
      legs.push(legs[i - 1] + Math.max(1, Math.round(stepTicks(world, cfg, path[i], tunnel, col) * speed * cells * factor)));
    }
    return legs;
  }

  /** Longueur d'un chemin en cases (le saut d'une expédition compte pour sa distance). */
  function pathCells(world, path) {
    let n = 0;
    for (let i = 1; i < path.length; i++) n += Math.max(1, Math.round(world.distance(path[i - 1], path[i])));
    return n;
  }

  function launch(state, world, cfg, colonyId, path, g, withHero) {
    const src = state.cells[path[0]];
    for (const k of CASTES) src[k] -= g[k] || 0;
    const legs = pathLegs(state, world, cfg, colonyId, path, g);
    const move = {
      id: state.nextMoveId++, owner: colonyId, from: path[0], to: path[path.length - 1],
      w: g.w || 0, s: g.s || 0, e: g.e || 0,
      depart: state.tick, arrive: state.tick + legs[legs.length - 1], path, legs, dist: pathCells(world, path),
    };
    if (withHero) {
      move.h = 1;
      const h = heroOf(state.colonies[colonyId]);
      if (h) h.cell = null; // le héros est en route
    }
    state.moves.push(move);
    return move;
  }

  /**
   * Envoie un groupe de fourmiz { w, s, e } d'une case vers une autre : une voisine, ou n'importe quelle
   * case atteignable par ses galeries (renfort lointain, attaque à la frontière).
   * @returns {{ok:boolean, reason?:string, move?:object}}
   */
  function sendAnts(state, world, cfg, colonyId, from, to, g, withHero) {
    if (state.phase !== 'playing') return { ok: false, reason: 'La partie n’est pas en cours.' };
    const src = state.cells[from];
    if (!src || src.owner !== colonyId) return { ok: false, reason: 'Cette case ne t’appartient pas.' };
    const grp = {};
    for (const k of CASTES) grp[k] = Math.max(0, Math.min(src[k] || 0, Math.floor(Number(g[k]) || 0)));
    const col = state.colonies[colonyId];
    withHero = !!withHero && heroAt(col, from);
    if (total(grp) < 1 && !withHero) return { ok: false, reason: 'Pas assez de fourmiz.' };
    const target = state.cells[to];
    if (target && target.owner >= 0 && target.owner !== colonyId && asleep(state, cfg, state.colonies[target.owner])) {
      return { ok: false, reason: '🛡️ Cette colonie dort sous son bouclier : impossible de l’attaquer.' };
    }
    const p = findPath(state, world, cfg, colonyId, from, to);
    if (!p.ok) return p;
    return { ok: true, move: launch(state, world, cfg, colonyId, p.path, grp, withHero) };
  }

  /**
   * « Rassembler ici » : chaque case de la colonie envoie ses fourmiz en trop vers la case choisie,
   * par les galeries. Elle garde ses ouvrières utiles (jusqu'au nombre idéal) pour continuer à récolter.
   * @returns {{ok:boolean, reason?:string, count?:number, ants?:number}}
   */
  function rally(state, world, cfg, colonyId, target) {
    if (state.phase !== 'playing') return { ok: false, reason: 'La partie n’est pas en cours.' };
    if (!owns(state, colonyId, target)) return { ok: false, reason: 'Choisis une de tes cases.' };
    const max = cfg.movement.maxPathLength;
    const next = { [target]: null };
    const depth = { [target]: 0 };
    const queue = [target];
    for (let qi = 0; qi < queue.length; qi++) {
      const cur = queue[qi];
      if (depth[cur] >= max) continue;
      for (const nb of world.neighbors(cur)) {
        if (nb in next || !owns(state, colonyId, nb)) continue;
        next[nb] = cur;
        depth[nb] = depth[cur] + 1;
        queue.push(nb);
      }
    }
    const spare = (id) => {
      const c = state.cells[id];
      const keepW = Math.min(c.w, Math.max(cfg.movement.rallyKeep, optimalWorkers(world, cfg, id)));
      return { w: c.w - keepW, s: c.s, e: c.e };
    };
    const sources = queue.slice(1).map((id) => ({ id, g: spare(id) })).filter((x) => total(x.g) > 0)
      .sort((a, b) => total(b.g) - total(a.g))
      .slice(0, cfg.movement.rallyMaxSources);
    let count = 0, sent = 0;
    for (const { id, g } of sources) {
      const path = [];
      for (let x = id; x != null; x = next[x]) path.push(x);
      launch(state, world, cfg, colonyId, path, g);
      count++;
      sent += total(g);
    }
    if (!count) return { ok: false, reason: 'Aucune fourmi en trop à rassembler.' };
    return { ok: true, count, ants: sent };
  }

  /** Change le mode de ponte de la reine (stop / normal / intense). */
  function setLayMode(state, cfg, colonyId, mode) {
    if (!cfg.queen.layModes[mode]) return { ok: false, reason: 'Mode inconnu.' };
    state.colonies[colonyId].layMode = mode;
    return { ok: true };
  }

  /** Change la répartition des castes pondues. */
  function setCaste(state, cfg, colonyId, preset) {
    if (!cfg.castePresets[preset]) return { ok: false, reason: 'Répartition inconnue.' };
    state.colonies[colonyId].caste = preset;
    return { ok: true };
  }

  // ---------- Combat (micro-gestion tactique) ----------

  /** Multiplicateur de défense d'une case (biome, nid, proximité du nid, carapace). */
  function defenseFactor(state, world, cfg, id, owner) {
    const biome = cfg.biomes[world.cells[id].biome];
    if (owner < 0) return biome.defense;
    const col = state.colonies[owner];
    let f = cfg.combat.defenderBonus * biome.defense;
    if (col.queenAlive && col.nest === id) f *= cfg.combat.nestBonus;
    else if (col.queenAlive && col.nest && world.cells[col.nest] && nestDistance(world, col.nest, id) <= cfg.combat.nestAreaRadius + 0.5) f *= cfg.combat.nestAreaBonus;
    f *= 1 + evoLevel(col, 'shell') * cfg.evolutions.list.shell.effect;
    f *= 1 + tpow(cfg, col, 'force');
    return f;
  }

  /** Nombre de cases de l'attaquant qui touchent la cible. */
  function encircling(state, world, colonyId, id) {
    let n = 0;
    for (const nb of world.neighbors(id)) if (owns(state, colonyId, nb)) n++;
    return n;
  }

  /**
   * Multiplicateur d'attaque : mâchoires, encerclement, fatigue du trajet.
   * @returns {{factor:number, encircle:number, fatigue:number, sides:number}}
   */
  function attackFactor(state, world, cfg, colonyId, to, steps, g) {
    const col = state.colonies[colonyId];
    const c = cfg.combat;
    const sides = encircling(state, world, colonyId, to);
    const encircle = Math.min(c.encircleMax, 1 + c.encircleBonus * Math.max(0, sides - 1));
    const scoutsOnly = g && total(g) > 0 && total(g) === (g.e || 0);
    const fatigue = scoutsOnly ? 1 : Math.max(c.fatigueMin, 1 - c.fatiguePerStep * Math.max(0, steps - c.fatigueFree));
    const jaws = (1 + evoLevel(col, 'jaws') * cfg.evolutions.list.jaws.effect) * (1 + tpow(cfg, col, 'force'));
    return { factor: jaws * encircle * fatigue, encircle, fatigue, sides };
  }

  /**
   * Résout un combat par la loi de Lanchester au carré, sur des forces.
   * @returns {{attackerWins:boolean, ratio:number}} ratio = part des survivants du vainqueur
   */
  function resolveCombat(attack, defense) {
    if (attack > defense) return { attackerWins: true, ratio: Math.sqrt(attack * attack - defense * defense) / attack };
    if (defense <= 0) return { attackerWins: false, ratio: 0 };
    return { attackerWins: false, ratio: Math.sqrt(defense * defense - attack * attack) / defense };
  }

  /** Force (pondérée) de la défense d'une case. */
  function defensePower(state, world, cfg, id) {
    const c = getCell(state, world, cfg, id);
    const col = c.owner >= 0 ? state.colonies[c.owner] : null;
    return defenseRaw(cfg, c, col, id) * defenseFactor(state, world, cfg, id, c.owner);
  }

  /** Force brute de la défense d'une case : fourmiz + garde royale (nid) + héros, avant les bonus de terrain. */
  function defenseRaw(cfg, c, col, id) {
    let p = power(c, cfg, col);
    if (col && col.queenAlive && col.nest === id) p += col.guard || 0;
    if (col && heroAt(col, id)) p = (p + heroPower(cfg, col.hero)) * heroBoost(cfg, col.hero);
    return p;
  }

  /** Force brute d'un groupe en attaque, héros compris (g.h = 1 si le héros l'accompagne). */
  function attackRaw(cfg, g, col, vsWild) {
    let p = power(g, cfg, col, vsWild);
    const h = g && g.h ? heroOf(col) : null;
    if (h) p = (p + heroPower(cfg, h)) * heroBoost(cfg, h);
    return p;
  }

  /** Estimation (pour l'IA et l'interface) de la force brute nécessaire pour prendre une case. */
  function forceNeeded(state, world, cfg, id) {
    return Math.floor(defensePower(state, world, cfg, id)) + 1;
  }

  /**
   * Aperçu d'une attaque avant de l'envoyer : force de l'attaque (avec bonus) contre force de la défense.
   * @returns {{attack:number, defense:number, win:boolean, encircle:number, fatigue:number, sides:number}}
   */
  function attackPreview(state, world, cfg, colonyId, path, g) {
    const to = path[path.length - 1];
    const f = attackFactor(state, world, cfg, colonyId, to, pathCells(world, path), g);
    const wild = getCell(state, world, cfg, to).owner < 0;
    const attack = attackRaw(cfg, g, state.colonies[colonyId], wild) * f.factor;
    const defense = defensePower(state, world, cfg, to);
    return Object.assign({ attack, defense, win: attack > defense }, f);
  }

  function arrive(state, world, cfg, move) {
    const cell = cellRef(state, world, cfg, move.to);
    const atk = state.colonies[move.owner];
    if (cell.owner === move.owner) {
      for (const k of CASTES) cell[k] += move[k] || 0;
      if (move.h && heroOf(atk)) atk.hero.cell = move.to;
      return;
    }
    const defOwner = cell.owner;
    const def = defOwner >= 0 ? state.colonies[defOwner] : null;
    if (def && asleep(state, cfg, def)) {
      // Bouclier : l'attaque rebondit, les fourmiz rentrent à leur case de départ (si elle est encore à elles).
      const home = state.cells[move.from];
      if (home && home.owner === move.owner) for (const k of CASTES) home[k] += move[k] || 0;
      if (move.h && heroOf(atk)) atk.hero.cell = home && home.owner === move.owner ? move.from : atk.nest;
      if (!atk.isAI) addLog(state, `🛡️ L'attaque de ${atk.name} rebondit sur le bouclier de ${def.name}.`, move.owner);
      return;
    }
    const steps = move.dist || (move.path || [0, 0]).length - 1;
    const attack = attackRaw(cfg, move, atk, defOwner < 0) * attackFactor(state, world, cfg, move.owner, move.to, steps, move).factor;
    const defense = defenseRaw(cfg, cell, def, move.to) * defenseFactor(state, world, cfg, move.to, defOwner);
    const r = resolveCombat(attack, defense);
    const defHero = def && heroAt(def, move.to);
    const atNest = def && def.queenAlive && def.nest === move.to;
    const defName = defOwner < 0 ? 'les insectes sauvages' : def.name;
    if (r.attackerWins) {
      const surv = scaleGroup(move, r.ratio, true);
      cell.owner = move.owner;
      cell.w = surv.w; cell.s = surv.s; cell.e = surv.e; cell.b = surv.b;
      atk.ctr = atk.ctr || {};
      if (def) { atk.ctr.enemy = (atk.ctr.enemy || 0) + 1; atk.score = (atk.score || 0) + cfg.score.perEnemyCapture; }
      else { atk.ctr.wild = (atk.ctr.wild || 0) + 1; atk.score = (atk.score || 0) + cfg.score.perWildCapture; }
      if (move.h && heroOf(atk)) { atk.hero.cell = move.to; heroXp(state, cfg, atk, def ? 2 : 1); }
      if (defHero) heroDown(state, cfg, def);
      if (atNest) def.guard = 0;
      const t = treasureAt(world, move.to);
      if (t) addLog(state, `${atk.name} s'empare du trésor ${cfg.treasures.types[t].icon} ${cfg.treasures.types[t].name} !`, move.owner);
      if (def) {
        if (def.nest === move.to && def.queenAlive) {
          def.queenAlive = false;
          def.nest = null;
          addLog(state, `${atk.name} a pris le nid de ${def.name} : leur reine est morte, la colonie disparaît !`, move.owner);
        } else if (!atk.isAI || !def.isAI) {
          addLog(state, `${atk.name} a pris une case à ${defName}.`, move.owner);
        }
      }
    } else {
      const surv = scaleGroup(cell, r.ratio, false);
      cell.w = surv.w; cell.s = surv.s; cell.e = surv.e; cell.b = surv.b;
      if (move.h) heroDown(state, cfg, atk);
      if (defHero) heroXp(state, cfg, def, 1);
      if (atNest) def.guard = (def.guard || 0) * r.ratio;
      if (!atk.isAI || (def && !def.isAI)) {
        addLog(state, `Attaque de ${atk.name} repoussée par ${defName}.`, def ? defOwner : move.owner);
      }
    }
  }

  // ---------- Boucle de simulation ----------

  /** Recalcule les statistiques de chaque colonie (territoires, castes, revenus, dépenses). */
  function refreshStats(state, world, cfg) {
    const K = cfg.castes;
    const north = 45, south = -45, tropic = 0; // latitudes représentatives des trois zones de saison
    const per = [];
    for (const col of state.colonies) {
      col.stats = { territories: 0, ants: 0, w: 0, s: 0, e: 0, b: 0, power: 0, income: 0, tfood: 0, upkeep: 0, layCost: 0, layRate: 0, spoil: 0, net: 0, cap: 0, idle: 0, missing: 0, points: 0, biomes: {}, treasures: {} };
      per[col.id] = {
        seasonN: seasonFactor(state, cfg, col, north), seasonS: seasonFactor(state, cfg, col, south), seasonT: seasonFactor(state, cfg, col, tropic),
        bonus: 1 + evoLevel(col, 'harvest') * cfg.evolutions.list.harvest.effect,
      };
    }
    const tropics = cfg.seasons.tropicsLatitude;
    for (const id in state.cells) {
      const c = state.cells[id];
      if (c.owner < 0) continue;
      const col = state.colonies[c.owner];
      const s = col.stats;
      s.territories++;
      s.w += c.w; s.s += c.s; s.e += c.e; s.b += c.b || 0;
      const bio = world.cells[id].biome;
      s.biomes[bio] = (s.biomes[bio] || 0) + 1;
      const tr = treasureAt(world, id);
      if (tr) {
        const T = cfg.treasures.types[tr];
        s.treasures[tr] = (s.treasures[tr] || 0) + 1;
        s.tfood += T.food;
        s.points += T.points;
      }
      const opt = optimalWorkers(world, cfg, id);
      if (c.w > opt) s.idle += c.w - opt; else s.missing += opt - c.w;
      if (c.w > 0) {
        const cell = world.cells[id];
        const P = per[col.id];
        const season = Math.abs(cell.lat) < tropics ? P.seasonT : cell.lat < 0 ? P.seasonS : P.seasonN;
        s.income += cfg.biomes[cell.biome].food * workEfficiency(cfg, c.w, opt) * logistics(world, cfg, col, id) * season * P.bonus;
      }
    }
    for (const m of state.moves) {
      const s = state.colonies[m.owner].stats;
      s.w += m.w; s.s += m.s; s.e += m.e; s.b += m.b || 0;
    }
    for (const col of state.colonies) {
      const s = col.stats;
      s.ants = s.w + s.s + s.e + s.b;
      s.power = power(s, cfg, col);
      s.income = s.income * (1 + tpow(cfg, col, 'harvest')) + s.tfood;
      s.upkeep = (s.w * K.w.upkeep + s.s * K.s.upkeep + s.e * K.e.upkeep + s.b * K.b.upkeep) * (1 + tpow(cfg, col, 'upkeep'));
      const granary = evoLevel(col, 'granary');
      s.cap = (cfg.food.storageBase + cfg.food.storagePerTerritory * s.territories) * (1 + granary * cfg.evolutions.list.granary.effect) * (1 + tpow(cfg, col, 'storage'));
      s.guardMax = guardMax(cfg, col);
      s.layRate = layRate(state, world, cfg, col);
      s.layCost = s.layRate * eggCost(cfg, col) * cfg.queen.layModes[col.layMode].cost;
      s.spoil = winterSpoil(state, world, cfg, col);
      s.net = s.income - s.upkeep - s.layCost - s.spoil;
    }
  }

  /**
   * Répartition automatique des ouvrières : sur chaque paire de cases voisines d'une colonie,
   * les ouvrières en trop (au-delà du nombre idéal) glissent vers la case qui en manque le plus.
   * De proche en proche, le surplus traverse le territoire jusqu'aux cases sous-exploitées.
   */
  function autoBalanceWorkers(state, world, cfg) {
    const ex = {};
    for (const id in state.cells) {
      const c = state.cells[id];
      if (c.owner < 0 || state.colonies[c.owner].autoWorkers === false || asleep(state, cfg, state.colonies[c.owner])) continue;
      ex[id] = c.w - optimalWorkers(world, cfg, id);
    }
    for (const id in ex) {
      const c = state.cells[id];
      if (ex[id] <= 0) continue;
      let best = null, bestEx = ex[id] - 1;
      for (const nb of world.neighbors(id)) {
        if (ex[nb] === undefined || state.cells[nb].owner !== c.owner) continue;
        if (ex[nb] < bestEx) { bestEx = ex[nb]; best = nb; }
      }
      if (!best) continue;
      const n = Math.min(Math.floor((ex[id] - ex[best]) / 2), c.w);
      if (n < 1) continue;
      c.w -= n; state.cells[best].w += n;
      ex[id] -= n; ex[best] += n;
    }
  }

  /** Coût moyen d'un œuf selon la répartition des castes choisie. */
  function eggCost(cfg, col) {
    const mix = mixFor(cfg, col);
    return CASTES.reduce((t, k) => t + (mix[k] || 0) * cfg.castes[k].cost, 0);
  }

  /** Répartition de ponte effective : celle choisie, plus les combattants spéciaux débloqués. */
  function mixFor(cfg, col) {
    const base = cfg.castePresets[col.caste || 'balanced'].mix;
    const out = { w: base.w || 0, s: base.s || 0, e: base.e || 0, b: 0 };
    const B = cfg.castes.b;
    if (col.unlocks && col.unlocks[B.unlock] && (out.s > 0.3)) {
      out.b = B.layShare;
      out.s -= B.layShare;
    }
    return out;
  }

  /** Nourriture qui se gâte en hiver (réduite par les greniers). */
  function winterSpoil(state, world, cfg, col) {
    if (!col.nest || !world.cells[col.nest]) return 0;
    const s = seasonAt(state.tick, world.cells[col.nest].lat, cfg);
    if (s.tropical || s.index !== 3) return 0;
    const reduce = Math.pow(0.65, evoLevel(col, 'granary'));
    return Math.max(0, col.food) * cfg.food.winterSpoil * reduce;
  }

  /** Fourmiz pondues par tick par la reine d'une colonie. */
  function layRate(state, world, cfg, col) {
    if (!col.queenAlive || col.nest == null || !col.alive) return 0;
    const q = cfg.queen;
    let rate = Math.min(q.maxLayRate, q.baseLayRate + q.layRatePerTerritory * col.stats.territories);
    rate *= q.layModes[col.layMode].rate;
    rate *= 1 + evoLevel(col, 'fertility') * cfg.evolutions.list.fertility.effect;
    rate *= 1 + tpow(cfg, col, 'lay');
    const season = seasonAt(state.tick, world.cells[col.nest].lat, cfg);
    if (!season.tropical && season.index === 3) rate *= q.winterLayFactor;
    return rate;
  }

  /** Choisit la caste du prochain œuf pour respecter la répartition demandée. */
  function nextCaste(cfg, col) {
    const mix = mixFor(cfg, col);
    const acc = col.layAcc || (col.layAcc = emptyGroup());
    for (const k of CASTES) acc[k] = (acc[k] || 0) + (mix[k] || 0);
    let best = 'w';
    for (const k of CASTES) if (acc[k] > acc[best]) best = k;
    acc[best] -= 1;
    return best;
  }

  /** Avance la simulation d'un tick. */
  function step(state, world, cfg) {
    if (state.phase !== 'playing') return;
    state.tick++;

    // 1. Déplacements arrivés
    const still = [];
    for (const m of state.moves) {
      if (m.arrive <= state.tick) arrive(state, world, cfg, m);
      else still.push(m);
    }
    state.moves = still;

    // Les statistiques du tick précédent suffisent pour l'économie (un seul recalcul par tick, à la fin)
    if (!state.colonies.length || !state.colonies[0].stats || state.colonies[0].stats.cap === undefined) refreshStats(state, world, cfg);

    // Répartition automatique des ouvrières (toutes les autoEvery ticks)
    if (state.tick % cfg.food.autoEvery === 0) autoBalanceWorkers(state, world, cfg);

    // 2. Économie de chaque colonie
    for (const col of state.colonies) {
      if (!col.alive || asleep(state, cfg, col)) continue; // colonie endormie : économie gelée
      const s = col.stats;
      col.food += s.income - s.upkeep - s.spoil;

      // Garde royale : se régénère jusqu'à son maximum
      const gm = s.guardMax || guardMax(cfg, col);
      col.guard = Math.min(gm, (col.guard || 0) + gm * cfg.nest.regen);

      // Héros : retour au nid après une défaite, ou si sa case a été perdue
      const h = heroOf(col);
      if (h) {
        if (h.down && state.tick >= h.down && col.nest) {
          h.down = 0; h.cell = col.nest;
          addLog(state, `${cfg.hero.icon} Le héros de ${col.name} est de retour au nid.`, col.id);
        } else if (!h.down && h.cell && (!state.cells[h.cell] || state.cells[h.cell].owner !== col.id)) {
          h.cell = col.nest;
        } else if (!h.down && !h.cell && !state.moves.some((m) => m.h && m.owner === col.id)) {
          h.cell = col.nest; // sécurité : héros perdu en route
        }
      }

      // Le nid perdu (case prise) => plus de reine
      if (col.queenAlive && col.nest && (!state.cells[col.nest] || state.cells[col.nest].owner !== col.id)) {
        col.queenAlive = false;
        col.nest = null;
      }

      // Ponte : chaque œuf coûte de la nourriture selon sa caste
      if (s.layRate > 0 && col.queenAlive && col.nest) {
        const mode = cfg.queen.layModes[col.layMode];
        col.layProgress += s.layRate;
        while (col.layProgress >= 1) {
          const k = nextCaste(cfg, col);
          const cost = cfg.castes[k].cost * mode.cost;
          if (col.food < cost) { col.layAcc[k] += 1; break; }
          col.layProgress -= 1;
          col.food -= cost;
          state.cells[col.nest][k] += 1;
        }
        if (col.layProgress > 1) col.layProgress = 1; // pas de stock de ponte sans nourriture
      }

      // Famine : les soldates meurent en premier (elles mangent le plus)
      if (col.food < 0) {
        col.food = 0;
        let dead = 0;
        for (const id in state.cells) {
          const c = state.cells[id];
          if (c.owner !== col.id) continue;
          for (const k of ['s', 'e', 'w']) {
            if (c[k] <= 0) continue;
            const exact = c[k] * cfg.food.starvationRate;
            const loss = Math.min(c[k], Math.floor(exact) + (rand(state) < exact - Math.floor(exact) ? 1 : 0));
            c[k] -= loss;
            dead += loss;
          }
        }
        if (dead > 0 && !col.isAI && state.tick % 50 === 0) addLog(state, `Famine chez ${col.name} !`, col.id);
      }
      col.food = Math.min(col.food, s.cap);

      // Le nid perdu (case prise) => plus de reine
      if (col.queenAlive && col.nest && (!state.cells[col.nest] || state.cells[col.nest].owner !== col.id)) {
        col.queenAlive = false;
        col.nest = null;
      }
    }

    refreshStats(state, world, cfg);

    // 3. Trésors (points) et missions
    for (const col of state.colonies) {
      if (!col.alive || asleep(state, cfg, col)) continue;
      col.score = (col.score || 0) + col.stats.points;
    }
    trackBeetle(state, world, cfg);
    if (state.tick % cfg.missions.checkEvery === 0) checkMissions(state, world, cfg);

    checkEliminations(state, world, cfg);
    // Monde permanent : de nouvelles colonies IA remplacent celles qui ont disparu
    if (state.tick % cfg.ai.respawnEvery === 0) {
      const alive = state.colonies.filter((c) => c.isAI && c.alive).length;
      if (alive < state.aiTarget) placeAIs(state, world, cfg, 1);
    }
  }

  // ---------- Missions ----------

  /** Temps passé sans interruption par une colonie sur le scarabée géant (mission rare). */
  function trackBeetle(state, world, cfg) {
    if (!world.treasures) return;
    let holder = -1;
    for (const id in world.treasures) {
      if (world.treasures[id] !== 'beetle') continue;
      const c = state.cells[id];
      if (c && c.owner >= 0) holder = c.owner;
    }
    if (holder !== state.beetleHolder) {
      const prev = state.colonies[state.beetleHolder];
      if (prev && prev.ctr) prev.ctr.beetleHold = 0;
      state.beetleHolder = holder;
    }
    const col = state.colonies[holder];
    if (col) { col.ctr = col.ctr || {}; col.ctr.beetleHold = (col.ctr.beetleHold || 0) + 1; }
  }

  /** Progression actuelle d'une mission (à comparer à m.goal). */
  function missionProgress(state, world, cfg, col, m) {
    const s = col.stats || {};
    const ctr = col.ctr || {};
    switch (m.k) {
      case 'expand': return s.territories || 0;
      case 'biome': return (s.biomes && s.biomes[m.biome]) || 0;
      case 'army': return s.s || 0;
      case 'wild': return (ctr.wild || 0) - (m.base || 0);
      case 'enemy': return (ctr.enemy || 0) - (m.base || 0);
      case 'treasure': return s.treasures && s.treasures[m.treasure] ? 1 : 0;
      case 'stock': return Math.floor(col.food);
      case 'evolve': return (ctr.evo || 0) - (m.base || 0);
      case 'beetle': return ctr.beetleHold || 0;
      default: return 0;
    }
  }

  /** Tire une nouvelle mission adaptée à la colonie (jamais deux fois la même en même temps). */
  function newMission(state, world, cfg, col) {
    const L = cfg.missions.list;
    const active = (col.missions || []).map((m) => m.k);
    const ctr = col.ctr || {};
    const s = col.stats || {};
    const types = world.treasures ? Object.keys(world.treasures).map((id) => world.treasures[id]) : [];
    const canRare = types.indexOf('beetle') >= 0 && !(col.unlocks && col.unlocks.beetle) && active.indexOf('beetle') < 0;
    if (canRare && rand(state) < cfg.missions.rareChance) return { k: 'beetle', goal: L.beetle.holdTicks };
    const others = state.colonies.some((c) => c.alive && c.id !== col.id);
    const pool = ['expand', 'biome', 'army', 'wild', 'stock', 'evolve']
      .concat(others ? ['enemy'] : [])
      .concat(types.some((t) => t !== 'beetle' && !(s.treasures && s.treasures[t])) ? ['treasure', 'treasure'] : [])
      .filter((k) => active.indexOf(k) < 0);
    const k = pool[Math.floor(rand(state) * pool.length)] || 'expand';
    const r = (a, b) => a + Math.floor(rand(state) * (b - a + 1));
    switch (k) {
      case 'expand': return { k, goal: (s.territories || 1) + r(4, 8) };
      case 'biome': {
        const list = Object.keys(cfg.biomes).filter((b) => b !== 'sand');
        const biome = list[Math.floor(rand(state) * list.length)];
        return { k, biome, goal: ((s.biomes && s.biomes[biome]) || 0) + r(2, 4) };
      }
      case 'army': return { k, goal: (s.s || 0) + r(12, 25) };
      case 'wild': return { k, base: ctr.wild || 0, goal: r(4, 8) };
      case 'enemy': return { k, base: ctr.enemy || 0, goal: r(1, 3) };
      case 'treasure': {
        const t = types.filter((x) => x !== 'beetle' && !(s.treasures && s.treasures[x]));
        return { k, treasure: t[Math.floor(rand(state) * t.length)], goal: 1 };
      }
      case 'stock': return { k, goal: Math.round(Math.min((s.cap || 300) * 0.8, Math.max(150, col.food + 150)) / 10) * 10 };
      case 'evolve': return { k, base: ctr.evo || 0, goal: 1 };
      default: return { k: 'expand', goal: (s.territories || 1) + 5 };
    }
  }

  /** Vérifie les missions des colonies humaines : récompense et remplacement des missions réussies. */
  function checkMissions(state, world, cfg) {
    for (const col of state.colonies) {
      if (!col.alive || col.isAI || asleep(state, cfg, col)) continue;
      col.missions = col.missions || [];
      while (col.missions.length < cfg.missions.slots) col.missions.push(newMission(state, world, cfg, col));
      for (let i = 0; i < col.missions.length; i++) {
        const m = col.missions[i];
        if (missionProgress(state, world, cfg, col, m) < m.goal) continue;
        const def = cfg.missions.list[m.k];
        col.score = (col.score || 0) + def.points;
        col.food += def.food;
        col.ctr.missions = (col.ctr.missions || 0) + 1;
        let text = `${col.name} réussit une mission : +${def.points} points`;
        if (def.unlock) {
          col.unlocks = col.unlocks || {};
          col.unlocks[def.unlock] = true;
          ensureHero(state, cfg, col);
          state.unlockEvents.push({ uid: col.uid, key: def.unlock });
          if (state.unlockEvents.length > 20) state.unlockEvents.splice(0, state.unlockEvents.length - 20);
          text = `⭐ ${col.name} a débloqué le héros scarabée ! Il l'accompagnera dans cette colonie et les suivantes.`;
        }
        addLog(state, text, col.id);
        col.missions[i] = newMission(state, world, cfg, col);
      }
    }
  }

  /** Une colonie disparaît si sa reine est morte (nid pris) ou si elle n'a plus aucune case. */
  function checkEliminations(state, world, cfg) {
    for (const col of state.colonies) {
      if (!col.alive) continue;
      const s = col.stats;
      const dead = s.territories === 0 || !col.queenAlive;
      if (!dead) continue;
      col.alive = false;
      col.queenAlive = false;
      // Les fourmiz abandonnées redeviennent des insectes sauvages
      for (const id in state.cells) {
        const c = state.cells[id];
        if (c.owner === col.id) state.cells[id] = { owner: -1, w: Math.min(30, Math.ceil(total(c) / 2)), s: 0, e: 0, b: 0 };
      }
      state.moves = state.moves.filter((m) => m.owner !== col.id);
      const score = Math.floor(col.score || 0);
      addLog(state, `${col.name} a disparu (score ${score}).`, col.id);
      recordHall(state, cfg, col, score);
      // On allège la colonie morte (elle reste dans la liste pour garder les numéros des colonies)
      for (const k of ['missions', 'ctr', 'evo', 'layAcc', 'stats']) delete col[k];
      col.stats = {};
    }
  }

  /** Tableau des records : les meilleurs scores des colonies disparues. */
  function recordHall(state, cfg, col, score) {
    if (score <= 0) return;
    state.hall.push({ name: col.name, color: col.color, score, ai: !!col.isAI, tick: state.tick });
    state.hall.sort((a, b) => b.score - a.score);
    if (state.hall.length > cfg.score.hallSize) state.hall.length = cfg.score.hallSize;
  }

  const SIM = {
    CASTES, rand, hash01, total, power, scaleGroup, pickGroup, getCell, seasonAt, createWorldState, hydrate,
    joinColony, canFound, colonyOf, applyOrder, sendAnts, rally, findPath, pathLegs, pathCells, groupSpeed, tickMs, tickAt, onlineConfig, asleep,
    autoBalanceWorkers, armyGroup, treasureAt, tpow, heroOf, heroAt, heroBoost, heroPower, guardMax, attackRaw, defenseRaw, missionProgress, newMission, mixFor, emptyGroup,
    setLayMode, setCaste, evolve, evoLevel, evoCost, resolveCombat, forceNeeded, defenseFactor,
    defensePower, attackFactor, attackPreview, optimalWorkers, harvestInfo, logistics, travelTicks, refreshStats,
    step, wildGarrison, eggCost,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = SIM;
  else (root.FZ = root.FZ || {}).SIM = SIM;
})(typeof window !== 'undefined' ? window : globalThis);
