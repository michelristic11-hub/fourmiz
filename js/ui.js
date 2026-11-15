/**
 * Fourmiz — interface (panneau, barre d'action, infobulles, bandeaux, écrans).
 * Lit l'état, n'écrit jamais dedans : toutes les actions passent par les callbacks de main.js.
 */
(function (root) {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const fmt = (x, d = 0) => Number(x || 0).toLocaleString('fr-FR', { maximumFractionDigits: d, minimumFractionDigits: d });
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const isPhone = () => window.matchMedia('(max-width: 720px)').matches;

  /** Durée lisible à partir d'un nombre de ticks. */
  function duration(ticks, cfg) {
    const s = Math.round(ticks * cfg.time.tickSeconds);
    if (s < 60) return `${s} s`;
    const m = Math.floor(s / 60);
    return s % 60 ? `${m} min ${s % 60} s` : `${m} min`;
  }

  /**
   * @param {object} cfg FZ.CONFIG
   * @param {object} act { speed, newGame, layMode, share, raiseQueen, rally, closeSelection,
   *                       overlayButton, userButton, goNest, goArmy, goAll }
   */
  function createUI(cfg, act) {
    const SIM = root.FZ.SIM;
    const toast = document.createElement('div');
    toast.id = 'toast';
    Object.assign(toast.style, {
      position: 'absolute', top: '64px', left: '50%', transform: 'translateX(-50%)', zIndex: 8,
      background: 'var(--ink)', color: 'var(--bg)', padding: '8px 14px', borderRadius: '8px',
      boxShadow: 'var(--shadow)', fontSize: '13px', maxWidth: 'calc(100% - 32px)', textAlign: 'center',
    });
    toast.hidden = true;
    document.body.appendChild(toast);
    let toastTimer = null;

    function segment(sel, attr, cb) {
      document.querySelectorAll(sel + ' button').forEach((b) => {
        b.addEventListener('click', () => {
          document.querySelectorAll(sel + ' button').forEach((x) => x.classList.toggle('on', x === b));
          cb(b.dataset[attr]);
        });
      });
    }
    segment('.speed', 'speed', (v) => act.speed(Number(v)));
    segment('#lay-modes', 'mode', (v) => act.layMode(v));
    segment('#send-share', 'share', (v) => act.share(Number(v)));
    $('#btn-new').addEventListener('click', () => { if (confirmNew()) act.newGame(); });
    $('#btn-queen').addEventListener('click', () => act.raiseQueen());
    $('#btn-rally').addEventListener('click', () => act.rally());
    $('#ab-close').addEventListener('click', () => act.closeSelection());
    $('#overlay-btn').addEventListener('click', () => act.overlayButton());
    $('#btn-user').addEventListener('click', () => act.userButton());
    $('#go-nest').addEventListener('click', () => act.goNest());
    $('#go-army').addEventListener('click', () => act.goArmy());
    $('#go-all').addEventListener('click', () => act.goAll());

    // Panneau repliable (téléphone)
    const panel = $('#panel');
    $('#panel-toggle').addEventListener('click', () => {
      panel.classList.toggle('collapsed');
      const open = !panel.classList.contains('collapsed');
      $('#panel-toggle').setAttribute('aria-expanded', String(open));
      $('#panel-toggle-text').textContent = open ? 'Réduire' : 'Détails';
      document.body.classList.toggle('panel-open', open);
      if (open) panel.scrollTop = 0;
      syncPanelHeight();
    });
    function syncPanelHeight() {
      const h = isPhone() ? panel.offsetHeight : 0;
      document.documentElement.style.setProperty('--panel-h', h + 'px');
    }
    window.addEventListener('resize', syncPanelHeight);
    if (window.ResizeObserver) new ResizeObserver(syncPanelHeight).observe(panel);

    // Légende des biomes
    $('#legend-list').innerHTML = Object.keys(cfg.biomes).map((k) => {
      const b = cfg.biomes[k];
      return `<li><span class="sw" style="background:${b.color}"></span>${esc(b.name)}<span class="val">${fmt(b.food, 2)}</span></li>`;
    }).join('');

    let confirmArmed = 0;
    function confirmNew() {
      // Double clic de confirmation (sans boîte de dialogue bloquante)
      const now = Date.now();
      if (now - confirmArmed < 3000) { confirmArmed = 0; return true; }
      confirmArmed = now;
      say('Clique encore sur « Nouvelle partie » pour confirmer.');
      return false;
    }

    function say(text) {
      toast.textContent = text;
      toast.hidden = false;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => { toast.hidden = true; }, 3000);
    }

    function seasonLabel(state, world, me) {
      const lat = me && me.nest ? world.cells[me.nest].lat : 45;
      const s = SIM.seasonAt(state.tick, lat, cfg);
      const icon = ['🌱', '☀️', '🍂', '❄️'][s.index];
      const era = state.era > 1 ? `Ère ${state.era} · ` : '';
      return s.tropical ? `🌴 Tropiques · ${era}An ${s.year}` : `${icon} ${s.name} · ${era}An ${s.year}`;
    }

    /** Fiche d'une case (barre d'action et infobulle). */
    function cellCard(state, world, me, id) {
      const cell = world.cells[id];
      const b = cfg.biomes[cell.biome];
      const c = SIM.getCell(state, world, cfg, id);
      const owner = c.owner >= 0 ? state.colonies[c.owner] : null;
      const mine = me && owner && owner.id === me.id;
      const isNest = owner && owner.nest === id && owner.queenAlive;
      let html = `<div class="title">${owner ? `<span class="dot" style="background:${owner.color}"></span>${esc(owner.name)}` : 'Territoire sauvage'}${isNest ? ' · 👑 nid' : ''}</div>`;
      html += `<div>${esc(b.name)} · <b>${fmt(c.ants)}</b> ${owner ? 'fourmiz' : 'insectes'}</div>`;
      html += `<div class="hint">Récolte ${fmt(b.food * SIM.seasonAt(state.tick, cell.lat, cfg).factor, 2)} · défense x${fmt(SIM.defenseFactor(state, world, cfg, id, c.owner), 2)}</div>`;
      if (state.phase === 'playing' && me && !mine) html += `<div>≈ <b>${fmt(SIM.forceNeeded(state, world, cfg, id))}</b> fourmiz pour la prendre</div>`;
      return html;
    }

    /**
     * Met à jour tout l'écran.
     * @param {object} view { me, selected, inspected, mode, hadColony, joinPending, net: { connected } }
     */
    function update(state, world, view) {
      const me = view.me;
      const online = view.mode === 'online';
      $('#season').textContent = seasonLabel(state, world, me);

      if (online) {
        const net = view.net || {};
        const el = $('#net');
        el.classList.toggle('off', !net.connected);
        el.textContent = !net.connected ? '🔴 Hors ligne' : state.phase === 'over' ? '🏁 Fin de l’ère' : '🟢 En direct';
      }

      // Fonder une colonie / sa colonie
      $('#join').hidden = !!me;
      $('#colony').hidden = !me;
      $('#help').hidden = !me;
      $('#mapbtns').hidden = !me;
      if (!me) {
        $('#join-text').textContent = view.hadColony
          ? 'Ta colonie a disparu. Choisis une nouvelle case libre pour recommencer.'
          : 'Choisis un nom, puis touche une case libre de la carte pour y installer ta reine et tes premières fourmiz.';
      }
      if (me) {
        const s = me.stats;
        $('#col-dot').style.background = me.color;
        $('#col-name').textContent = me.name;
        $('#st-ants').textContent = fmt(s.ants);
        $('#st-terr').textContent = fmt(s.territories);
        const net = s.net || 0;
        const perMin = 60 / cfg.time.tickSeconds;
        $('#st-food-short').innerHTML = `${fmt(me.food)} <span class="${net >= 0 ? 'pos' : 'neg'}" style="font-size:12px">${net >= 0 ? '▲' : '▼'}</span>`;
        $('#st-queen').textContent = me.queenAlive ? '👑' : '💀 (morte)';
        $('#st-food').textContent = `${fmt(me.food)} / ${fmt(s.cap)}`;
        $('#food-bar').style.width = Math.min(100, (100 * me.food) / Math.max(1, s.cap)) + '%';
        $('#st-net').innerHTML =
          `Par minute : +${fmt(s.income * perMin)} récolte · −${fmt(s.upkeep * perMin)} entretien · −${fmt(s.layCost * perMin)} ponte = ` +
          `<span class="${net >= 0 ? 'pos' : 'neg'}">${net >= 0 ? '+' : ''}${fmt(net * perMin)}</span>` +
          (me.food <= 0 && net < 0 ? ' <span class="neg">FAMINE</span>' : '');
        document.querySelectorAll('#lay-modes button').forEach((b) => b.classList.toggle('on', b.dataset.mode === me.layMode));
        let lay = me.queenAlive ? `≈ ${fmt(s.layRate * perMin)} fourmiz par minute au nid` : 'Pas de reine : aucune ponte. Choisis une case avec assez de fourmiz pour en élever une.';
        if (me.queenAlive && me.nest) {
          const season = SIM.seasonAt(state.tick, world.cells[me.nest].lat, cfg);
          if (!season.tropical && season.index === 3) lay += ' (hiver : ponte ralentie)';
        }
        $('#lay-info').textContent = lay;
      }

      // Barre d'action : case à soi choisie, ou simple fiche d'une autre case
      const sel = me && view.selected && state.cells[view.selected] && state.cells[view.selected].owner === me.id ? view.selected : null;
      const info = sel || view.inspected;
      $('#actionbar').hidden = !info || state.phase !== 'playing';
      if (info) {
        $('#ab-info').innerHTML = cellCard(state, world, me, info);
        $('#ab-actions').hidden = !sel;
        if (sel) {
          const c = state.cells[sel];
          const q = cfg.queen.newQueen;
          $('#btn-queen').hidden = me.queenAlive;
          $('#btn-queen').disabled = !(c.ants >= q.minAnts && me.food >= q.food);
          $('#btn-queen').title = `${q.food} de nourriture et ${q.minAnts} fourmiz sur la case`;
        }
      }

      // Classement
      const goal = Math.ceil(cfg.victory.landShare * state.landCount);
      $('#goal').textContent = `objectif : ${fmt(goal)} cases`;
      const rows = state.colonies.filter((c) => c.alive).sort((a, b) => (b.stats.territories || 0) - (a.stats.territories || 0));
      $('#ranking').innerHTML = rows.slice(0, 15).map((c) =>
        `<li class="${me && c.id === me.id ? 'me' : ''}"><span class="dot" style="background:${c.color}"></span>` +
        `<span class="name">${esc(c.name)}${c.isAI ? ' <span class="me-badge">IA</span>' : ''}${!c.queenAlive ? ' 💀' : ''}</span>` +
        `<span>${fmt(c.stats.territories)} · ${fmt(c.stats.ants)}🐜</span></li>`).join('');

      // Journal
      $('#log').innerHTML = state.log.slice(-30).reverse().map((l) => {
        const col = state.colonies[l.colony];
        const dot = col ? `<span class="dot" style="background:${col.color};width:8px;height:8px;margin-right:4px"></span>` : '';
        return `<li>${dot}${esc(l.text)}</li>`;
      }).join('');

      // Bandeau de fondation
      const placing = !me && state.phase === 'playing';
      $('#placement').hidden = !placing;
      if (placing) {
        $('#placement-text').textContent = view.joinPending
          ? '⏳ Fondation de ta colonie en cours…'
          : '👑 Touche une case libre de la terre ferme pour fonder ta colonie.';
      }

      // Fin d'une ère
      if (state.phase === 'over') {
        const w = state.colonies[state.winner];
        const won = w && me && w.id === me.id;
        const text = (won ? '🏆 Victoire ! Tes fourmiz dominent le monde.' : `${w ? w.name : 'Une colonie'} a conquis le monde.`) +
          (online ? ' Un nouveau monde va bientôt naître.' : '');
        overlay(text, online ? null : 'Rejouer', 'over');
      } else if (overlayKind === 'over') {
        hideOverlay();
      }
      syncPanelHeight();
    }

    let overlayKind = null;
    function overlay(text, btn, kind) {
      overlayKind = kind || null;
      $('#overlay').hidden = false;
      $('#overlay-text').textContent = text;
      $('#overlay-btn').hidden = !btn;
      if (btn) $('#overlay-btn').textContent = btn;
    }
    function hideOverlay() { overlayKind = null; $('#overlay').hidden = true; }

    /** Bouton utilisateur en haut à droite (mode en ligne). */
    function setUser(user) {
      const b = $('#btn-user');
      b.hidden = false;
      const name = user ? (user.displayName || 'Joueur').split(' ')[0] : '';
      b.textContent = user ? (isPhone() ? 'Déconnexion' : `${name} · Déconnexion`) : 'Se connecter';
    }

    /** Petite fiche au survol d'une case (ordinateur uniquement). */
    function hover(state, world, me, id, point) {
      const el = $('#hover');
      if (!state || !id || !point || isPhone()) { el.hidden = true; return; }
      el.innerHTML = cellCard(state, world, me, id);
      el.hidden = false;
      place(el, point);
    }

    /** Infobulle pendant un glisser-déposer. */
    function dragTip(text, point) {
      const el = $('#dragtip');
      $('#hover').hidden = true;
      if (!text) { el.hidden = true; return; }
      el.textContent = text;
      el.hidden = false;
      place(el, { x: point.x, y: point.y - 48 });
    }

    function place(el, point) {
      const x = Math.max(8, Math.min(point.x + 16, window.innerWidth - el.offsetWidth - 8));
      const y = Math.max(8, Math.min(point.y + 16, window.innerHeight - el.offsetHeight - 8));
      el.style.left = x + 'px';
      el.style.top = y + 'px';
    }

    return {
      update, hover, dragTip, say, overlay, hideOverlay, setUser, duration: (t) => duration(t, cfg),
      joinName: () => $('#join-name').value.trim(),
    };
  }

  (root.FZ = root.FZ || {}).UI = { createUI };
})(window);
