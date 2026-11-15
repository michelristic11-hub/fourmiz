/**
 * Fourmiz — valeurs de gameplay (data-driven).
 * Toutes les règles numériques du jeu sont ici : modifier ce fichier pour équilibrer,
 * sans toucher au code de la simulation.
 * Unité de temps : le « tick », un petit pas de temps réel (voir time.tickSeconds).
 * Il n'y a pas de tours : le monde avance en continu, un tick toutes les quelques secondes.
 */
(function (root) {
  const CONFIG = {
    time: {
      /** Durée réelle d'un tick, en ligne comme en solo (vitesse x1). */
      tickSeconds: 2,
    },

    /** Résolution H3 des territoires (3 ≈ 12 000 cases de terre ferme, ~12 000 km² chacune). */
    h3Resolution: 3,
    /** On ignore l'Antarctique (latitude du centre de la case en dessous de cette valeur). */
    minLatitude: -58,

    start: {
      ants: 30,            // fourmiz de départ à placer
      food: 60,            // nourriture de départ
      minNestDistance: 4,  // distance minimale (en cases) entre deux nids au départ
    },

    queen: {
      /** Ponte de base (fourmiz/tick) en mode "normal". */
      baseLayRate: 0.5,
      /** Bonus de ponte par territoire possédé. */
      layRatePerTerritory: 0.02,
      maxLayRate: 3,
      /** Coût en nourriture d'une nouvelle fourmi. */
      foodPerAnt: 1,
      /** Modes de ponte choisis par le joueur : multiplicateur de vitesse et de coût. */
      layModes: {
        stop: { label: 'Arrêt', rate: 0, cost: 0 },
        normal: { label: 'Normale', rate: 1, cost: 1 },
        intense: { label: 'Intensive', rate: 2, cost: 1.5 },
      },
      /** Élever une nouvelle reine (si la reine est morte). */
      newQueen: { food: 150, minAnts: 25 },
      /** Ponte réduite pendant l'hiver hors tropiques (hibernation). */
      winterLayFactor: 0.4,
    },

    food: {
      /** Consommation de nourriture par fourmi et par tick. */
      upkeepPerAnt: 0.04,
      /** Une case ne produit que si au moins N fourmiz y récoltent. */
      minForagers: 1,
      /** Capacité de stockage : base + par territoire. */
      storageBase: 200,
      storagePerTerritory: 20,
      /** En famine, part des fourmiz qui meurent chaque tick. */
      starvationRate: 0.02,
    },

    combat: {
      /** Bonus du défenseur (loi de Lanchester au carré). */
      defenderBonus: 1.25,
      /** Bonus supplémentaire si la case est le nid de la reine. */
      nestBonus: 1.5,
    },

    movement: {
      /** Durée de base d'un déplacement vers une case voisine (ticks), multipliée par le terrain d'arrivée. */
      baseTravelTicks: 4,
      /** Dans ses propres galeries, les fourmiz vont plus vite (multiplicateur de durée). */
      tunnelFactor: 0.5,
      /** Longueur maximale d'un trajet (en cases). */
      maxPathLength: 80,
      /** « Rassembler ici » : fourmiz laissées sur chaque case pour qu'elle continue de récolter. */
      rallyKeep: 1,
      /** « Rassembler ici » : nombre maximal de cases qui envoient leurs fourmiz. */
      rallyMaxSources: 200,
    },

    seasons: {
      /** Durée d'une saison en ticks (300 ticks de 2 s = 10 minutes). Une année = 4 saisons. */
      lengthTicks: 300,
      names: ['Printemps', 'Été', 'Automne', 'Hiver'],
      /** Multiplicateur de récolte par saison (hors tropiques). */
      foodFactor: [1.0, 1.25, 0.85, 0.35],
      /** Latitude sous laquelle il n'y a pas d'hiver (tropiques). */
      tropicsLatitude: 23,
    },

    victory: {
      /** Part des cases de terre ferme à contrôler pour gagner. */
      landShare: 0.2,
    },

    ai: {
      count: 5,
      /** Les IA réfléchissent tous les N ticks. */
      thinkEvery: 3,
      /** Marge de sécurité : force envoyée / force nécessaire. */
      attackMargin: 1.35,
      /** Fourmiz gardées en défense sur chaque case. */
      keepHome: 4,
      names: ['Rouges de Feu', 'Charpentières', 'Légionnaires', 'Moissonneuses', 'Tisserandes', 'Coupeuses de feuilles', 'Pharaonnes'],
    },

    /** Partie en ligne (Firebase). */
    online: {
      gameId: 'monde',
      /** Si le serveur a pris du retard, il rattrape au plus N ticks d'un coup (le reste du temps est sauté). */
      maxCatchUpTicks: 900,
      /** Colonies IA présentes dans chaque nouveau monde en ligne. */
      aiCount: 4,
      /** Après une victoire, un nouveau monde naît au bout de N minutes. */
      resetAfterMinutes: 60,
      maxNameLength: 24,
    },

    colors: {
      player: '#ffd23f',
      /** Couleurs des joueurs humains en ligne (attribuées dans l'ordre d'arrivée). */
      players: ['#ffd23f', '#ff7f11', '#ff3c8e', '#00a6fb', '#8ac926', '#ffffff', '#c77dff', '#f15bb5', '#00f5d4', '#fee440', '#9b5de5', '#06d6a0'],
      ai: ['#e4572e', '#29335c', '#a1c181', '#7d5ba6', '#17bebb', '#f28482', '#4c6085'],
    },

    /**
     * Biomes : nourriture/tick récoltée par case, bonus de défense, coût de déplacement,
     * garnison d'insectes sauvages [min, max] sur les cases neutres.
     */
    biomes: {
      jungle:   { name: 'Jungle',          color: '#138a3e', food: 1.6, defense: 1.2, travel: 1.3, wild: [6, 14] },
      forest:   { name: 'Forêt tempérée',  color: '#4caf50', food: 1.3, defense: 1.1, travel: 1.1, wild: [4, 10] },
      savanna:  { name: 'Savane',          color: '#e5b842', food: 1.1, defense: 1.0, travel: 1.0, wild: [3, 8] },
      grass:    { name: 'Prairie',         color: '#a5d65a', food: 1.0, defense: 1.0, travel: 0.8, wild: [2, 6] },
      desert:   { name: 'Désert',          color: '#f0cf8a', food: 0.3, defense: 0.9, travel: 1.6, wild: [0, 3] },
      mountain: { name: 'Montagne',        color: '#9c7b63', food: 0.5, defense: 1.6, travel: 1.8, wild: [2, 6] },
      taiga:    { name: 'Taïga',           color: '#2f7f68', food: 0.7, defense: 1.1, travel: 1.3, wild: [2, 6] },
      tundra:   { name: 'Toundra',         color: '#a8c3cf', food: 0.35, defense: 1.0, travel: 1.4, wild: [0, 3] },
      ice:      { name: 'Glace',           color: '#eef7fb', food: 0.05, defense: 1.0, travel: 2.0, wild: [0, 1] },
    },
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = CONFIG;
  else (root.FZ = root.FZ || {}).CONFIG = CONFIG;
})(typeof window !== 'undefined' ? window : globalThis);
