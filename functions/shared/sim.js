/**
 * Fourmiz — simulation pure (aucun accès au DOM ni à la carte), partagée par le navigateur et le serveur.
 *
 * L'état de jeu est un objet JSON sérialisable : il peut être sauvegardé tel quel,
 * et ce même code pourra tourner côté serveur (Cloud Functions Firebase) pour arbitrer
 * les parties multijoueurs.
 *
 * Interface « world » attendue :
 *   world.ids                 : tableau des identifiants de cases (terre ferme)
 *   world.cells[id]           : { id, lat, lng, biome }
 *   world.neighbors(id)       : identifiants des cases voisines sur terre ferme
 *   world.distance(a, b)      : distance en nombre de cases
 */
(function (root) {
  'use strict';

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

  // ---------- Accès aux cases ----------

  /** Garnison d'insectes sauvages d'une case neutre jamais touchée. */
  function wildGarrison(world, cfg, id) {
    const b = cfg.biomes[world.cells[id].biome];
    return Math.round(b.wild[0] + hash01(id) * (b.wild[1] - b.wild[0]));
  }

  /** Renvoie l'état d'une case (owner = -1 pour neutre). Ne modifie pas l'état. */
  function getCell(state, world, cfg, id) {
    const c = state.cells[id];
    if (c) return c;
    return { owner: -1, ants: wildGarrison(world, cfg, id) };
  }

  /** Renvoie l'état modifiable d'une case (le crée si besoin). */
  function cellRef(state, world, cfg, id) {
    if (!state.cells[id]) state.cells[id] = { owner: -1, ants: wildGarrison(world, cfg, id) };
    return state.cells[id];
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

  // ---------- Création du monde ----------

  /**
   * Crée un monde neuf, déjà en cours, peuplé de colonies IA.
   * Les joueurs humains le rejoignent ensuite avec joinColony.
   * @param {object} opts { seed, aiCount, era }
   */
  function createWorldState(world, cfg, opts) {
    opts = opts || {};
    const seed = (opts.seed >>> 0) || ((Math.random() * 2 ** 32) >>> 0);
    const state = {
      version: 2,
      era: opts.era || 1,
      seed,
      rng: seed,
      tick: 0,
      lastTickAt: 0,
      phase: 'playing',
      landCount: world.ids.length,
      colonies: [],
      cells: {},
      moves: [],
      nextMoveId: 1,
      log: [],
      winner: -1,
      overTick: 0,
    };
    placeAIs(state, world, cfg, opts.aiCount == null ? cfg.ai.count : opts.aiCount);
    addLog(state, `Ère ${state.era} : un nouveau monde est né.`, -1);
    refreshStats(state, world, cfg);
    return state;
  }

  /**
   * Remet en forme un état relu depuis la base de données
   * (Firebase supprime les tableaux et objets vides).
   */
  function hydrate(state) {
    if (!state) return state;
    state.colonies = toArray(state.colonies);
    state.moves = toArray(state.moves);
    state.log = toArray(state.log);
    state.cells = state.cells || {};
    for (const col of state.colonies) {
      if (col.nest === undefined) col.nest = null;
      col.stats = col.stats || {};
      if (col.uid === undefined) col.uid = null;
    }
    if (state.winner == null) state.winner = -1;
    return state;
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
      layProgress: 0,
      alive: true,
      stats: { territories: 0, ants: 0, income: 0, upkeep: 0, layCost: 0, net: 0, cap: 0 },
    };
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
    if (!world.cells[id]) return { ok: false, reason: 'Choisis une case sur la terre ferme.' };
    if (!isFree(state, id)) return { ok: false, reason: 'Cette case est déjà occupée.' };
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
   * @param {object} who { uid, name }
   */
  function joinColony(state, world, cfg, who, id) {
    if (colonyOf(state, who.uid)) return { ok: false, reason: 'Tu as déjà une colonie dans ce monde.' };
    const can = canFound(state, world, cfg, id);
    if (!can.ok) return can;
    const humans = state.colonies.filter((c) => !c.isAI).length;
    const palette = cfg.colors.players;
    const name = cleanName(who.name, cfg) || 'Colonie ' + (humans + 1);
    const col = newColony(state.colonies.length, name, palette[humans % palette.length], false, cfg, who.uid);
    col.nest = id;
    state.colonies.push(col);
    state.cells[id] = { owner: col.id, ants: cfg.start.ants };
    addLog(state, `${col.name} fonde sa colonie.`, col.id);
    refreshStats(state, world, cfg);
    return { ok: true, colony: col };
  }

  function cleanName(name, cfg) {
    const max = (cfg.online && cfg.online.maxNameLength) || 24;
    return String(name || '').replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, max);
  }

  function placeAIs(state, world, cfg, n) {
    const taken = Object.keys(state.cells);
    const minD = cfg.start.minNestDistance * 2;
    const goodBiomes = ['jungle', 'forest', 'savanna', 'grass', 'taiga'];
    const already = state.colonies.filter((c) => c.isAI).length;
    for (let i = 0; i < n; i++) {
      let chosen = null;
      for (let attempt = 0; attempt < 400 && !chosen; attempt++) {
        const id = world.ids[Math.floor(rand(state) * world.ids.length)];
        if (!isFree(state, id)) continue;
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
      const k = already + i;
      const col = newColony(idx, cfg.ai.names[k % cfg.ai.names.length], cfg.colors.ai[k % cfg.colors.ai.length], true, cfg);
      col.nest = chosen;
      state.colonies.push(col);
      state.cells[chosen] = { owner: idx, ants: cfg.start.ants };
      taken.push(chosen);
    }
  }

  /**
   * Applique l'ordre d'un joueur. C'est la seule porte d'entrée pour les joueurs :
   * le serveur l'utilise pour valider tout ce que les navigateurs envoient.
   * @param {object} order { uid, type: 'join'|'send'|'lay'|'queen', ... }
   * @returns {{ok:boolean, reason?:string}}
   */
  function applyOrder(state, world, cfg, order) {
    if (!order || !order.uid) return { ok: false, reason: 'Ordre invalide.' };
    if (order.type === 'join') return joinColony(state, world, cfg, { uid: order.uid, name: order.name }, String(order.cell));
    const col = colonyOf(state, order.uid);
    if (!col) return { ok: false, reason: 'Tu n’as pas de colonie dans ce monde.' };
    let r;
    if (order.type === 'send') r = sendAnts(state, world, cfg, col.id, String(order.from), String(order.to), Number(order.ants) || 0);
    else if (order.type === 'lay') r = setLayMode(state, cfg, col.id, String(order.mode));
    else if (order.type === 'queen') r = raiseQueen(state, world, cfg, col.id, String(order.cell));
    else return { ok: false, reason: 'Ordre inconnu.' };
    refreshStats(state, world, cfg);
    return r;
  }

  // ---------- Actions des joueurs ----------

  /** Durée d'un trajet vers une case (dépend du terrain d'arrivée). */
  function travelTicks(world, cfg, to) {
    return Math.max(1, Math.round(cfg.movement.baseTravelTicks * cfg.biomes[world.cells[to].biome].travel));
  }

  /**
   * Envoie n fourmiz d'une case vers une case voisine (renfort ou attaque).
   * @returns {{ok:boolean, reason?:string, move?:object}}
   */
  function sendAnts(state, world, cfg, colonyId, from, to, n) {
    if (state.phase !== 'playing') return { ok: false, reason: 'La partie n’est pas en cours.' };
    const src = state.cells[from];
    if (!src || src.owner !== colonyId) return { ok: false, reason: 'Cette case ne t’appartient pas.' };
    if (world.neighbors(from).indexOf(to) < 0) return { ok: false, reason: 'Cible non adjacente.' };
    n = Math.floor(Math.min(n, src.ants));
    if (n < 1) return { ok: false, reason: 'Pas assez de fourmiz.' };
    src.ants -= n;
    const move = { id: state.nextMoveId++, owner: colonyId, from, to, ants: n, depart: state.tick, arrive: state.tick + travelTicks(world, cfg, to) };
    state.moves.push(move);
    return { ok: true, move };
  }

  /** Change le mode de ponte de la reine (stop / normal / intense). */
  function setLayMode(state, cfg, colonyId, mode) {
    if (!cfg.queen.layModes[mode]) return { ok: false, reason: 'Mode inconnu.' };
    state.colonies[colonyId].layMode = mode;
    return { ok: true };
  }

  /** Élève une nouvelle reine sur une case possédée (si l'ancienne est morte). */
  function raiseQueen(state, world, cfg, colonyId, id) {
    const col = state.colonies[colonyId];
    const c = state.cells[id];
    const req = cfg.queen.newQueen;
    if (col.queenAlive) return { ok: false, reason: 'Ta reine est toujours en vie.' };
    if (!c || c.owner !== colonyId) return { ok: false, reason: 'Choisis une de tes cases.' };
    if (c.ants < req.minAnts) return { ok: false, reason: `Il faut ${req.minAnts} fourmiz sur la case.` };
    if (col.food < req.food) return { ok: false, reason: `Il faut ${req.food} de nourriture.` };
    col.food -= req.food;
    col.queenAlive = true;
    col.nest = id;
    addLog(state, `${col.name} élève une nouvelle reine !`, colonyId);
    return { ok: true };
  }

  // ---------- Combat ----------

  /** Multiplicateur de défense d'une case. */
  function defenseFactor(state, world, cfg, id, owner) {
    const biome = cfg.biomes[world.cells[id].biome];
    if (owner < 0) return biome.defense;
    const col = state.colonies[owner];
    const nest = col.queenAlive && col.nest === id ? cfg.combat.nestBonus : 1;
    return cfg.combat.defenderBonus * biome.defense * nest;
  }

  /**
   * Résout un combat par la loi de Lanchester au carré.
   * @returns {{attackerWins:boolean, survivors:number}}
   */
  function resolveCombat(attackers, defenders, factor) {
    const d = defenders * factor;
    if (attackers > d) {
      return { attackerWins: true, survivors: Math.max(1, Math.floor(Math.sqrt(attackers * attackers - d * d))) };
    }
    return { attackerWins: false, survivors: Math.floor(Math.sqrt(d * d - attackers * attackers) / factor) };
  }

  /** Estimation (pour l'IA et l'interface) des fourmiz nécessaires pour prendre une case. */
  function forceNeeded(state, world, cfg, id) {
    const c = getCell(state, world, cfg, id);
    return Math.floor(c.ants * defenseFactor(state, world, cfg, id, c.owner)) + 1;
  }

  function arrive(state, world, cfg, move) {
    const cell = cellRef(state, world, cfg, move.to);
    const atk = state.colonies[move.owner];
    if (cell.owner === move.owner) {
      cell.ants += move.ants;
      return;
    }
    const defOwner = cell.owner;
    const factor = defenseFactor(state, world, cfg, move.to, defOwner);
    const r = resolveCombat(move.ants, cell.ants, factor);
    const defName = defOwner < 0 ? 'les insectes sauvages' : state.colonies[defOwner].name;
    if (r.attackerWins) {
      cell.owner = move.owner;
      cell.ants = r.survivors;
      if (defOwner >= 0) {
        const def = state.colonies[defOwner];
        if (def.nest === move.to && def.queenAlive) {
          def.queenAlive = false;
          def.nest = null;
          addLog(state, `${atk.name} a pris le nid de ${def.name} : leur reine est morte !`, move.owner);
        } else if (!atk.isAI || !def.isAI) {
          addLog(state, `${atk.name} a pris une case à ${defName}.`, move.owner);
        }
      }
    } else {
      cell.ants = r.survivors;
      if (!atk.isAI || (defOwner >= 0 && !state.colonies[defOwner].isAI)) {
        addLog(state, `Attaque de ${atk.name} repoussée par ${defName}.`, defOwner >= 0 ? defOwner : move.owner);
      }
    }
  }

  // ---------- Boucle de simulation ----------

  /** Recalcule les statistiques de chaque colonie (territoires, fourmiz, revenus). */
  function refreshStats(state, world, cfg) {
    for (const col of state.colonies) {
      col.stats = { territories: 0, ants: 0, income: 0, upkeep: 0, layCost: 0, layRate: 0, net: 0, cap: 0 };
    }
    for (const id in state.cells) {
      const c = state.cells[id];
      if (c.owner < 0) continue;
      const s = state.colonies[c.owner].stats;
      s.territories++;
      s.ants += c.ants;
      if (c.ants >= cfg.food.minForagers) {
        const cell = world.cells[id];
        s.income += cfg.biomes[cell.biome].food * seasonAt(state.tick, cell.lat, cfg).factor;
      }
    }
    for (const m of state.moves) state.colonies[m.owner].stats.ants += m.ants;
    for (const col of state.colonies) {
      const s = col.stats;
      s.upkeep = s.ants * cfg.food.upkeepPerAnt;
      s.cap = cfg.food.storageBase + cfg.food.storagePerTerritory * s.territories;
      s.layRate = layRate(state, world, cfg, col);
      const mode = cfg.queen.layModes[col.layMode];
      s.layCost = s.layRate * cfg.queen.foodPerAnt * mode.cost;
      s.net = s.income - s.upkeep - s.layCost;
    }
  }

  /** Fourmiz pondues par tick par la reine d'une colonie. */
  function layRate(state, world, cfg, col) {
    if (!col.queenAlive || col.nest == null || !col.alive) return 0;
    const q = cfg.queen;
    let rate = Math.min(q.maxLayRate, q.baseLayRate + q.layRatePerTerritory * col.stats.territories);
    rate *= q.layModes[col.layMode].rate;
    const season = seasonAt(state.tick, world.cells[col.nest].lat, cfg);
    if (!season.tropical && season.index === 3) rate *= q.winterLayFactor;
    return rate;
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

    refreshStats(state, world, cfg);

    // 2. Économie de chaque colonie
    for (const col of state.colonies) {
      if (!col.alive) continue;
      const s = col.stats;
      const mode = cfg.queen.layModes[col.layMode];
      col.food += s.income - s.upkeep;

      // Ponte : chaque fourmi coûte de la nourriture
      if (s.layRate > 0) {
        col.layProgress += s.layRate;
        const unitCost = cfg.queen.foodPerAnt * mode.cost;
        let born = 0;
        while (col.layProgress >= 1 && col.food >= unitCost) {
          col.layProgress -= 1;
          col.food -= unitCost;
          born++;
        }
        if (col.layProgress > 1) col.layProgress = 1; // pas de stock de ponte sans nourriture
        if (born > 0) state.cells[col.nest].ants += born;
      }

      // Famine
      if (col.food < 0) {
        col.food = 0;
        let dead = 0;
        for (const id in state.cells) {
          const c = state.cells[id];
          if (c.owner !== col.id || c.ants <= 0) continue;
          const exact = c.ants * cfg.food.starvationRate;
          const loss = Math.min(c.ants, Math.floor(exact) + (rand(state) < exact - Math.floor(exact) ? 1 : 0));
          c.ants -= loss;
          dead += loss;
        }
        if (dead > 0 && !col.isAI && state.tick % 10 === 0) addLog(state, `Famine chez ${col.name} !`, col.id);
      }
      col.food = Math.min(col.food, s.cap);

      // Le nid perdu (case prise) => plus de reine
      if (col.queenAlive && col.nest && (!state.cells[col.nest] || state.cells[col.nest].owner !== col.id)) {
        col.queenAlive = false;
        col.nest = null;
      }
    }

    refreshStats(state, world, cfg);
    checkEliminations(state, world, cfg);
    checkVictory(state, world, cfg);
  }

  function checkEliminations(state, world, cfg) {
    for (const col of state.colonies) {
      if (!col.alive) continue;
      const s = col.stats;
      const dead = s.territories === 0 || (s.ants === 0 && !col.queenAlive);
      if (!dead) continue;
      col.alive = false;
      col.queenAlive = false;
      for (const id in state.cells) {
        if (state.cells[id].owner === col.id) state.cells[id] = { owner: -1, ants: 0 };
      }
      state.moves = state.moves.filter((m) => m.owner !== col.id);
      addLog(state, `${col.name} a disparu.`, col.id);
    }
  }

  function checkVictory(state, world, cfg) {
    const goal = Math.ceil(cfg.victory.landShare * state.landCount);
    for (const col of state.colonies) {
      if (col.alive && col.stats.territories >= goal) {
        state.phase = 'over';
        state.winner = col.id;
        state.overTick = state.tick;
        addLog(state, `${col.name} domine le monde !`, col.id);
        return;
      }
    }
  }

  const SIM = {
    rand, hash01, getCell, seasonAt, createWorldState, hydrate, joinColony, canFound,
    colonyOf, applyOrder, sendAnts, setLayMode, raiseQueen, resolveCombat, forceNeeded, defenseFactor,
    travelTicks, refreshStats, step, wildGarrison,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = SIM;
  else (root.FZ = root.FZ || {}).SIM = SIM;
})(typeof window !== 'undefined' ? window : globalThis);
