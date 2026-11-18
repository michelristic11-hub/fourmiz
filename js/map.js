/**
 * Fourmiz — rendu de la carte « jardin » sur un <canvas> (aucune bibliothèque, aucun téléchargement).
 *
 * Couches, de bas en haut :
 *  - terrain     : dessiné une seule fois dans une image hors écran (terrains, flaques, cailloux)
 *  - territoires : teinte et frontières des colonies, redessinées quand les propriétaires changent
 *  - surbrillance, trésors, nids, armées, colonnes en marche, chemin prévu : dessinés à chaque image
 *
 * Interactions (souris et doigt, via Pointer Events) : glisser la carte, molette ou pincement pour zoomer,
 * toucher une case, glisser d'une de ses cases vers une autre pour envoyer des fourmiz.
 */
(function (root) {
  'use strict';

  const TEX = 20;          // résolution de l'image du terrain (pixels par rayon d'hexagone)
  const MIN_SCALE = 3, MAX_SCALE = 70;
  const SQ3 = Math.sqrt(3);
  // Voisin derrière chaque côté d'un hexagone « pointe en haut » (côté i entre les coins i et i+1)
  const EDGE_NB = [
    [[1, 0], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1]],
    [[1, 0], [1, 1], [0, 1], [-1, 0], [0, -1], [1, -1]],
  ];
  const CORNERS = [0, 1, 2, 3, 4, 5].map((i) => {
    const a = (Math.PI / 180) * (60 * i - 30);
    return [Math.cos(a), Math.sin(a)];
  });

  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0) / 4294967296;
  }

  function shade(hex, f) {
    const n = parseInt(hex.slice(1), 16);
    const ch = (v) => Math.max(0, Math.min(255, Math.round(v * f)));
    return `rgb(${ch(n >> 16)},${ch((n >> 8) & 255)},${ch(n & 255)})`;
  }

  function hexPath(ctx, x, y, r) {
    ctx.moveTo(x + CORNERS[0][0] * r, y + CORNERS[0][1] * r);
    for (let i = 1; i < 6; i++) ctx.lineTo(x + CORNERS[i][0] * r, y + CORNERS[i][1] * r);
    ctx.closePath();
  }

  /** Image du terrain (une fois pour toutes). */
  function drawTerrain(world, cfg) {
    const W = world.size.w + 2, H = world.size.h + 2;
    const cv = document.createElement('canvas');
    cv.width = Math.ceil(W * TEX);
    cv.height = Math.ceil(H * TEX);
    const g = cv.getContext('2d');
    g.fillStyle = '#4a3a2a';
    g.fillRect(0, 0, cv.width, cv.height);
    const P = (v) => (v + 1) * TEX;

    function texture(c, x, y, kind) {
      const rnd = ((seed) => () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; })(Math.floor(hash(c.id || x + ',' + y) * 2147483646) + 1);
      const R = TEX * 0.8;
      const dot = (col, r) => { g.fillStyle = col; g.beginPath(); g.arc(x + (rnd() - 0.5) * R * 1.4, y + (rnd() - 0.5) * R * 1.4, r, 0, 7); g.fill(); };
      if (kind === 'grass' || kind === 'moss') {
        g.strokeStyle = kind === 'moss' ? 'rgba(20,70,30,0.45)' : 'rgba(40,90,20,0.45)';
        g.lineWidth = 1;
        for (let i = 0; i < 6; i++) {
          const px = x + (rnd() - 0.5) * R * 1.4, py = y + (rnd() - 0.5) * R * 1.2;
          g.beginPath(); g.moveTo(px, py + 3); g.lineTo(px + (rnd() - 0.5) * 3, py - 3); g.stroke();
        }
      } else if (kind === 'flowers') {
        const cols = ['#fff3', '#ffd6f0', '#ffe66d', '#ffffff', '#c86bfa'];
        for (let i = 0; i < 5; i++) dot(cols[Math.floor(rnd() * cols.length)], 2.2);
      } else if (kind === 'sand' || kind === 'dirt') {
        for (let i = 0; i < 7; i++) dot(kind === 'sand' ? 'rgba(150,120,60,0.35)' : 'rgba(60,40,20,0.3)', 1);
      } else if (kind === 'leaves') {
        for (let i = 0; i < 3; i++) {
          g.fillStyle = ['#8a5523', '#c98b3d', '#a36a2c'][i];
          g.beginPath();
          g.ellipse(x + (rnd() - 0.5) * R, y + (rnd() - 0.5) * R, 4, 2, rnd() * 3, 0, 7);
          g.fill();
        }
      } else if (kind === 'roots') {
        g.strokeStyle = 'rgba(40,25,15,0.6)'; g.lineWidth = 2;
        g.beginPath(); g.moveTo(x - R * 0.7, y + (rnd() - 0.5) * R); g.quadraticCurveTo(x, y + (rnd() - 0.5) * R * 1.5, x + R * 0.7, y + (rnd() - 0.5) * R); g.stroke();
      } else if (kind === 'water') {
        g.strokeStyle = 'rgba(255,255,255,0.45)'; g.lineWidth = 1.2;
        g.beginPath(); g.arc(x + (rnd() - 0.5) * R * 0.6, y + (rnd() - 0.5) * R * 0.6, 3 + rnd() * 3, 0.2, 2.2); g.stroke();
      } else if (kind === 'rock') {
        g.fillStyle = 'rgba(255,255,255,0.25)';
        g.beginPath(); g.ellipse(x - R * 0.2, y - R * 0.25, R * 0.35, R * 0.2, -0.4, 0, 7); g.fill();
        g.fillStyle = 'rgba(0,0,0,0.18)';
        g.beginPath(); g.ellipse(x + R * 0.2, y + R * 0.3, R * 0.4, R * 0.18, 0.2, 0, 7); g.fill();
      }
    }

    for (const id of world.ids) {
      const c = world.cells[id];
      const x = P(c.x), y = P(c.y);
      const base = cfg.biomes[c.biome].color;
      g.fillStyle = shade(base, 0.93 + hash(id) * 0.14);
      g.beginPath(); hexPath(g, x, y, TEX * 1.03); g.fill();
      texture(c, x, y, c.biome);
    }
    for (const o of world.obstacles) {
      const x = P(o.x), y = P(o.y);
      g.fillStyle = shade(cfg.obstacles[o.kind].color, 0.92 + hash(o.col + '/' + o.row) * 0.16);
      g.beginPath(); hexPath(g, x, y, TEX * 1.03); g.fill();
      texture({ id: o.col + '/' + o.row }, x, y, o.kind);
    }
    // Fin quadrillage
    g.strokeStyle = 'rgba(40,30,20,0.12)';
    g.lineWidth = 1;
    g.beginPath();
    for (const id of world.ids) { const c = world.cells[id]; hexPath(g, P(c.x), P(c.y), TEX); }
    g.stroke();
    return cv;
  }

  /**
   * Crée la carte.
   * @param {HTMLElement} container
   * @param {object} world   carte construite par FZ.GARDEN.buildGarden
   * @param {object} cfg     FZ.CONFIG
   * @param {object} on      { click(id|null, point), hover(id|null, point),
   *                           canDrag(id, isTouch) → bool, dragOver(from, over, point), dragEnd(from, over) }
   */
  function createMap(container, world, cfg, on) {
    container.innerHTML = '';
    const canvas = document.createElement('canvas');
    canvas.className = 'garden';
    canvas.style.touchAction = 'none';
    container.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    const terrain = drawTerrain(world, cfg);
    const owners = document.createElement('canvas');
    owners.width = terrain.width; owners.height = terrain.height;
    const og = owners.getContext('2d');

    let dpr = 1, vw = 0, vh = 0;
    const cam = { x: 0, y: 0, scale: 10 };
    let state = null, meId = -1, tickFloat = 0;
    let hl = {}, preview = null;
    let lastOwner = {};
    let needs = true;
    let anim = null;

    function resize() {
      dpr = window.devicePixelRatio || 1;
      vw = container.clientWidth || window.innerWidth;
      vh = container.clientHeight || window.innerHeight;
      canvas.width = Math.round(vw * dpr);
      canvas.height = Math.round(vh * dpr);
      canvas.style.width = vw + 'px';
      canvas.style.height = vh + 'px';
      clamp();
      needs = true;
    }
    function clamp() {
      cam.scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, cam.scale));
      const W = world.size.w, H = world.size.h;
      const mw = vw / cam.scale, mh = vh / cam.scale;
      cam.x = mw > W + 4 ? (W - mw) / 2 : Math.max(-2, Math.min(W + 2 - mw, cam.x));
      cam.y = mh > H + 4 ? (H - mh) / 2 : Math.max(-2, Math.min(H + 2 - mh, cam.y));
    }
    const toScreen = (x, y) => [(x - cam.x) * cam.scale, (y - cam.y) * cam.scale];
    const toWorld = (px, py) => [px / cam.scale + cam.x, py / cam.scale + cam.y];
    const cellAtPoint = (p) => { const [x, y] = toWorld(p.x, p.y); return world.cellAt(x, y); };

    function fitAll() {
      cam.scale = Math.min(vw / (world.size.w + 1), vh / (world.size.h + 1));
      cam.x = 0; cam.y = 0;
      clamp();
    }

    // ---------- Couche des territoires ----------
    const nbKey = (c, r) => c + '_' + r;
    function drawOwners() {
      og.clearRect(0, 0, owners.width, owners.height);
      if (!state) return;
      const P = (v) => (v + 1) * TEX;
      og.globalAlpha = 0.42;
      for (const id in state.cells) {
        const c = state.cells[id];
        if (c.owner < 0 || !world.cells[id]) continue;
        const w = world.cells[id];
        og.fillStyle = state.colonies[c.owner].color;
        og.beginPath(); hexPath(og, P(w.x), P(w.y), TEX * 1.02); og.fill();
      }
      og.globalAlpha = 1;
      og.lineCap = 'round';
      for (const id in state.cells) {
        const c = state.cells[id];
        if (c.owner < 0 || !world.cells[id]) continue;
        const w = world.cells[id];
        const x = P(w.x), y = P(w.y);
        const dirs = EDGE_NB[w.row & 1];
        og.strokeStyle = state.colonies[c.owner].color;
        og.lineWidth = 3;
        og.beginPath();
        for (let i = 0; i < 6; i++) {
          const nb = state.cells[nbKey(w.col + dirs[i][0], w.row + dirs[i][1])];
          if (nb && nb.owner === c.owner) continue;
          const a = CORNERS[i], b = CORNERS[(i + 1) % 6];
          og.moveTo(x + a[0] * TEX * 0.94, y + a[1] * TEX * 0.94);
          og.lineTo(x + b[0] * TEX * 0.94, y + b[1] * TEX * 0.94);
        }
        og.stroke();
      }
    }

    // ---------- Dessin ----------
    function pathPoints(path) { return path.map((id) => world.cells[id]).filter(Boolean).map((c) => toScreen(c.x, c.y)); }

    const emoji = (size) => `${size}px system-ui, "Segoe UI Emoji", "Apple Color Emoji", sans-serif`;
    function draw() {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#3b2e22';
      ctx.fillRect(0, 0, vw, vh);
      const [ox, oy] = toScreen(-1, -1);
      const sw = (terrain.width / TEX) * cam.scale, sh = (terrain.height / TEX) * cam.scale;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(terrain, ox, oy, sw, sh);
      ctx.drawImage(owners, ox, oy, sw, sh);
      const R = cam.scale;
      const visible = (x, y) => x > -R * 2 && y > -R * 2 && x < vw + R * 2 && y < vh + R * 2;

      // Surbrillance
      const styles = { 1: ['#ffffff', 4], 2: ['#ffe14d', 2.5], 3: ['#ff5a3c', 2.5] };
      for (const id in hl) {
        const c = world.cells[id];
        if (!c) continue;
        const [x, y] = toScreen(c.x, c.y);
        if (!visible(x, y)) continue;
        ctx.strokeStyle = styles[hl[id]][0];
        ctx.lineWidth = styles[hl[id]][1];
        ctx.beginPath(); hexPath(ctx, x, y, R * 0.92); ctx.stroke();
      }

      // Trésors
      const T = cfg.treasures.types;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const id in world.treasures) {
        const c = world.cells[id];
        const [x, y] = toScreen(c.x, c.y);
        if (!visible(x, y)) continue;
        const t = T[world.treasures[id]];
        const cell = state && state.cells[id];
        const big = world.treasures[id] === 'beetle' ? 1.5 : 1.1;
        ctx.beginPath();
        ctx.arc(x, y, R * 0.8 * big, 0, 7);
        ctx.fillStyle = 'rgba(255,248,220,0.75)';
        ctx.fill();
        ctx.lineWidth = Math.max(2, R * 0.12);
        ctx.strokeStyle = cell && cell.owner >= 0 ? state.colonies[cell.owner].color : '#7a5c3a';
        ctx.stroke();
        ctx.font = `${Math.max(10, R * 1.1 * big)}px system-ui, "Segoe UI Emoji", "Apple Color Emoji", sans-serif`;
        ctx.fillText(t.icon, x, y + R * 0.05);
      }

      if (!state) { drawPreview(); return; }

      // Armées : bulles proportionnelles au nombre de fourmiz
      const labels = R >= 13;
      for (const id in state.cells) {
        const c = state.cells[id];
        if (c.owner < 0) continue;
        const w = world.cells[id];
        if (!w) continue;
        const [x, y] = toScreen(w.x, w.y);
        if (!visible(x, y)) continue;
        const n = (c.w || 0) + (c.s || 0) + (c.e || 0) + (c.b || 0);
        if (n <= 0) continue;
        const rad = Math.min(R * 0.85, Math.max(2, R * (0.22 + 0.11 * Math.sqrt(n))));
        const mine = c.owner === meId;
        const tx = world.treasures[id] ? R * 0.55 : 0;
        ctx.beginPath();
        ctx.arc(x + tx, y + tx, rad, 0, 7);
        ctx.fillStyle = state.colonies[c.owner].color;
        ctx.globalAlpha = 0.9;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.lineWidth = mine ? 2 : 1;
        ctx.strokeStyle = mine ? '#ffffff' : '#2b2118';
        ctx.stroke();
        const fighters = (c.s || 0) + (c.e || 0);
        if (fighters >= 5 && R >= 9) {
          ctx.font = emoji(Math.max(8, R * 0.38));
          ctx.fillText(c.s >= c.e ? '⚔️' : '💨', x + tx + rad * 0.85, y + tx - rad * 0.85);
        }
        if (labels) {
          ctx.font = `bold ${Math.max(9, Math.min(14, R * 0.5))}px system-ui, sans-serif`;
          ctx.lineWidth = 3;
          ctx.strokeStyle = 'rgba(255,255,255,0.9)';
          ctx.strokeText(String(n), x + tx, y + tx);
          ctx.fillStyle = '#1b140e';
          ctx.fillText(String(n), x + tx, y + tx);
        }
      }

      // Nids
      for (const col of state.colonies) {
        if (!col.alive || !col.queenAlive || !col.nest || !world.cells[col.nest]) continue;
        const w = world.cells[col.nest];
        const [x, y] = toScreen(w.x, w.y);
        if (!visible(x, y)) continue;
        ctx.font = `${Math.max(11, R * 0.9)}px system-ui, "Segoe UI Emoji", "Apple Color Emoji", sans-serif`;
        ctx.fillText('👑', x, y - R * 0.75);
      }

      // Héros scarabées
      for (const col of state.colonies) {
        const h = col.alive && col.unlocks && col.unlocks.beetle && col.hero;
        if (!h || h.down || !h.cell || !world.cells[h.cell]) continue;
        const w = world.cells[h.cell];
        const [x0, y0] = toScreen(w.x, w.y);
        if (!visible(x0, y0)) continue;
        const x = x0 - R * 0.55, y = y0 + R * 0.45;
        ctx.beginPath();
        ctx.arc(x, y, Math.max(7, R * 0.42), 0, 7);
        ctx.fillStyle = col.color;
        ctx.fill();
        ctx.lineWidth = 2; ctx.strokeStyle = '#fff'; ctx.stroke();
        ctx.font = emoji(Math.max(10, R * 0.6));
        ctx.fillText('🪲', x, y + 1);
        if (R >= 12) {
          ctx.font = `bold ${Math.max(8, R * 0.32)}px system-ui, sans-serif`;
          ctx.fillStyle = '#1b140e';
          ctx.fillText(String(h.lvl || 1), x + R * 0.38, y - R * 0.32);
        }
      }

      // Colonnes en marche
      ctx.setLineDash([R * 0.35, R * 0.45]);
      for (const m of state.moves) {
        const pts = pathPoints(m.path || [m.from, m.to]);
        if (pts.length < 2) continue;
        const color = state.colonies[m.owner] ? state.colonies[m.owner].color : '#000';
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(1.5, R * 0.14);
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      for (const m of state.moves) {
        const pts = pathPoints(m.path || [m.from, m.to]);
        if (pts.length < 2) continue;
        const legs = m.legs || [0, m.arrive - m.depart];
        const t = Math.max(0, Math.min(legs[legs.length - 1], tickFloat - m.depart));
        let i = 1;
        while (i < legs.length - 1 && legs[i] < t) i++;
        const f = Math.max(0, Math.min(1, (t - legs[i - 1]) / Math.max(0.001, legs[i] - legs[i - 1])));
        const a = pts[i - 1], b = pts[i] || a;
        const x = a[0] + (b[0] - a[0]) * f, y = a[1] + (b[1] - a[1]) * f;
        const n = (m.w || 0) + (m.s || 0) + (m.e || 0) + (m.b || 0);
        ctx.beginPath();
        ctx.arc(x, y, Math.max(3, Math.min(R * 0.6, R * (0.18 + 0.06 * Math.sqrt(n)))), 0, 7);
        ctx.fillStyle = state.colonies[m.owner] ? state.colonies[m.owner].color : '#000';
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#fff';
        ctx.stroke();
        if (m.h) { ctx.font = emoji(Math.max(10, R * 0.6)); ctx.fillText('🪲', x, y - R * 0.5); }
      }
      drawPreview();
    }
    function drawPreview() {
      if (!preview) return;
      const pts = pathPoints(preview.path);
      if (pts.length < 2) return;
      ctx.setLineDash([cam.scale * 0.3, cam.scale * 0.5]);
      ctx.lineCap = 'round';
      ctx.strokeStyle = preview.color || '#fff';
      ctx.lineWidth = Math.max(3, cam.scale * 0.25);
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    function frame(t) {
      if (anim) {
        const k = Math.min(1, (t - anim.t0) / anim.ms);
        const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        cam.scale = anim.from.scale * Math.pow(anim.to.scale / anim.from.scale, e);
        const cx = anim.from.cx + (anim.to.cx - anim.from.cx) * e, cy = anim.from.cy + (anim.to.cy - anim.from.cy) * e;
        cam.x = cx - vw / 2 / cam.scale; cam.y = cy - vh / 2 / cam.scale;
        clamp();
        if (k >= 1) anim = null;
        needs = true;
      }
      if (needs) { needs = false; draw(); }
      requestAnimationFrame(frame);
    }

    function animateTo(cx, cy, scale) {
      scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale));
      anim = {
        t0: performance.now(), ms: 600,
        from: { scale: cam.scale, cx: cam.x + vw / 2 / cam.scale, cy: cam.y + vh / 2 / cam.scale },
        to: { scale, cx, cy },
      };
    }
    function zoomAt(px, py, f) {
      const [wx, wy] = toWorld(px, py);
      cam.scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, cam.scale * f));
      cam.x = wx - px / cam.scale; cam.y = wy - py / cam.scale;
      clamp();
      needs = true;
    }

    // ---------- Interactions ----------
    const pointers = new Map();
    let gesture = null; // { mode: 'pan'|'drag'|'pinch', ... }

    function pt(e) { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }

    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      const p = pt(e);
      pointers.set(e.pointerId, p);
      anim = null;
      if (pointers.size === 2) {
        if (gesture && gesture.mode === 'drag') on.dragEnd(null, null);
        const [a, b] = [...pointers.values()];
        gesture = { mode: 'pinch', dist: Math.hypot(a.x - b.x, a.y - b.y), moved: true };
        return;
      }
      if (pointers.size > 2) return;
      const isTouch = e.pointerType !== 'mouse';
      const id = cellAtPoint(p);
      const base = { start: p, last: p, t0: performance.now(), moved: false, id };
      if (id && on.canDrag(id, isTouch)) gesture = Object.assign(base, { mode: 'drag', from: id, over: id });
      else gesture = Object.assign(base, { mode: 'pan' });
    });

    canvas.addEventListener('pointermove', (e) => {
      const p = pt(e);
      if (!pointers.has(e.pointerId)) {
        if (e.pointerType === 'mouse') {
          const id = cellAtPoint(p);
          canvas.style.cursor = id ? (on.canDrag(id, false) ? 'grab' : 'pointer') : 'default';
          on.hover(id, p);
        }
        return;
      }
      pointers.set(e.pointerId, p);
      if (!gesture) return;
      if (gesture.mode === 'pinch' && pointers.size >= 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (gesture.dist > 0) zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, d / gesture.dist);
        gesture.dist = d;
        return;
      }
      if (Math.hypot(p.x - gesture.start.x, p.y - gesture.start.y) > 6) gesture.moved = true;
      if (gesture.mode === 'pan') {
        cam.x -= (p.x - gesture.last.x) / cam.scale;
        cam.y -= (p.y - gesture.last.y) / cam.scale;
        clamp();
        needs = true;
      } else if (gesture.mode === 'drag') {
        canvas.style.cursor = 'grabbing';
        const id = cellAtPoint(p);
        if (id && id !== gesture.over) { gesture.over = id; on.dragOver(gesture.from, id, p); }
      }
      gesture.last = p;
    });

    function end(e, cancelled) {
      pointers.delete(e.pointerId);
      const g = gesture;
      if (!g) return;
      if (g.mode === 'pinch') { if (pointers.size === 0) gesture = null; return; }
      gesture = null;
      const p = pt(e);
      if (cancelled) { if (g.mode === 'drag') on.dragEnd(null, null); return; }
      if (g.mode === 'drag') {
        canvas.style.cursor = '';
        if (g.over !== g.from) { on.dragEnd(g.from, g.over); return; }
        on.dragEnd(g.from, null);
      }
      if (!g.moved && performance.now() - g.t0 < 700) on.click(cellAtPoint(p), p);
    }
    canvas.addEventListener('pointerup', (e) => end(e, false));
    canvas.addEventListener('pointercancel', (e) => end(e, true));
    canvas.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && !pointers.size) on.hover(null); });
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const p = pt(e);
      zoomAt(p.x, p.y, Math.pow(1.0015, -e.deltaY));
    }, { passive: false });

    window.addEventListener('resize', resize);
    resize();
    fitAll();
    requestAnimationFrame(frame);

    return {
      setColonyColors() { lastOwner = {}; },
      /** Met à jour territoires, armées, nids et déplacements. */
      render(s, me, tf) {
        state = s; meId = me; tickFloat = tf == null ? s.tick : tf;
        let changed = false;
        const now = {};
        for (const id in s.cells) {
          const o = s.cells[id].owner;
          if (o >= 0) { now[id] = o; if (lastOwner[id] !== o) changed = true; }
        }
        if (!changed) for (const id in lastOwner) if (!(id in now)) { changed = true; break; }
        if (changed) { lastOwner = now; drawOwners(); }
        needs = true;
      },
      renderMoves(s, tf) { state = s; tickFloat = tf; needs = true; },
      /** Chemin prévu pendant un glisser-déposer (null pour l'effacer). */
      showPath(path, color) { preview = path ? { path, color } : null; needs = true; },
      /** Surligne la case sélectionnée (1), les cibles renfort (2) et attaque (3). */
      highlight(map3) { hl = Object.assign({}, map3); needs = true; },
      flyTo(id, zoom) {
        const c = world.cells[id];
        if (!c) return;
        const scale = Math.max(cam.scale, zoom && zoom >= 5 ? 34 : 26);
        // Sur téléphone, la case se place dans le haut de l'écran (la barre d'action occupe le bas)
        const fy = vw < 720 ? 0.3 : 0.5;
        animateTo(c.x, c.y + (0.5 - fy) * vh / scale, scale);
      },
      /** Fait défiler la vue si la case est cachée par la barre d'action (téléphone). */
      ensureVisible(id) {
        const c = world.cells[id];
        if (!c || vw >= 720) return;
        const [, y] = toScreen(c.x, c.y);
        if (y > vh * 0.12 && y < vh * 0.38) return;
        animateTo(c.x, c.y + 0.2 * vh / cam.scale, cam.scale);
      },
      /** Cadre la vue sur un ensemble de cases. */
      fitCells(ids) {
        const pts = ids.map((id) => world.cells[id]).filter(Boolean);
        if (!pts.length) return;
        let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
        for (const c of pts) { x0 = Math.min(x0, c.x); x1 = Math.max(x1, c.x); y0 = Math.min(y0, c.y); y1 = Math.max(y1, c.y); }
        const scale = Math.min(vw / (x1 - x0 + 6), vh / (y1 - y0 + 6), 34);
        animateTo((x0 + x1) / 2, (y0 + y1) / 2, scale);
      },
      zoomBy(f) { zoomAt(vw / 2, vh / 2, f); },
      /** Réinitialise l'affichage. */
      reset() { state = null; lastOwner = {}; hl = {}; preview = null; drawOwners(); fitAll(); needs = true; },
      /** Pour les tests : position à l'écran du centre d'une case. */
      screenOf(id) { const c = world.cells[id]; const [x, y] = toScreen(c.x, c.y); return { x, y }; },
    };
  }

  (root.FZ = root.FZ || {}).MAP = { createMap };
})(window);
