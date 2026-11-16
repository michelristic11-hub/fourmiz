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
      /** Durée réelle d'un tick, en ligne comme en solo (vitesse x1) : 5 ticks par seconde. */
      tickSeconds: 0.2,
    },

    /** Résolution H3 des territoires (3 ≈ 12 000 cases de terre ferme, ~12 000 km² chacune). */
    h3Resolution: 3,
    /** On ignore l'Antarctique (latitude du centre de la case en dessous de cette valeur). */
    minLatitude: -58,

    start: {
      ants: 30,            // fourmiz de départ (réparties selon startCastes)
      startCastes: { w: 24, s: 6, e: 0 },
      food: 100,           // nourriture de départ
      minNestDistance: 4,  // distance minimale (en cases) entre deux nids au départ
    },

    /**
     * Castes. power = force au combat, upkeep = nourriture mangée par tick, cost = nourriture pour la pondre,
     * speed = multiplicateur de durée de trajet (un groupe avance à la vitesse de sa caste la plus lente).
     */
    castes: {
      w: { name: 'Ouvrière', plural: 'ouvrières', icon: '🐜', power: 1, upkeep: 0.04, cost: 1, speed: 1 },
      s: { name: 'Soldate', plural: 'soldates', icon: '⚔️', power: 3, upkeep: 0.08, cost: 2.5, speed: 1 },
      e: { name: 'Éclaireuse', plural: 'éclaireuses', icon: '💨', power: 0.6, upkeep: 0.04, cost: 1.5, speed: 0.5, wildBonus: 4 },
    },
    /** Répartitions de ponte proposées au joueur (part de chaque caste). */
    castePresets: {
      harvest: { label: 'Récolte', mix: { w: 0.85, s: 0.1, e: 0.05 } },
      balanced: { label: 'Équilibre', mix: { w: 0.6, s: 0.35, e: 0.05 } },
      war: { label: 'Guerre', mix: { w: 0.3, s: 0.65, e: 0.05 } },
      scout: { label: 'Exploration', mix: { w: 0.5, s: 0.2, e: 0.3 } },
    },

    queen: {
      /** Ponte de base (fourmiz/tick) en mode "normal". */
      baseLayRate: 0.5,
      /** Bonus de ponte par territoire possédé. */
      layRatePerTerritory: 0.02,
      maxLayRate: 3,
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
      /** Nombre idéal d'ouvrières sur une case = récolte du biome × ce facteur (ex. jungle 1,6 → 16). */
      optimalWorkersPerFood: 10,
      /** Au-delà du nombre idéal, chaque ouvrière en plus rapporte de moins en moins. */
      overcrowdBonus: 0.1,
      /** Logistique : distance au nid (en cases) sans pénalité, puis la récolte est divisée par 1 + (d - libre) / portée. */
      logisticsFree: 2,
      logisticsRange: 10,
      /** Capacité de stockage : base + par territoire. */
      storageBase: 300,
      storagePerTerritory: 30,
      /** En hiver (hors tropiques), part de la réserve qui se gâte à chaque tick. */
      winterSpoil: 0.0002,
      /** En famine, part des fourmiz qui meurent chaque tick. */
      starvationRate: 0.004,
      /** Répartition automatique des ouvrières : tous les N ticks. */
      autoEvery: 10,
    },

    combat: {
      /** Bonus du défenseur (loi de Lanchester au carré). */
      defenderBonus: 1.25,
      /** Bonus supplémentaire si la case est le nid de la reine. */
      nestBonus: 1.5,
      /** Bonus de défense des cases proches du nid (à moins de nestAreaRadius cases). */
      nestAreaBonus: 1.3,
      nestAreaRadius: 2,
      /** Encerclement : +X d'attaque par case de l'attaquant qui touche la cible, au-delà de la première. */
      encircleBonus: 0.15,
      encircleMax: 1.6,
      /** Fatigue : au-delà de fatigueFree cases de trajet, -X d'attaque par case (minimum fatigueMin). */
      fatigueFree: 3,
      fatiguePerStep: 0.04,
      fatigueMin: 0.6,
    },

    movement: {
      /** Durée de base d'un déplacement vers une case voisine (ticks), multipliée par le terrain d'arrivée. */
      baseTravelTicks: 4,
      /** Dans ses propres galeries, les fourmiz vont plus vite (multiplicateur de durée). */
      tunnelFactor: 0.5,
      /** Longueur maximale d'un trajet par les galeries (en cases). */
      maxPathLength: 80,
      /** Expédition hors de ses galeries (terres inconnues, mers) : durée multipliée par ce facteur, par case. */
      expeditionFactor: 1.5,
      /** « Rassembler ici » : chaque case garde ses ouvrières utiles (jusqu'au nombre idéal), au moins rallyKeep. */
      rallyKeep: 1,
      /** « Rassembler ici » : nombre maximal de cases qui envoient leurs fourmiz. */
      rallyMaxSources: 200,
    },

    seasons: {
      /** Durée d'une saison en ticks (3000 ticks de 0,2 s = 10 minutes). Une année = 4 saisons. */
      lengthTicks: 3000,
      names: ['Printemps', 'Été', 'Automne', 'Hiver'],
      /** Multiplicateur de récolte par saison (hors tropiques). */
      foodFactor: [1.0, 1.25, 0.85, 0.2],
      /** Latitude sous laquelle il n'y a pas d'hiver (tropiques). */
      tropicsLatitude: 23,
    },

    victory: {
      /** Part des cases de terre ferme à contrôler pour gagner. */
      landShare: 0.3,
    },

    ai: {
      count: 5,
      /** Les IA réfléchissent tous les N ticks. */
      thinkEvery: 15,
      /** Marge de sécurité : force envoyée / force nécessaire. */
      attackMargin: 1.35,
      /** Contre un joueur humain, l'IA exige une marge plus grande… */
      humanMargin: 2,
      /** …et ne l'attaque pas du tout pendant ses N premiers ticks (protection du débutant). */
      humanProtectTicks: 1500,
      /** Fourmiz gardées en défense sur chaque case. */
      keepHome: 4,
      names: ['Rouges de Feu', 'Charpentières', 'Légionnaires', 'Moissonneuses', 'Tisserandes', 'Coupeuses de feuilles', 'Pharaonnes'],
    },

    /** Partie en ligne (Firebase). */
    /**
     * Bouclier d'absence (en ligne seulement) : une colonie humaine dont le joueur n'a rien fait
     * depuis afterTicks s'endort. Personne ne peut l'attaquer, et son économie est gelée
     * (ni récolte, ni ponte, ni famine). Elle se réveille au retour du joueur.
     */
    shield: { enabled: false, afterTicks: 375 },

    online: {
      gameId: 'monde',
      /** Si le serveur a pris du retard, il rattrape au plus N ticks d'un coup (le reste du temps est sauté). */
      maxCatchUpTicks: 600,
      /** En ligne, le temps passe N fois moins vite qu'en solo (un tick = tickSeconds × N). */
      slowdown: 8,
      /** Changer ce numéro recrée le monde en ligne au prochain passage du serveur. */
      worldVersion: 2,
      /** Colonies IA présentes dans chaque nouveau monde en ligne. */
      aiCount: 4,
      /** Après une victoire, un nouveau monde naît au bout de N minutes. */
      resetAfterMinutes: 60,
      maxNameLength: 24,
    },

    /**
     * Évolutions : améliorations permanentes de la colonie, achetées avec de la nourriture.
     * Coût du niveau n = cost × costGrowth^(n-1). effect = valeur ajoutée par niveau.
     */
    evolutions: {
      costGrowth: 2.5,
      maxLevel: 3,
      list: {
        harvest:   { branch: 'Récolte', icon: '🍯', name: 'Mandibules de récolte', cost: 150, effect: 0.15, text: '+15 % de récolte' },
        granary:   { branch: 'Récolte', icon: '🏺', name: 'Greniers', cost: 120, effect: 0.5, text: '+50 % de stockage, −35 % de pertes en hiver' },
        fungus:    { branch: 'Récolte', icon: '🍄', name: 'Champignonnière', cost: 200, effect: 0.15, text: 'Récolte d’hiver +15 points' },
        jaws:      { branch: 'Guerre', icon: '🦷', name: 'Mâchoires', cost: 180, effect: 0.15, text: '+15 % d’attaque' },
        shell:     { branch: 'Guerre', icon: '🛡️', name: 'Carapace', cost: 180, effect: 0.15, text: '+15 % de défense' },
        acid:      { branch: 'Guerre', icon: '🧪', name: 'Acide formique', cost: 300, effect: 1, text: 'Soldates +1 de force' },
        fertility: { branch: 'Colonie', icon: '🥚', name: 'Fécondité', cost: 200, effect: 0.2, text: '+20 % de ponte' },
        trails:    { branch: 'Colonie', icon: '🧭', name: 'Phéromones de piste', cost: 150, effect: 5, text: 'Logistique : +5 cases de portée' },
        tunnels:   { branch: 'Colonie', icon: '🕳️', name: 'Galeries', cost: 150, effect: 0.2, text: 'Trajets 20 % plus rapides' },
      },
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
