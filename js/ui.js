/**
 * Fourmiz — interface (panneau, survol, bandeaux, écrans). Lit l'état, n'écrit jamais dedans :
 * toutes les actions passent par les callbacks fournis par main.js.
 */
(function (root) {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const fmt = (x, d = 0) => Number(x || 0).toLocaleString('fr-FR', { maximumFractionDigits: d, minimumFractionDigits: d });
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /**
   * @param {object} cfg FZ.CONFIG
   * @param {object} act { speed(n), newGame(), layMode(m), share(x), raiseQueen(), overlayButton(), userButton() }
   */
  function createUI(cfg, act) {
    const SIM = root.FZ.SIM;
    const toast = document.createElement('div');
    toast.id = 'toast';
    Object.assign(toast.style, {
      position: 'absolute', top: '64px', left: '50%', transform: 'translateX(-50%)', zIndex: 8,
      background: 'var(--ink)', color: 'var(--bg)', padding: '8px 14px', borderRadius: '8px',
      boxShadow: 'var(--shadow)', fontSize: '13px', maxWidth: 'calc(100% - 32px)',
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
    $('#overlay-btn').addEventListener('click', () => act.overlayButton());
    $('#btn-user').addEventListener('click', () => act.userButton());

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

    /**
     * Met à jour tout l'écran.
     * @param {object} view { me, selected, mode, hadColony, net: { connected, nextTickIn, user } }
     */
    function update(state, world, view) {
      const me = view.me;
      const online = view.mode === 'online';
      $('#season').textContent = seasonLabel(state, world, me);

      if (online) {
        const net = view.net || {};
        const el = $('#net');
        el.classList.toggle('off', !net.connected);
        el.textContent = !net.connected ? '🔴 Hors ligne'
          : state.phase === 'over' ? '🏁 Fin de l’ère'
          : `🟢 Prochain tour dans ${Math.max(0, Math.ceil(net.nextTickIn || 0))} s`;
      }

      // Fonder une colonie / sa colonie
      $('#join').hidden = !!me;
      $('#colony').hidden = !me;
      $('#selection').hidden = !me;
      if (!me) {
        $('#join-text').textContent = view.hadColony
          ? 'Ta colonie a disparu. Choisis une nouvelle case libre pour recommencer.'
          : 'Choisis un nom, puis clique sur une case libre de la carte pour y installer ta reine et tes premières fourmiz.';
      }
      if (me) {
        const s = me.stats;
        $('#col-dot').style.background = me.color;
        $('#col-name').textContent = me.name;
        $('#st-ants').textContent = fmt(s.ants);
        $('#st-terr').textContent = fmt(s.territories);
        $('#st-queen').textContent = me.queenAlive ? '👑' : '💀';
        $('#st-queen').title = me.queenAlive ? 'Ta reine est en vie' : 'Ta reine est morte : élève-en une nouvelle';
        $('#st-food').textContent = `${fmt(me.food)} / ${fmt(s.cap)}`;
        $('#food-bar').style.width = Math.min(100, (100 * me.food) / Math.max(1, s.cap)) + '%';
        const net = s.net || 0;
        $('#st-net').innerHTML =
          `+${fmt(s.income, 1)} récolte · −${fmt(s.upkeep, 1)} entretien · −${fmt(s.layCost, 1)} ponte = ` +
          `<span class="${net >= 0 ? 'pos' : 'neg'}">${net >= 0 ? '+' : ''}${fmt(net, 1)}/tour</span>` +
          (me.food <= 0 && net < 0 ? ' <span class="neg">FAMINE</span>' : '');
        document.querySelectorAll('#lay-modes button').forEach((b) => b.classList.toggle('on', b.dataset.mode === me.layMode));
        let lay = me.queenAlive ? `≈ ${fmt(s.layRate, 2)} fourmi/tour au nid` : 'Pas de reine : aucune ponte.';
        if (me.queenAlive && me.nest) {
          const season = SIM.seasonAt(state.tick, world.cells[me.nest].lat, cfg);
          if (!season.tropical && season.index === 3) lay += ' (hiver : ponte ralentie)';
        }
        $('#lay-info').textContent = lay;

        // Sélection
        const sel = view.selected;
        const has = sel && state.cells[sel] && state.cells[sel].owner === me.id;
        $('#sel-empty').hidden = !!has;
        $('#sel-body').hidden = !has;
        if (has) {
          const c = state.cells[sel];
          const cell = world.cells[sel];
          const b = cfg.biomes[cell.biome];
          const isNest = me.nest === sel && me.queenAlive;
          $('#sel-info').innerHTML =
            `<div class="kv"><span>${esc(b.name)}${isNest ? ' · 👑 nid' : ''}</span><b>${fmt(c.ants)} fourmiz</b></div>` +
            `<div class="kv"><span class="label">Récolte</span><span>${fmt(b.food * SIM.seasonAt(state.tick, cell.lat, cfg).factor, 2)}/tour</span></div>` +
            `<div class="kv"><span class="label">Défense</span><span>x${fmt(SIM.defenseFactor(state, world, cfg, sel, me.id), 2)}</span></div>`;
          const q = cfg.queen.newQueen;
          $('#btn-queen').hidden = me.queenAlive;
          $('#btn-queen').disabled = !(c.ants >= q.minAnts && me.food >= q.food);
          $('#btn-queen').textContent = `Élever une nouvelle reine ici (${q.food} de nourriture, ${q.minAnts} fourmiz)`;
        }
      }

      // Classement
      const goal = Math.ceil(cfg.victory.landShare * state.landCount);
      $('#goal').textContent = `objectif : ${fmt(goal)} cases`;
      const rows = state.colonies.filter((c) => c.alive || (me && c.id === me.id))
        .sort((a, b) => (b.stats.territories || 0) - (a.stats.territories || 0));
      $('#ranking').innerHTML = rows.slice(0, 15).map((c) =>
        `<li class="${c.alive ? '' : 'dead'} ${me && c.id === me.id ? 'me' : ''}"><span class="dot" style="background:${c.color}"></span>` +
        `<span class="name">${esc(c.name)}${c.isAI ? ' <span class="me-badge">IA</span>' : ''}${c.alive && !c.queenAlive ? ' 💀' : ''}</span>` +
        `<span>${fmt(c.stats.territories)} · ${fmt(c.stats.ants)}🐜</span></li>`).join('');

      // Journal
      $('#log').innerHTML = state.log.slice(-30).reverse().map((l) => {
        const col = state.colonies[l.colony];
        const dot = col ? `<span class="dot" style="background:${col.color};width:8px;height:8px;margin-right:4px"></span>` : '';
        return `<li><span class="t">#${l.tick}</span>${dot}${esc(l.text)}</li>`;
      }).join('');

      // Bandeau de fondation
      const placing = !me && state.phase === 'playing' && !view.blocked;
      $('#placement').hidden = !placing;
      if (placing) {
        $('#placement-text').textContent = view.joinPending
          ? '⏳ Fondation de ta colonie en cours…'
          : '👑 Clique sur une case libre de la terre ferme pour fonder ta colonie.';
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
      b.textContent = user ? `${user.displayName || 'Joueur'} · Déconnexion` : 'Se connecter';
    }

    /** Petite fiche au survol d'une case. */
    function hover(state, world, me, id, point) {
      const el = $('#hover');
      if (!state || !id || !point || window.matchMedia('(max-width: 720px)').matches) { el.hidden = true; return; }
      const cell = world.cells[id];
      const b = cfg.biomes[cell.biome];
      const c = SIM.getCell(state, world, cfg, id);
      const owner = c.owner >= 0 ? state.colonies[c.owner] : null;
      let html = `<div class="title">${owner ? `<span class="dot" style="background:${owner.color}"></span>${esc(owner.name)}` : 'Territoire sauvage'}</div>`;
      html += `<div>${esc(b.name)} · ${fmt(c.ants)} ${owner ? 'fourmiz' : 'insectes'}</div>`;
      html += `<div class="hint">Récolte ${fmt(b.food * SIM.seasonAt(state.tick, cell.lat, cfg).factor, 2)}/tour · défense x${fmt(SIM.defenseFactor(state, world, cfg, id, c.owner), 2)}</div>`;
      if (state.phase === 'playing' && me && c.owner !== me.id) html += `<div><b>≈ ${fmt(SIM.forceNeeded(state, world, cfg, id))}</b> fourmiz pour la prendre</div>`;
      el.innerHTML = html;
      el.hidden = false;
      const x = Math.min(point.x + 16, window.innerWidth - el.offsetWidth - 8);
      const y = Math.min(point.y + 16, window.innerHeight - el.offsetHeight - 8);
      el.style.left = x + 'px';
      el.style.top = y + 'px';
    }

    return { update, hover, say, overlay, hideOverlay, setUser, joinName: () => $('#join-name').value.trim() };
  }

  (root.FZ = root.FZ || {}).UI = { createUI };
})(window);
