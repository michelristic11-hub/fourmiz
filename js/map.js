/**
 * Fourmiz — rendu de la carte avec MapLibre GL JS et les tuiles gratuites OpenFreeMap.
 *
 * Calques, de bas en haut :
 *  - cells-fill    : couleur du biome de chaque case (toujours visible)
 *  - cells-owner   : teinte de la colonie propriétaire, par-dessus le biome
 *  - cells-border  : contour de la couleur de la colonie
 *  - cells-hl      : surbrillance (case choisie, cibles)
 *  - moves         : colonnes de fourmiz en route, le long de leur chemin
 *  - armies        : bulles proportionnelles au nombre de fourmiz sur chaque case
 *  - nests         : nids des reines
 *  - preview       : chemin prévu pendant un glisser-déposer
 * La couleur de chaque case passe par le « feature-state » : seules les cases modifiées sont mises à jour.
 */
(function (root) {
  'use strict';

  const STYLE_URL = 'https://tiles.openfreemap.org/styles/positron';
  const FALLBACK_STYLE = {
    version: 8,
    sources: {},
    layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#b9d3df' } }],
  };

  async function loadStyle() {
    try {
      const r = await fetch(STYLE_URL);
      if (!r.ok) throw new Error(r.status);
      const style = await r.json();
      return { style, glyphs: true };
    } catch (e) {
      console.warn('Fond de carte indisponible, affichage simplifié.', e);
      return { style: FALLBACK_STYLE, glyphs: false };
    }
  }

  /**
   * Crée la carte.
   * @param {HTMLElement} container
   * @param {object} world   monde construit par FZ.WORLD.buildWorld
   * @param {object} cfg     FZ.CONFIG
   * @param {object} on      { click(id|null, point), hover(id|null, point),
   *                           canDrag(id, isTouch) → bool, dragOver(from, over, point), dragEnd(from, over) }
   */
  async function createMap(container, world, cfg, on) {
    const { style, glyphs } = await loadStyle();
    const map = new maplibregl.Map({
      container,
      style,
      center: [10, 30],
      zoom: 1.6,
      minZoom: 1,
      maxZoom: 8,
      attributionControl: { compact: true, customAttribution: 'Terres © Natural Earth · Grille H3' },
      dragRotate: false,
      pitchWithRotate: false,
    });
    map.touchZoomRotate.disableRotation();
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
    await new Promise((res) => map.on('load', res));

    const index = {};
    world.ids.forEach((id, i) => { index[id] = i + 1; }); // id 0 évité (feature-state)
    const features = world.ids.map((id, i) => ({
      type: 'Feature',
      id: i + 1,
      properties: { b: world.cells[id].biome },
      geometry: { type: 'Polygon', coordinates: [world.boundary(id)] },
    }));
    map.addSource('cells', { type: 'geojson', data: { type: 'FeatureCollection', features } });

    const biomeColor = ['match', ['get', 'b']];
    for (const k in cfg.biomes) biomeColor.push(k, cfg.biomes[k].color);
    biomeColor.push('#cccccc');
    const owner = ['coalesce', ['feature-state', 'o'], -1];
    const owned = ['>=', owner, 0];

    // Nos calques passent sous les noms de pays et de villes du fond de carte
    const firstSymbol = (map.getStyle().layers.find((l) => l.type === 'symbol') || {}).id;

    map.addLayer({
      id: 'cells-fill', type: 'fill', source: 'cells',
      paint: { 'fill-color': biomeColor, 'fill-opacity': 0.62 },
    }, firstSymbol);
    map.addLayer({
      id: 'cells-owner', type: 'fill', source: 'cells',
      paint: { 'fill-color': '#000', 'fill-opacity': ['case', owned, 0.5, 0] },
    }, firstSymbol);
    map.addLayer({
      id: 'cells-line', type: 'line', source: 'cells',
      paint: { 'line-color': '#3b2f25', 'line-opacity': ['interpolate', ['linear'], ['zoom'], 1, 0.06, 4, 0.3], 'line-width': 0.5 },
    }, firstSymbol);
    map.addLayer({
      id: 'cells-border', type: 'line', source: 'cells',
      paint: { 'line-color': '#000', 'line-width': ['interpolate', ['linear'], ['zoom'], 1, ['case', owned, 0.6, 0], 5, ['case', owned, 2, 0]], 'line-opacity': 0.9 },
    }, firstSymbol);
    map.addLayer({
      id: 'cells-hl', type: 'line', source: 'cells',
      paint: {
        'line-color': ['match', ['coalesce', ['feature-state', 'h'], 0], 1, '#ffffff', 2, '#ffe14d', 3, '#ff5a3c', '#000'],
        'line-width': ['match', ['coalesce', ['feature-state', 'h'], 0], 1, 4, 2, 2.5, 3, 2.5, 0],
      },
    });

    map.addSource('moves', { type: 'geojson', data: empty() });
    map.addLayer({
      id: 'moves', type: 'line', source: 'moves',
      filter: ['==', ['geometry-type'], 'LineString'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': ['get', 'c'], 'line-width': 3, 'line-dasharray': [1, 1.5], 'line-opacity': 0.9 },
    });
    map.addLayer({
      id: 'moves-head', type: 'circle', source: 'moves',
      filter: ['==', ['geometry-type'], 'Point'],
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['get', 'n'], 1, 4, 100, 9, 1000, 14],
        'circle-color': ['get', 'c'], 'circle-stroke-color': '#fff', 'circle-stroke-width': 2,
      },
    });

    map.addSource('armies', { type: 'geojson', data: empty() });
    map.addLayer({
      id: 'armies', type: 'circle', source: 'armies',
      filter: ['>', ['get', 'n'], 0],
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'],
          1, ['interpolate', ['linear'], ['sqrt', ['get', 'n']], 1, 1.5, 30, 9],
          5, ['interpolate', ['linear'], ['sqrt', ['get', 'n']], 1, 4, 30, 22]],
        'circle-color': ['get', 'c'],
        'circle-opacity': 0.85,
        'circle-stroke-color': ['case', ['get', 'me'], '#ffffff', '#2b2118'],
        'circle-stroke-width': ['case', ['get', 'me'], 2, 1],
      },
    });

    map.addSource('nests', { type: 'geojson', data: empty() });
    map.addLayer({
      id: 'nests', type: 'circle', source: 'nests',
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 4, 5, 9],
        'circle-color': ['get', 'c'],
        'circle-stroke-color': '#2b2118',
        'circle-stroke-width': 3,
      },
    });

    if (glyphs) {
      map.addLayer({
        id: 'army-labels', type: 'symbol', source: 'armies', minzoom: 3.5,
        filter: ['>', ['get', 'n'], 0],
        layout: { 'text-field': ['to-string', ['get', 'n']], 'text-font': ['Noto Sans Bold'], 'text-size': 12, 'text-allow-overlap': false },
        paint: { 'text-color': '#1b140e', 'text-halo-color': '#fff', 'text-halo-width': 1.5 },
      });
    }

    map.addSource('preview', { type: 'geojson', data: empty() });
    map.addLayer({
      id: 'preview', type: 'line', source: 'preview',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': ['get', 'c'], 'line-width': 5, 'line-opacity': 0.95, 'line-dasharray': [0.6, 1.2] },
    });

    // ---------- Interactions ----------
    const cellAt = (point) => {
      const f = map.queryRenderedFeatures(point, { layers: ['cells-fill'] })[0];
      return f ? world.ids[f.id - 1] : null;
    };
    let drag = null;
    let swallowClick = false;

    map.on('click', (e) => {
      if (swallowClick) { swallowClick = false; return; }
      on.click(cellAt(e.point), e.point);
    });
    map.on('mousemove', (e) => {
      const id = cellAt(e.point);
      if (drag) {
        if (id && id !== drag.over) { drag.over = id; on.dragOver(drag.from, id, e.point); }
        return;
      }
      map.getCanvas().style.cursor = id ? (on.canDrag(id, false) ? 'grab' : 'pointer') : '';
      on.hover(id, e.point);
    });
    map.on('mouseout', () => on.hover(null));

    function startDrag(e, isTouch) {
      if (isTouch && e.points && e.points.length > 1) return; // pincement = zoom
      const id = cellAt(e.point);
      if (!id || !on.canDrag(id, isTouch)) return;
      e.preventDefault(); // empêche la carte de se déplacer
      drag = { from: id, over: id };
      map.getCanvas().style.cursor = 'grabbing';
    }
    function endDrag() {
      if (!drag) return;
      const d = drag;
      drag = null;
      map.getCanvas().style.cursor = '';
      if (d.over !== d.from) {
        swallowClick = true;
        setTimeout(() => { swallowClick = false; }, 300);
        on.dragEnd(d.from, d.over);
      } else {
        on.dragEnd(d.from, null);
      }
    }
    map.on('mousedown', 'cells-fill', (e) => startDrag(e, false));
    map.on('touchstart', 'cells-fill', (e) => startDrag(e, true));
    map.on('touchmove', (e) => {
      if (!drag) return;
      e.preventDefault();
      const id = cellAt(e.point);
      if (id && id !== drag.over) { drag.over = id; on.dragOver(drag.from, id, e.point); }
    });
    map.on('mouseup', endDrag);
    map.on('touchend', endDrag);
    map.on('touchcancel', () => { drag = null; on.dragEnd(null, null); });

    // ---------- API de rendu ----------
    let lastOwner = {};
    let lastHl = {};

    function center(id) {
      const c = world.cells[id];
      return [c.lng, c.lat];
    }
    /** Coordonnées d'un chemin, sans saut à l'antiméridien. */
    function line(path) {
      const pts = [];
      for (const id of path) {
        const p = center(id).slice();
        if (pts.length) {
          const prev = pts[pts.length - 1];
          while (p[0] - prev[0] > 180) p[0] -= 360;
          while (prev[0] - p[0] > 180) p[0] += 360;
        }
        pts.push(p);
      }
      return pts;
    }

    return {
      map,
      /** Couleurs des colonies (à appeler quand la liste des colonies change). */
      setColonyColors(colonies) {
        const expr = ['match', owner];
        colonies.forEach((c) => expr.push(c.id, c.color));
        expr.push('#000000');
        map.setPaintProperty('cells-owner', 'fill-color', expr);
        map.setPaintProperty('cells-border', 'line-color', expr);
      },
      /** Met à jour propriétaires, armées, nids et déplacements. */
      render(state, meId, tickFloat) {
        const now = {};
        const armies = [];
        for (const id in state.cells) {
          const c = state.cells[id];
          if (c.owner >= 0) {
            now[id] = c.owner;
            armies.push({
              type: 'Feature',
              properties: { n: (c.w || 0) + (c.s || 0) + (c.e || 0), c: state.colonies[c.owner].color, me: c.owner === meId },
              geometry: { type: 'Point', coordinates: center(id) },
            });
          }
        }
        for (const id in now) {
          if (lastOwner[id] !== now[id]) map.setFeatureState({ source: 'cells', id: index[id] }, { o: now[id] });
        }
        for (const id in lastOwner) {
          if (!(id in now)) map.setFeatureState({ source: 'cells', id: index[id] }, { o: -1 });
        }
        lastOwner = now;
        map.getSource('armies').setData({ type: 'FeatureCollection', features: armies });

        const nests = state.colonies.filter((c) => c.alive && c.queenAlive && c.nest).map((c) => ({
          type: 'Feature', properties: { c: c.color }, geometry: { type: 'Point', coordinates: center(c.nest) },
        }));
        map.getSource('nests').setData({ type: 'FeatureCollection', features: nests });

        this.renderMoves(state, tickFloat == null ? state.tick : tickFloat);
      },
      /** Trajets en cours : le chemin, et la tête de colonne à sa position actuelle. */
      renderMoves(state, tickFloat) {
        const mv = [];
        for (const m of state.moves) {
          const pts = line(m.path || [m.from, m.to]);
          const legs = m.legs || [0, m.arrive - m.depart];
          const t = Math.max(0, Math.min(legs[legs.length - 1], tickFloat - m.depart));
          let i = 1;
          while (i < legs.length - 1 && legs[i] < t) i++;
          const f = Math.max(0, Math.min(1, (t - legs[i - 1]) / Math.max(0.001, legs[i] - legs[i - 1])));
          const a = pts[i - 1], b = pts[i];
          const color = state.colonies[m.owner].color;
          mv.push({ type: 'Feature', properties: { c: color }, geometry: { type: 'LineString', coordinates: pts } });
          mv.push({ type: 'Feature', properties: { c: color, n: (m.w || 0) + (m.s || 0) + (m.e || 0) }, geometry: { type: 'Point', coordinates: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f] } });
        }
        map.getSource('moves').setData({ type: 'FeatureCollection', features: mv });
      },
      /** Chemin prévu pendant un glisser-déposer (null pour l'effacer). */
      showPath(path, color) {
        const data = path ? { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { c: color || '#ffffff' }, geometry: { type: 'LineString', coordinates: line(path) } }] } : empty();
        map.getSource('preview').setData(data);
      },
      /** Surligne la case sélectionnée (1), les cibles renfort (2) et attaque (3). */
      highlight(map3) {
        for (const id in lastHl) if (!(id in map3)) map.setFeatureState({ source: 'cells', id: index[id] }, { h: 0 });
        for (const id in map3) if (lastHl[id] !== map3[id]) map.setFeatureState({ source: 'cells', id: index[id] }, { h: map3[id] });
        lastHl = Object.assign({}, map3);
      },
      flyTo(id, zoom) {
        map.flyTo({ center: center(id), zoom: zoom || Math.max(map.getZoom(), 4), duration: 1200 });
      },
      /** Cadre la carte sur un ensemble de cases. */
      fitCells(ids) {
        if (!ids.length) return;
        if (ids.length === 1) return this.flyTo(ids[0], 4.5);
        const pts = line(ids);
        const b = new maplibregl.LngLatBounds(pts[0], pts[0]);
        for (const p of pts) b.extend(p);
        map.fitBounds(b, { padding: 80, maxZoom: 5.5, duration: 1200 });
      },
      /** Réinitialise l'affichage (nouvelle partie). */
      reset() {
        for (const id in lastOwner) map.setFeatureState({ source: 'cells', id: index[id] }, { o: -1 });
        lastOwner = {};
        this.highlight({});
        this.showPath(null);
      },
    };
  }

  function empty() { return { type: 'FeatureCollection', features: [] }; }

  (root.FZ = root.FZ || {}).MAP = { createMap };
})(window);
