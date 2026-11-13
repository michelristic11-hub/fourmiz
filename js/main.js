/**
 * Fourmiz — point d'entrée : charge le monde, crée la carte, branche le bon « backend »
 * (en ligne avec Firebase, ou solo dans le navigateur) et relie les clics aux ordres.
 */
(function () {
  'use strict';
  const FZ = window.FZ;
  const cfg = FZ.CONFIG;
  const SIM = FZ.SIM;
  const NAME_KEY = 'fourmiz-name';

  const params = new URLSearchParams(location.search);
  const hasFirebase = !!(window.FZ_FIREBASE && window.FZ_FIREBASE.apiKey);
  const mode = params.has('solo') || !hasFirebase ? 'solo' : 'online';
  document.body.classList.add('mode-' + mode);

  let world, gm, ui, backend;
  let state = null;
  let selected = null;
  let share = 0.5;
  let dirty = true;
  let hadColony = false;
  let joinPending = false;
  let lastColonyCount = -1;
  let hoverId = null, hoverPoint = null;

  // ---------- Lien solo / en ligne ----------
  const modeLink = document.getElementById('mode-link');
  if (mode === 'online') { modeLink.href = '?solo'; modeLink.textContent = 'Jouer en solo'; }
  else if (hasFirebase) { modeLink.href = './'; modeLink.textContent = 'Jouer en ligne'; }
  else modeLink.hidden = true;

  function me() { return state && backend ? SIM.colonyOf(state, backend.uid) : null; }

  function highlight() {
    const hl = {};
    const m = me();
    if (m && selected && state.cells[selected] && state.cells[selected].owner === m.id && state.phase === 'playing') {
      hl[selected] = 1;
      for (const nb of world.neighbors(selected)) {
        const c = state.cells[nb];
        hl[nb] = c && c.owner === m.id ? 2 : 3;
      }
    } else {
      selected = null;
    }
    gm.highlight(hl);
  }

  function send(order, okText) {
    const r = backend.send(order);
    if (!r.ok) ui.say(r.reason);
    else if (okText) ui.say(okText + (r.pending ? '' : ''));
    dirty = true;
    return r;
  }

  function onClick(id) {
    if (!state || state.phase !== 'playing') return;
    const m = me();
    if (!m) {
      if (!id || joinPending) return;
      const can = SIM.canFound(state, world, cfg, id);
      if (!can.ok) return ui.say(can.reason);
      const name = ui.joinName() || (backend.user && backend.user.displayName) || 'Ta colonie';
      try { localStorage.setItem(NAME_KEY, name); } catch (e) { /* facultatif */ }
      const r = send({ type: 'join', name, cell: id });
      if (r.ok && r.pending) joinPending = true;
      if (r.ok) selected = id;
      return;
    }
    if (selected && id && id !== selected && world.neighbors(selected).indexOf(id) >= 0) {
      const src = state.cells[selected];
      const n = Math.max(1, Math.floor(src.ants * share));
      if (src.ants < 1) return ui.say('Plus aucune fourmi sur cette case.');
      const target = SIM.getCell(state, world, cfg, id);
      const text = target.owner === m.id ? `🐜 ${n} fourmiz en renfort.`
        : `⚔️ ${n} fourmiz à l'attaque (besoin ≈ ${SIM.forceNeeded(state, world, cfg, id)}).`;
      send({ type: 'send', from: selected, to: id, ants: n }, text);
      return;
    }
    if (id && state.cells[id] && state.cells[id].owner === m.id) selected = id === selected ? null : id;
    else selected = null;
    dirty = true;
  }

  const actions = {
    speed(v) { if (backend.setSpeed) backend.setSpeed(v); },
    share(v) { share = v; },
    layMode(m) { send({ type: 'lay', mode: m }); },
    newGame() { selected = null; hadColony = false; gm.reset(); backend.newGame(); ui.hideOverlay(); },
    raiseQueen() { if (selected) send({ type: 'queen', cell: selected }, '👑 Une nouvelle reine est demandée.'); },
    overlayButton() {
      if (mode === 'online' && !backend.user) backend.signIn();
      else if (mode === 'solo') actions.newGame();
    },
    userButton() { if (backend.user) backend.signOut(); else backend.signIn(); },
  };

  function onState(s) {
    const firstTime = !state && s;
    state = s;
    if (!state) {
      if (mode === 'online' && backend.user) ui.overlay('Le monde est en train de naître… Il apparaîtra dans moins d’une minute.');
      return;
    }
    if (state.colonies.length !== lastColonyCount) {
      lastColonyCount = state.colonies.length;
      gm.setColonyColors(state.colonies);
    }
    const m = me();
    if (m) {
      if ((joinPending || !hadColony) && m.nest) { gm.flyTo(m.nest, 4); if (!selected) selected = m.nest; }
      joinPending = false;
      hadColony = true;
    }
    if (firstTime || document.getElementById('overlay-text').textContent.startsWith('Le monde')) {
      if (state.phase === 'playing') ui.hideOverlay();
    }
    dirty = true;
  }

  // ---------- Boucle d'affichage ----------
  let lastRender = 0;
  let lastMoves = 0;
  function loop() {
    if (!state) return;
    const now = performance.now();
    if (dirty && now - lastRender > 200) {
      lastRender = now;
      dirty = false;
      gm.render(state);
      highlight();
      renderUI();
      if (hoverId) ui.hover(state, world, me(), hoverId, hoverPoint);
    } else if (now - lastMoves > 250 && state.moves.length) {
      lastMoves = now;
      gm.renderMoves(state, backend.tickFloat());
    }
  }
  function renderUI() {
    ui.update(state, world, {
      me: me(), selected, mode, hadColony, joinPending,
      net: mode === 'online' ? { connected: backend.connected, nextTickIn: backend.nextTickIn() } : null,
    });
  }

  // ---------- Démarrage ----------
  async function boot() {
    ui = FZ.UI.createUI(cfg, actions);
    try { document.getElementById('join-name').value = localStorage.getItem(NAME_KEY) || ''; } catch (e) { /* facultatif */ }
    if (!window.maplibregl || !window.h3 || !window.topojson || (mode === 'online' && !window.firebase)) {
      ui.overlay('Impossible de charger les bibliothèques. Vérifie ta connexion internet puis recharge la page.');
      return;
    }
    try {
      const t0 = performance.now();
      const land = await FZ.WORLD.loadLand(window.topojson);
      world = FZ.WORLD.buildWorld(window.h3, land, cfg);
      console.info(`Monde : ${world.ids.length} cases en ${Math.round(performance.now() - t0)} ms`);
      gm = await FZ.MAP.createMap(document.getElementById('map'), world, cfg, {
        click: onClick,
        hover(id, point) { hoverId = id; hoverPoint = point; if (state) ui.hover(state, world, me(), id, point); },
      });
    } catch (e) {
      console.error(e);
      ui.overlay('Erreur au chargement du monde : ' + e.message);
      return;
    }

    if (mode === 'solo') {
      backend = FZ.BACKEND.LocalBackend(world, cfg);
    } else {
      backend = FZ.BACKEND.FirebaseBackend(world, cfg, window.FZ_FIREBASE, {
        onUser(user) {
          ui.setUser(user);
          if (!user) {
            state = null;
            gm.reset();
            ui.overlay('Connecte-toi avec ton compte Google pour rejoindre le monde partagé.', 'Se connecter avec Google');
          } else {
            const input = document.getElementById('join-name');
            if (!input.value && user.displayName) input.value = user.displayName.split(' ')[0] + ' & Co';
            ui.overlay('Connexion au monde…');
          }
        },
        onResult(r) {
          if (!r.ok) {
            if (r.type === 'join') joinPending = false;
            ui.say('Ordre refusé : ' + (r.reason || 'raison inconnue'));
            dirty = true;
          }
        },
        onError(e) {
          console.error(e);
          ui.say('Erreur : ' + (e && e.message ? e.message : e));
        },
        onChange() { dirty = true; },
      });
    }
    backend.start(onState);
    setInterval(loop, 100);
    if (mode === 'online') setInterval(() => { if (state) renderUI(); }, 1000);
    window.FZ.debug = { get state() { return state; }, world, gm, onClick, actions, get backend() { return backend; } };
  }

  boot();
})();
