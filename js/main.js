/**
 * Fourmiz — point d'entrée : charge le monde, crée la carte, branche le bon « backend »
 * (en ligne avec Firebase, ou solo dans le navigateur) et relie clics et glisser-déposer aux ordres.
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
  let selected = null;   // case à soi choisie (barre d'action avec ordres)
  let inspected = null;  // autre case touchée (fiche seule)
  let share = 0.5;
  let sendCaste = 'all'; // castes envoyées : 'all' | 'w' | 's' | 'e'
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
  function mine(id, m) { m = m || me(); return !!(m && id && state.cells[id] && state.cells[id].owner === m.id); }

  function highlight() {
    const hl = {};
    const m = me();
    if (m && selected && mine(selected, m) && state.phase === 'playing') {
      hl[selected] = 1;
      for (const nb of world.neighbors(selected)) hl[nb] = mine(nb, m) ? 2 : 3;
    } else {
      selected = null;
    }
    gm.highlight(hl);
  }

  function send(order, okText) {
    const r = backend.send(order);
    if (!r.ok) ui.say(r.reason);
    else if (okText) ui.say(okText);
    dirty = true;
    return r;
  }

  /** Groupe de fourmiz qui partirait de cette case avec les réglages choisis. */
  function groupFrom(from) {
    return SIM.pickGroup(state.cells[from], sendCaste, share);
  }

  /** Texte d'aperçu d'un envoi (renfort ou attaque, force, bonus, durée). */
  function describeSend(m, path, g) {
    const legs = SIM.pathLegs(state, world, cfg, m.id, path, g);
    const eta = ui.duration(legs[legs.length - 1]);
    const to = path[path.length - 1];
    if (mine(to, m)) return { ok: true, text: `${ui.castesLine(g)} en renfort · ${eta}` };
    const p = SIM.attackPreview(state, world, cfg, m.id, path, g);
    const mods = [];
    if (p.encircle > 1) mods.push(`encerclement +${Math.round((p.encircle - 1) * 100)} %`);
    if (p.fatigue < 1) mods.push(`fatigue −${Math.round((1 - p.fatigue) * 100)} %`);
    const verdict = p.win ? (p.attack > p.defense * 1.3 ? '✅ victoire' : '⚠️ victoire serrée') : '❌ défaite';
    return {
      ok: true, win: p.win,
      text: `⚔️ force ${Math.round(p.attack)} contre ${Math.round(p.defense)} → ${verdict}${mods.length ? ' (' + mods.join(', ') + ')' : ''} · ${eta}`,
    };
  }

  /** Envoie la part choisie des fourmiz d'une case vers une autre (voisine ou par les galeries). */
  function sendFrom(from, to) {
    const m = me();
    const src = state.cells[from];
    if (!m || !src || SIM.total(src) < 1) return ui.say('Plus aucune fourmi sur cette case.');
    const g = groupFrom(from);
    if (SIM.total(g) < 1) return ui.say('Aucune fourmi de cette caste sur la case.');
    const p = SIM.findPath(state, world, cfg, m.id, from, to);
    if (!p.ok) return ui.say(p.reason);
    const d = describeSend(m, p.path, g);
    send({ type: 'send', from, to, w: g.w, s: g.s, e: g.e }, d.text);
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
    dirty = true;
    inspected = null;
    if (!id) { selected = null; return; }
    if (id === selected) { selected = null; return; }
    if (selected) {
      const neighbor = world.neighbors(selected).indexOf(id) >= 0;
      if (mine(id, m) && !neighbor) { selected = id; return; }
      if (neighbor || SIM.findPath(state, world, cfg, m.id, selected, id).ok) { sendFrom(selected, id); return; }
    }
    if (mine(id, m)) selected = id;
    else { selected = null; inspected = id; }
  }

  // ---------- Glisser-déposer ----------
  const drag = {
    canDrag(id, isTouch) {
      const m = me();
      if (!m || !state || state.phase !== 'playing' || !mine(id, m) || SIM.total(state.cells[id]) < 1) return false;
      return isTouch ? id === selected : true; // au doigt : d'abord toucher la case, puis glisser
    },
    dragOver(from, over, point) {
      const m = me();
      if (!m || !state) return;
      if (over === from) { gm.showPath(null); ui.dragTip(null); return; }
      const p = SIM.findPath(state, world, cfg, m.id, from, over);
      if (!p.ok) { gm.showPath(null); ui.dragTip('🚫 ' + p.reason, point); return; }
      gm.showPath(p.path, m.color);
      const g = groupFrom(from);
      if (SIM.total(g) < 1) { ui.dragTip('🚫 Aucune fourmi de cette caste ici', point); return; }
      ui.dragTip(describeSend(m, p.path, g).text, point);
    },
    dragEnd(from, to) {
      gm.showPath(null);
      ui.dragTip(null);
      if (from && to) { selected = from; inspected = null; sendFrom(from, to); }
    },
  };

  // ---------- Actions ----------
  function ownCells() {
    const m = me();
    if (!m) return [];
    return Object.keys(state.cells).filter((id) => state.cells[id].owner === m.id);
  }
  const actions = {
    speed(v) { if (backend.setSpeed) backend.setSpeed(v); },
    share(v) { share = v; },
    sendCaste(v) { sendCaste = v; },
    layMode(m) { send({ type: 'lay', mode: m }); },
    caste(p) { send({ type: 'caste', preset: p }); },
    evolve(key) {
      const e = cfg.evolutions.list[key];
      send({ type: 'evolve', key }, `${e.icon} ${e.name} : niveau supérieur !`);
    },
    newGame() { selected = inspected = null; hadColony = false; gm.reset(); backend.newGame(); ui.hideOverlay(); },
    raiseQueen() { if (selected) send({ type: 'queen', cell: selected }, '👑 Une nouvelle reine s’installe.'); },
    rally() {
      if (!selected) return;
      send({ type: 'rally', cell: selected }, '📣 Rassemblement : les fourmiz en trop arrivent par tes galeries.');
    },
    closeSelection() { selected = inspected = null; dirty = true; },
    overlayButton() {
      if (mode === 'online' && !backend.user) backend.signIn();
      else if (mode === 'solo') actions.newGame();
    },
    userButton() { if (backend.user) backend.signOut(); else backend.signIn(); },
    goNest() {
      const m = me();
      if (m && m.nest) { gm.flyTo(m.nest, 5); selected = m.nest; dirty = true; }
      else ui.say('Tu n’as plus de nid : élève une nouvelle reine.');
    },
    goArmy() {
      const ids = ownCells();
      if (!ids.length) return;
      const best = ids.reduce((a, b) => (SIM.power(state.cells[b], cfg) > SIM.power(state.cells[a], cfg) ? b : a));
      gm.flyTo(best, 5);
      selected = best;
      dirty = true;
    },
    goAll() { gm.fitCells(ownCells()); },
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
      if ((joinPending || !hadColony) && m.nest) { gm.flyTo(m.nest, 4.5); if (!selected) selected = m.nest; }
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
      const m = me();
      gm.render(state, m ? m.id : -1, backend.tickFloat());
      highlight();
      renderUI();
      if (hoverId) ui.hover(state, world, m, hoverId, hoverPoint);
    } else if (now - lastMoves > 150 && state.moves.length) {
      lastMoves = now;
      gm.renderMoves(state, backend.tickFloat());
    }
  }
  function renderUI() {
    ui.update(state, world, {
      me: me(), selected, inspected, mode, hadColony, joinPending,
      net: mode === 'online' ? { connected: backend.connected } : null,
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
      gm = await FZ.MAP.createMap(document.getElementById('map'), world, cfg, Object.assign({
        click: onClick,
        hover(id, point) { hoverId = id; hoverPoint = point; if (state) ui.hover(state, world, me(), id, point); },
      }, drag));
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
    setInterval(loop, 50);
    window.FZ.debug = { get state() { return state; }, world, gm, onClick, actions, drag, get backend() { return backend; } };
  }

  boot();
})();
