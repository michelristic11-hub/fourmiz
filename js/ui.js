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

  function castesMix(mix) {
    return `${Math.round(mix.w * 100)} % ouvrières, ${Math.round(mix.s * 100)} % soldates, ${Math.round(mix.e * 100)} % éclaireuses` +
      (mix.b ? `, ${Math.round(mix.b * 100)} % scarabées` : '');
  }

  /** « 🐜 12 · ⚔️ 4 · 💨 1 » pour un groupe de fourmiz. */
  function castesLine(g, cfg) {
    return ['w', 's', 'e', 'b'].filter((k) => (g[k] || 0) > 0).map((k) => `${cfg.castes[k].icon} ${fmt(g[k])}`).join(' · ') || '0';
  }

  /** Durée lisible à partir d'un nombre de ticks. */
  function duration(ticks, cfg) {
    const s = Math.round(ticks * cfg.time.tickSeconds);
    if (s < 60) return `${s} s`;
    const m = Math.floor(s / 60);
    return s % 60 ? `${m} min ${s % 60} s` : `${m} min`;
  }

  /**
   * @param {object} cfg FZ.CONFIG
   * @param {object} act { speed, newGame, layMode, caste, evolve, share, sendCaste, autoWorkers, rally, zoomIn, zoomOut,
   *                       closeSelection, overlayButton, userButton, invite, goNest, goArmy, goAll }
   */
  function createUI(cfg, act) {
    const SIM = root.FZ.SIM;
    const toast = document.createElement('div');
    toast.id = 'toast';
    Object.assign(toast.style, {
      position: 'absolute', top: '64px', left: '50%', transform: 'translateX(-50%)', zIndex: 8,
      background: 'var(--ink)', color: 'var(--bg)', padding: '8px 14px', borderRadius: '8px',
      boxShadow: 'var(--shadow)', fontSize: '13px', maxWidth: 'calc(100% - 32px)', textAlign: 'center', pointerEvents: 'none',
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
    segment('#send-caste', 'caste', (v) => act.sendCaste(v));
    $('#caste-presets').innerHTML = Object.keys(cfg.castePresets).map((k) =>
      `<button data-preset="${k}" title="${castesMix(cfg.castePresets[k].mix)}">${esc(cfg.castePresets[k].label)}</button>`).join('');
    segment('#caste-presets', 'preset', (v) => act.caste(v));
    $('#evo-list').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-evo]');
      if (b && !b.disabled) act.evolve(b.dataset.evo);
    });
    $('#btn-new').addEventListener('click', () => { if (confirmNew()) act.newGame(); });
    $('#btn-rally').addEventListener('click', () => act.rally());
    $('#ab-close').addEventListener('click', () => act.closeSelection());
    $('#with-hero').addEventListener('change', (e) => act.withHero(e.target.checked));
    $('#go-hero').addEventListener('click', () => act.goHero());
    $('#overlay-btn').addEventListener('click', () => act.overlayButton());
    $('#btn-user').addEventListener('click', () => act.userButton());
    $('#btn-invite').addEventListener('click', () => act.invite());
    $('#go-nest').addEventListener('click', () => act.goNest());
    $('#go-army').addEventListener('click', () => act.goArmy());
    $('#go-all').addEventListener('click', () => act.goAll());
    $('#zoom-in').addEventListener('click', () => act.zoomIn());
    $('#zoom-out').addEventListener('click', () => act.zoomOut());

    // Panneau repliable (téléphone) et onglets
    const panel = $('#panel');
    let tab = 'colony';
    let hadMe = null;
    function showTab(t) {
      tab = t;
      document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
      document.querySelectorAll('#panel section[data-tab]').forEach((sec) => sec.classList.toggle('tab-on', sec.dataset.tab === t));
    }
    showTab(tab);
    $('#tabs').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-tab]');
      if (!b) return;
      const collapsed = panel.classList.contains('collapsed');
      if (!collapsed && b.dataset.tab === tab) { setOpen(false); return; } // re-toucher l'onglet le referme
      showTab(b.dataset.tab);
      if (collapsed) setOpen(true);
    });
    $('#panel-close').addEventListener('click', () => setOpen(false));
    document.addEventListener('keydown', (e) => {
      if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
      if (e.key === 'Escape') setOpen(false);
      const keys = { 1: 'colony', 2: 'missions', 3: 'evos', 4: 'world', 5: 'help' };
      if (keys[e.key]) { const t = keys[e.key]; if (!panel.classList.contains('collapsed') && t === tab) setOpen(false); else { showTab(t); setOpen(true); } }
    });
    function setOpen(open) {
      panel.classList.toggle('collapsed', !open);
      $('#panel-toggle').setAttribute('aria-expanded', String(open));
      $('#panel-toggle-text').textContent = open ? 'Réduire' : 'Détails';
      document.body.classList.toggle('panel-open', open);
      if (open) panel.scrollTop = 0;
      syncPanelHeight();
    }
    $('#panel-toggle').addEventListener('click', () => setOpen(panel.classList.contains('collapsed')));
    function syncPanelHeight() {
      const h = isPhone() ? panel.offsetHeight : 0;
      document.documentElement.style.setProperty('--panel-h', h + 'px');
    }
    window.addEventListener('resize', syncPanelHeight);
    if (window.ResizeObserver) new ResizeObserver(syncPanelHeight).observe(panel);

    // Légende des terrains et des trésors
    $('#legend-list').innerHTML = Object.keys(cfg.biomes).map((k) => {
      const b = cfg.biomes[k];
      return `<li><span class="sw" style="background:${b.color}"></span>${esc(b.name)}<span class="val">${fmt(b.food, 2)}</span></li>`;
    }).join('') + Object.keys(cfg.obstacles).map((k) =>
      `<li><span class="sw" style="background:${cfg.obstacles[k].color}"></span>${esc(cfg.obstacles[k].name)}<span class="val">✖</span></li>`).join('');

    /** Liste des trésors et de leurs pouvoirs (✅ si la colonie le tient). */
    function treasureList(me) {
      const perMin = 60 / cfg.time.tickSeconds;
      const held = (me && me.stats && me.stats.treasures) || {};
      return Object.keys(cfg.treasures.types).map((k) => {
        const t = cfg.treasures.types[k];
        const on = held[k] > 0;
        return `<li class="tp${on ? ' on' : ''}"><span class="ticon">${t.icon}</span><div><b>${esc(t.name)}</b> ${on ? '✅' : ''}` +
          `<div class="hint">${esc(t.effect)} · +${fmt(t.points * perMin, 1)} pts/min</div></div></li>`;
      }).join('');
    }

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

    function seasonLabel(state) {
      const s = SIM.seasonAt(state.tick, 45, cfg);
      const icon = ['🌱', '☀️', '🍂', '❄️'][s.index];
      return isPhone() ? `${icon} An ${s.year}` : `${icon} ${s.name} · An ${s.year}`;
    }

    /** Texte d'une mission, avec sa progression. */
    function missionHTML(state, world, me, m) {
      const def = cfg.missions.list[m.k];
      if (!def) return '';
      const T = cfg.treasures.types;
      const text = def.text
        .replace('{goal}', fmt(m.goal))
        .replace('{biome}', m.biome && cfg.biomes[m.biome] ? cfg.biomes[m.biome].name.toLowerCase() : '')
        .replace('{treasure}', m.treasure && T[m.treasure] ? `${T[m.treasure].icon} ${T[m.treasure].name}` : '')
        .replace('{minutes}', fmt((m.goal * cfg.time.tickSeconds) / 60));
      const p = Math.max(0, SIM.missionProgress(state, world, cfg, me, m));
      const pct = Math.min(100, (100 * p) / Math.max(1, m.goal));
      const shown = m.k === 'beetle' ? `${fmt((p * cfg.time.tickSeconds) / 60, 1)} / ${fmt((m.goal * cfg.time.tickSeconds) / 60)} min` : `${fmt(Math.min(p, m.goal))} / ${fmt(m.goal)}`;
      const reward = `+${def.points} pts` + (def.food ? ` · +${def.food} 🍯` : '') + (def.unlock ? ' · 🪲 débloque le héros scarabée' : '');
      return `<li class="mission${def.rare ? ' rare' : ''}"><div class="m-text">${esc(text)}</div>` +
        `<div class="bar"><div style="width:${pct}%"></div></div><div class="hint">${shown} · ${reward}</div></li>`;
    }

    /** Fiche d'une case (barre d'action et infobulle). */
    function cellCard(state, world, me, id) {
      const cell = world.cells[id];
      const b = cfg.biomes[cell.biome];
      const c = SIM.getCell(state, world, cfg, id);
      const owner = c.owner >= 0 ? state.colonies[c.owner] : null;
      const mine = me && owner && owner.id === me.id;
      const isNest = owner && owner.nest === id && owner.queenAlive;
      const sleeping = owner && SIM.asleep(state, cfg, owner);
      let html = `<div class="title">${owner ? `<span class="dot" style="background:${owner.color}"></span>${esc(owner.name)}` : 'Territoire sauvage'}${isNest ? ' · 👑 nid' : ''}${sleeping ? ' · 🛡️ endormie' : ''}</div>`;
      const tr = SIM.treasureAt(world, id);
      if (tr) {
        const T = cfg.treasures.types[tr];
        const perMin = 60 / cfg.time.tickSeconds;
        html += `<div class="treasure">${T.icon} <b>${esc(T.name)}</b> : <b>${esc(T.effect)}</b> · +${fmt(T.points * perMin, 1)} pts/min · +${fmt(T.food / cfg.time.tickSeconds, 1)} nourriture/s${tr === 'beetle' ? ' · ⭐ mission rare' : ''}</div>`;
      }
      if (isNest) html += `<div class="treasure">🛡️ Garde royale : <b>${fmt(owner.guard)}</b> / ${fmt(owner.stats.guardMax || SIM.guardMax(cfg, owner))} (se régénère)</div>`;
      if (owner && SIM.heroAt(owner, id)) html += `<div class="treasure">${cfg.hero.icon} <b>Héros niveau ${owner.hero.lvl}</b> : force ×${fmt(SIM.heroBoost(cfg, owner.hero), 2)} et +${fmt(SIM.heroPower(cfg, owner.hero))}</div>`;
      if (sleeping && !mine) html += `<div class="hint">🛡️ Son joueur est absent : cette colonie dort et ne peut pas être attaquée.</div>`;
      html += `<div>${esc(b.name)} · ${owner ? castesLine(c, cfg) : `<b>${fmt(SIM.total(c))}</b> insectes`}</div>`;
      if (mine) {
        const h = SIM.harvestInfo(state, world, cfg, owner, id);
        const perS = 1 / cfg.time.tickSeconds;
        html += `<div class="hint">Ouvrières ${fmt(c.w)}/${h.opt} idéal · rendement ${fmt(Math.min(h.eff, 9) * 100)} % · logistique ${fmt(h.logi * 100)} % · <b>+${fmt(h.food * perS, 1)}/s</b></div>`;
      } else {
        html += `<div class="hint">Récolte ${fmt(b.food, 2)} · ${SIM.optimalWorkers(world, cfg, id)} ouvrières idéal · défense x${fmt(SIM.defenseFactor(state, world, cfg, id, c.owner), 2)}</div>`;
        if (state.phase === 'playing' && me) html += `<div>Force de défense ≈ <b>${fmt(SIM.defensePower(state, world, cfg, id))}</b> <span class="hint">(ouvrière 1, soldate ${cfg.castes.s.power}, éclaireuse ${cfg.castes.e.power})</span></div>`;
      }
      return html;
    }

    /** Liste des évolutions de la colonie. */
    function renderEvos(me) {
      const E = cfg.evolutions;
      let html = '', branch = '';
      for (const k in E.list) {
        const e = E.list[k];
        if (e.branch !== branch) { branch = e.branch; html += `<div class="evo-branch">${esc(branch)}</div>`; }
        const lvl = SIM.evoLevel(me, k);
        const cost = SIM.evoCost(cfg, me, k);
        const pips = Array.from({ length: E.maxLevel }, (_, i) => `<span class="pip${i < lvl ? ' on' : ''}"></span>`).join('');
        html += `<div class="evo"><span class="evo-icon">${e.icon}</span><div class="evo-text"><b>${esc(e.name)}</b> ${pips}<div class="hint">${esc(e.text)}</div></div>` +
          (cost == null ? '<span class="hint">max</span>' : `<button class="secondary evo-buy" data-evo="${k}" ${me.food < cost ? 'disabled' : ''}>${fmt(cost)}</button>`) + '</div>';
      }
      const el = $('#evo-list');
      if (el.dataset.html !== html) { el.innerHTML = html; el.dataset.html = html; }
    }

    /**
     * Met à jour tout l'écran.
     * @param {object} view { me, uid, sendCaste, selected, inspected, mode, hadColony, joinPending, net: { connected } }
     */
    function update(state, world, view) {
      const me = view.me;
      const online = view.mode === 'online';
      $('#season').textContent = seasonLabel(state);

      if (online) {
        const net = view.net || {};
        const el = $('#net');
        el.classList.toggle('off', !net.connected);
        el.textContent = isPhone() ? (net.connected ? '🟢' : '🔴') : !net.connected ? '🔴 Hors ligne' : '🟢 En direct';
      }

      // Fonder une colonie / sa colonie
      $('#join').hidden = !!me;
      $('#colony').hidden = !me;
      $('#evos').hidden = !me;
      document.querySelectorAll('#tabs button').forEach((b) => { b.hidden = !me && ['colony', 'missions', 'evos'].indexOf(b.dataset.tab) >= 0; });
      if (!me && ['colony', 'missions', 'evos'].indexOf(tab) >= 0) showTab('world');
      // Sans colonie : panneau ouvert (formulaire de fondation). Dès qu'on joue : replié, la carte est libre.
      if (me && !hadMe) { showTab('colony'); if (!isPhone()) setOpen(false); }
      if (!me && hadMe !== false && !isPhone()) setOpen(true);
      hadMe = !!me;
      $('#missions').hidden = !me;
      $('#tabs').hidden = false;
      if (!me) $('#hud').hidden = true;
      if (!me) {
        const dead = view.uid ? state.colonies.filter((c) => c.uid === view.uid && !c.alive).pop() : null;
        $('#join-text').textContent = dead || view.hadColony
          ? `Ta reine est morte : ta colonie a disparu${dead ? ` (score ${fmt(dead.score)})` : ''}. Choisis une nouvelle case libre pour recommencer.`
          : 'Choisis un nom, puis touche une case libre (pas un trésor) pour y installer ta reine et tes premières fourmiz.';
      }
      if (me) {
        const s = me.stats;
        $('#col-dot').style.background = me.color;
        $('#col-name').textContent = me.name;
        $('#st-ants').textContent = fmt(s.ants);
        $('#st-terr').textContent = fmt(s.territories);
        $('#st-score').textContent = fmt(me.score);
        const perMin = 60 / cfg.time.tickSeconds;
        const mh = (me.missions || []).map((m) => missionHTML(state, world, me, m)).join('');
        const ready = (me.missions || []).filter((m) => SIM.missionProgress(state, world, cfg, me, m) >= m.goal * 0.8).length;
        $('#tab-badge').hidden = !ready;
        $('#tab-badge').textContent = ready;
        if ($('#mission-list').dataset.html !== mh) { $('#mission-list').innerHTML = mh; $('#mission-list').dataset.html = mh; }
        const th = treasureList(me);
        if ($('#tpowers').dataset.html !== th) { $('#tpowers').innerHTML = th; $('#tpowers').dataset.html = th; }
        $('#st-guard').innerHTML = `🛡️ Garde royale <b>${fmt(me.guard)}</b> / ${fmt(s.guardMax)} <span class="hint">· défend ton nid, grandit avec ta colonie</span>`;
        const H = SIM.heroOf(me);
        $('#st-hero').innerHTML = H
          ? `${cfg.hero.icon} Héros niveau <b>${H.lvl}</b> · ${H.down ? `se soigne (retour dans ${duration(Math.max(0, H.down - state.tick), cfg)})` : H.cell ? 'prêt' : 'en route'}` +
            ` <span class="hint">· xp ${fmt(H.xp)}${H.lvl < cfg.hero.xpLevels.length ? ' / ' + cfg.hero.xpLevels[H.lvl] : ''}</span>`
          : `${cfg.hero.icon} Héros : <span class="hint">à débloquer avec la mission rare ⭐</span>`;
        $('#go-hero').hidden = !(H && H.cell);
        // Bandeau toujours visible
        const near = (me.missions || []).map((m) => ({ m, p: Math.min(1, Math.max(0, SIM.missionProgress(state, world, cfg, me, m)) / Math.max(1, m.goal)) }))
          .sort((a, b) => b.p - a.p)[0];
        const netS = (s.net || 0) / cfg.time.tickSeconds;
        $('#hud').hidden = false;
        $('#hud').innerHTML = `<span title="Nourriture">🍯 ${fmt(me.food)} <small class="${netS >= 0 ? 'pos' : 'neg'}">${netS >= 0 ? '+' : ''}${fmt(netS, 1)}/s</small></span>` +
          `<span title="Fourmiz">🐜 ${fmt(s.ants)}</span><span title="Score">🏅 ${fmt(me.score)}${s.points > 0 ? ` <small class="pos">+${fmt(s.points * perMin, 1)}/min</small>` : ''}</span>` +
          (near ? `<span class="hud-m" title="Mission la plus avancée">🎯 ${fmt(near.p * 100)} %</span>` : '');
        $('#st-castes').innerHTML = `${castesLine(s, cfg)} <span class="hint">· force ${fmt(s.power)}</span>`;
        $('#st-workers').innerHTML = '🔄 Ouvrières automatiques · ' + (s.idle > 0.5 ? `${fmt(s.idle)} en trop (elles rejoignent ton armée)` : 'aucune en trop') +
          (s.missing > 0.5 ? ` · ${fmt(s.missing)} manquent, elles arrivent` : '');
        const net = s.net || 0;
        const perS = 1 / cfg.time.tickSeconds;
        $('#st-food-short').innerHTML = `${fmt(me.food)} <span class="${net >= 0 ? 'pos' : 'neg'}" style="font-size:12px">${net >= 0 ? '▲' : '▼'}</span>`;
        $('#st-queen').textContent = '👑';
        $('#st-food').textContent = `${fmt(me.food)} / ${fmt(s.cap)}`;
        $('#food-bar').style.width = Math.min(100, (100 * me.food) / Math.max(1, s.cap)) + '%';
        $('#st-net').innerHTML =
          `Par seconde : +${fmt(s.income * perS, 1)} récolte · −${fmt(s.upkeep * perS, 1)} entretien · −${fmt(s.layCost * perS, 1)} ponte` +
          (s.spoil > 0 ? ` · −${fmt(s.spoil * perS, 1)} gâté (hiver)` : '') +
          ` = <span class="${net >= 0 ? 'pos' : 'neg'}">${net >= 0 ? '+' : ''}${fmt(net * perS, 1)}</span>` +
          (me.food <= 0 && net < 0 ? ' <span class="neg">FAMINE</span>' : '');
        document.querySelectorAll('#lay-modes button').forEach((b) => b.classList.toggle('on', b.dataset.mode === me.layMode));
        document.querySelectorAll('#caste-presets button').forEach((b) => b.classList.toggle('on', b.dataset.preset === me.caste));
        let lay = `≈ ${fmt(s.layRate * perS, 1)} œufs par seconde au nid (${castesMix(SIM.mixFor(cfg, me))})`;
        if (me.queenAlive && me.nest) {
          const season = SIM.seasonAt(state.tick, world.cells[me.nest].lat, cfg);
          if (!season.tropical && season.index === 3) lay += ' (hiver : ponte ralentie)';
        }
        $('#lay-info').textContent = lay;
        renderEvos(me);
      }

      // Barre d'action : case à soi choisie, ou simple fiche d'une autre case
      const sel = me && view.selected && state.cells[view.selected] && state.cells[view.selected].owner === me.id ? view.selected : null;
      const info = sel || view.inspected;
      $('#actionbar').hidden = !info || state.phase !== 'playing';
      if (info) {
        $('#ab-info').innerHTML = cellCard(state, world, me, info);
        $('#ab-actions').hidden = !sel;
        const heroHere = !!(sel && SIM.heroAt(me, sel));
        document.querySelector('#send-caste [data-caste="hero"]').hidden = !heroHere;
        $('#hero-toggle').hidden = !heroHere || view.sendCaste === 'hero';
      }

      // Classement
      const rows = state.colonies.filter((c) => c.alive).sort((a, b) => (b.score || 0) - (a.score || 0));
      $('#ranking').innerHTML = rows.slice(0, 15).map((c) =>
        `<li class="${me && c.id === me.id ? 'me' : ''}"><span class="dot" style="background:${c.color}"></span>` +
        `<span class="name">${esc(c.name)}${c.isAI ? ' <span class="me-badge">IA</span>' : ''}${SIM.asleep(state, cfg, c) ? ' 🛡️' : ''}${!c.queenAlive ? ' 💀' : ''}</span>` +
        `<span title="${fmt(c.stats.territories)} cases · ${fmt(c.stats.ants)} fourmiz · force ${fmt(c.stats.power)}">🏅 ${fmt(c.score)}</span></li>`).join('');
      $('#hall').innerHTML = (state.hall || []).map((h) =>
        `<li><span class="dot" style="background:${h.color}"></span><span class="name">${esc(h.name)}${h.ai ? ' <span class="me-badge">IA</span>' : ''}</span><span>🏅 ${fmt(h.score)}</span></li>`).join('') ||
        '<li class="hint">Personne pour l’instant : les colonies disparues y laissent leur score.</li>';

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
          : '👑 Touche une case libre du jardin pour fonder ta colonie.';
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
      b.textContent = user ? (isPhone() ? '↪' : `${name} · Déconnexion`) : 'Se connecter';
      b.title = user ? 'Se déconnecter' : '';
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
      castesLine: (g) => castesLine(g, cfg),
      joinName: () => $('#join-name').value.trim(),
    };
  }

  (root.FZ = root.FZ || {}).UI = { createUI };
})(window);
