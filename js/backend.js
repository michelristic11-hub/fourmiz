/**
 * Fourmiz — deux façons de faire tourner le monde, avec la même interface :
 *  - LocalBackend    : partie solo, la simulation tourne dans le navigateur.
 *  - FirebaseBackend : monde partagé, la simulation tourne sur le serveur ;
 *                      le navigateur écoute l'état et envoie des ordres.
 *
 * Interface commune :
 *   start(onState)   onState(state) est appelé à chaque changement
 *   send(order)      envoie un ordre { type, ... } ; renvoie { ok, reason, pending }
 *   uid              identifiant du joueur
 *   tickFloat()      tick courant avec sa fraction (pour animer les trajets)
 */
(function (root) {
  'use strict';
  const FZ = root.FZ;

  // ---------------------------------------------------------------- Solo
  const SAVE_KEY = 'fourmiz-solo-v2';

  function LocalBackend(world, cfg) {
    const SIM = FZ.SIM;
    let state = null;
    let onState = () => {};
    let speed = 1;
    let acc = 0;

    function save() {
      try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); } catch (e) { /* stockage indisponible */ }
    }
    function load() {
      try {
        const s = JSON.parse(localStorage.getItem(SAVE_KEY));
        if (s && s.version === 2 && s.landCount === world.ids.length) return SIM.hydrate(s);
      } catch (e) { /* sauvegarde illisible */ }
      return null;
    }

    const api = {
      mode: 'solo',
      uid: 'local',
      start(cb) {
        onState = cb;
        state = load() || SIM.createWorldState(world, cfg, { aiCount: cfg.ai.count });
        onState(state);
        setInterval(() => {
          if (state.phase !== 'playing' || speed <= 0) return;
          acc += speed * 0.1;
          let ticked = false;
          while (acc >= 1) {
            acc -= 1;
            SIM.step(state, world, cfg);
            FZ.AI.thinkAll(state, world, cfg, SIM);
            ticked = true;
            if (state.tick % 10 === 0 || state.phase !== 'playing') save();
            if (state.phase !== 'playing') break;
          }
          if (ticked) onState(state);
        }, 100);
      },
      send(order) {
        order.uid = 'local';
        const r = SIM.applyOrder(state, world, cfg, order);
        if (r.ok) { save(); onState(state); }
        return { ok: r.ok, reason: r.reason };
      },
      setSpeed(v) { speed = v; },
      newGame() {
        state = SIM.createWorldState(world, cfg, { aiCount: cfg.ai.count });
        save();
        onState(state);
      },
      tickFloat() { return state ? state.tick + (speed > 0 ? acc : 0) : 0; },
    };
    return api;
  }

  // ---------------------------------------------------------------- En ligne
  function FirebaseBackend(world, cfg, firebaseConfig, hooks) {
    const SIM = FZ.SIM;
    const fb = root.firebase;
    fb.initializeApp(firebaseConfig);
    const auth = fb.auth();
    const db = fb.database();
    const gid = cfg.online.gameId;
    let state = null;
    let offset = 0;
    let stateRef = null;
    let resultRef = null;
    const startedAt = Date.now();


    function unsubscribe() {
      if (stateRef) stateRef.off();
      if (resultRef) resultRef.off();
      stateRef = resultRef = null;
    }

    const api = {
      mode: 'online',
      uid: null,
      user: null,
      connected: false,
      start(onState) {
        auth.onAuthStateChanged((user) => {
          unsubscribe();
          api.user = user;
          api.uid = user ? user.uid : null;
          hooks.onUser(user);
          if (!user) return;
          stateRef = db.ref(`games/${gid}/state`);
          stateRef.on('value', (snap) => {
            state = snap.val() ? SIM.hydrate(snap.val()) : null;
            onState(state);
          }, (err) => hooks.onError(err));
          resultRef = db.ref(`games/${gid}/results/${user.uid}`);
          resultRef.on('value', (snap) => {
            const r = snap.val();
            if (r && r.at > startedAt - offset) hooks.onResult(r);
          });
        });
      },
      signIn() {
        return auth.signInWithPopup(new fb.auth.GoogleAuthProvider()).catch((e) => hooks.onError(e));
      },
      signOut() { return auth.signOut(); },
      send(order) {
        if (!api.uid) return { ok: false, reason: 'Connecte-toi d’abord.' };
        order.uid = api.uid;
        order.at = fb.database.ServerValue.TIMESTAMP;
        db.ref(`games/${gid}/orders`).push(order).catch((e) => hooks.onError(e));
        return { ok: true, pending: true };
      },
      serverNow() { return Date.now() + offset; },
      /** Secondes avant le prochain tour du serveur. */
      nextTickIn() {
        if (!state || !state.lastTickAt) return 0;
        return (state.lastTickAt + cfg.online.tickSeconds * 1000 - api.serverNow()) / 1000;
      },
      tickFloat() {
        if (!state) return 0;
        const frac = (api.serverNow() - state.lastTickAt) / (cfg.online.tickSeconds * 1000 / cfg.online.ticksPerRun);
        return state.tick + Math.max(0, Math.min(1, frac));
      },
    };
    db.ref('.info/serverTimeOffset').on('value', (s) => { offset = s.val() || 0; });
    db.ref('.info/connected').on('value', (s) => { api.connected = !!s.val(); hooks.onChange(); });
    return api;
  }

  FZ.BACKEND = { LocalBackend, FirebaseBackend };
})(window);
