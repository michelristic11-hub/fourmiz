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
 *
 * Il n'y a pas de tours : le monde avance d'un tick toutes les cfg.time.tickSeconds secondes.
 * En ligne, le serveur fait foi, mais le navigateur « prédit » la suite entre deux mises à jour
 * (même code de simulation) et applique tout de suite les ordres du joueur à sa prédiction.
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
          acc += (speed * 0.1) / cfg.time.tickSeconds;
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
      tickFloat() { return state ? state.tick + (speed > 0 ? Math.min(acc, 1) : 0) : 0; },
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
    let predicted = null; // état du serveur + prédiction locale du temps écoulé
    let offset = 0;
    let stateRef = null;
    let resultRef = null;
    let onState = () => {};
    const startedAt = Date.now();
    const clone = (x) => JSON.parse(JSON.stringify(x));

    function unsubscribe() {
      if (stateRef) stateRef.off();
      if (resultRef) resultRef.off();
      stateRef = resultRef = null;
    }

    /** Fait avancer la prédiction jusqu'à maintenant (au plus 60 ticks par appel). */
    function catchUp() {
      if (!predicted || !predicted.startedAt || predicted.phase !== 'playing') return false;
      const target = SIM.tickAt(predicted, cfg, api.serverNow());
      let n = 0;
      while (predicted.tick < target && n < 60 && predicted.phase === 'playing') {
        SIM.step(predicted, world, cfg);
        FZ.AI.thinkAll(predicted, world, cfg, SIM);
        n++;
      }
      return n > 0;
    }

    const api = {
      mode: 'online',
      uid: null,
      user: null,
      connected: false,
      start(cb) {
        onState = cb;
        auth.onAuthStateChanged((user) => {
          unsubscribe();
          api.user = user;
          api.uid = user ? user.uid : null;
          hooks.onUser(user);
          if (!user) return;
          stateRef = db.ref(`games/${gid}/state`);
          stateRef.on('value', (snap) => {
            const v = snap.val();
            predicted = v ? SIM.hydrate(v) : null;
            catchUp();
            onState(predicted);
          }, (err) => hooks.onError(err));
          resultRef = db.ref(`games/${gid}/results/${user.uid}`);
          resultRef.on('value', (snap) => {
            const r = snap.val();
            if (r && r.at > startedAt - offset) hooks.onResult(r);
          });
        });
        setInterval(() => { if (catchUp()) onState(predicted); }, 250);
      },
      signIn() {
        return auth.signInWithPopup(new fb.auth.GoogleAuthProvider()).catch((e) => hooks.onError(e));
      },
      signOut() { return auth.signOut(); },
      send(order) {
        if (!api.uid) return { ok: false, reason: 'Connecte-toi d’abord.' };
        order.uid = api.uid;
        // Vérification et effet immédiats sur la prédiction ; le serveur confirme juste après.
        if (predicted) {
          catchUp();
          const r = SIM.applyOrder(predicted, world, cfg, clone(order));
          if (!r.ok) return { ok: false, reason: r.reason };
        }
        const sent = Object.assign({}, order, { at: fb.database.ServerValue.TIMESTAMP });
        db.ref(`games/${gid}/orders`).push(sent).catch((e) => hooks.onError(e));
        if (predicted) onState(predicted);
        return { ok: true, pending: true };
      },
      serverNow() { return Date.now() + offset; },
      tickFloat() {
        if (!predicted || !predicted.startedAt) return predicted ? predicted.tick : 0;
        return (api.serverNow() - predicted.startedAt) / SIM.tickMs(cfg);
      },
    };
    db.ref('.info/serverTimeOffset').on('value', (s) => { offset = s.val() || 0; });
    db.ref('.info/connected').on('value', (s) => { api.connected = !!s.val(); hooks.onChange(); });
    return api;
  }

  FZ.BACKEND = { LocalBackend, FirebaseBackend };
})(window);
