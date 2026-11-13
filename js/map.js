/**
 * Fourmiz — rendu de la carte avec MapLibre GL JS et les tuiles gratuites OpenFreeMap.
 * Les cases H3 sont un seul calque GeoJSON ; la couleur de chaque case passe par
 * le « feature-state » (rapide : seules les cases modifiées sont mises à jour).
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
   * @param {object} on      { click(id|null), hover(id|null, point) }
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

    // Insère nos calques sous les étiquettes du fond de carte (noms de pays, villes)
    const firstSymbol = (map.getStyle().layers.find((l) => l.type === 'symbol') || {}).id;

    map.addLayer({
      id: 'cells-fill', type: 'fill', source: 'cells',
      paint: {
        'fill-color': biomeColor,
        'fill-opacity': ['case', ['>=', owner, 0], 0.8, 0.38],
      },
    }, firstSymbol);
    map.addLayer({
      id: 'cells-line', type: 'line', source: 'cells',
      paint: { 'line-color': '#3b2f25', 'line-opacity': ['interpolate', ['linear'], ['zoom'], 1, 0.05, 4, 0.25], 'line-width': 0.5 },
    }, firstSymbol);
    map.addLayer({
      id: 'cells-hl', type: 'line', source: 'cells',
      paint: {
        'line-color': ['match', ['coalesce', ['feature-state', 'h'], 0], 1, '#ffffff', 2, '#ffe14d', 3, '#ff5a3c', '#000'],
        'line-width': ['match', ['coalesce', ['feature-state', 'h'], 0], 1, 3.5, 2, 2.5, 3, 2.5, 0],
      },
    });

    map.addSource('moves', { type: 'geojson', data: empty() });
    map.addLayer({
      id: 'moves', type: 'line', source: 'moves',
      layout: { 'line-cap': 'round' },
      paint: { 'line-color': ['get', 'c'], 'line-width': 3, 'line-dasharray': [1, 1.5], 'line-opacity': 0.95 },
    });
    map.addLayer({
      id: 'moves-head', type: 'circle', source: 'moves',
      filter: ['==', ['geometry-type'], 'Point'],
      paint: { 'circle-radius': 4, 'circle-color': ['get', 'c'], 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5 },
    });

    map.addSource('nests', { type: 'geojson', data: empty() });
    map.addLayer({
      id: 'nests', type: 'circle', source: 'nests',
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 4, 5, 9],
        'circle-color': ['get', 'c'],
        'circle-stroke-color': '#2b2118',
        'circle-stroke-width': 2.5,
      },
    });

    map.addSource('labels', { type: 'geojson', data: empty() });
    if (glyphs) {
      map.addLayer({
        id: 'labels', type: 'symbol', source: 'labels', minzoom: 3,
        layout: { 'text-field': ['to-string', ['get', 'n']], 'text-font': ['Noto Sans Bold'], 'text-size': 12, 'text-allow-overlap': false },
        paint: { 'text-color': '#1b140e', 'text-halo-color': '#fff', 'text-halo-width': 1.5 },
      });
    }

    // Interactions
    map.on('click', (e) => {
      const f = map.queryRenderedFeatures(e.point, { layers: ['cells-fill'] })[0];
      on.click(f ? world.ids[f.id - 1] : null);
    });
    map.on('mousemove', (e) => {
      const f = map.queryRenderedFeatures(e.point, { layers: ['cells-fill'] })[0];
      map.getCanvas().style.cursor = f ? 'pointer' : '';
      on.hover(f ? world.ids[f.id - 1] : null, e.point);
    });
    map.on('mouseout', () => on.hover(null));

    // ---------- API de rendu ----------
    let lastOwner = {};
    let lastHl = {};

    function center(id) {
      const c = world.cells[id];
      return [c.lng, c.lat];
    }

    return {
      map,
      /** Couleurs des colonies (à appeler quand la liste des colonies change). */
      setColonyColors(colonies) {
        const expr = ['match', owner];
        colonies.forEach((c) => expr.push(c.id, c.color));
        expr.push(biomeColor);
        map.setPaintProperty('cells-fill', 'fill-color', ['case', ['>=', owner, 0], expr, biomeColor]);
      },
      /** Met à jour propriétaires, nids, étiquettes et déplacements. */
      render(state) {
        const now = {};
        const labels = [];
        for (const id in state.cells) {
          const c = state.cells[id];
          if (c.owner >= 0) {
            now[id] = c.owner;
            labels.push({ type: 'Feature', properties: { n: c.ants }, geometry: { type: 'Point', coordinates: center(id) } });
          }
        }
        for (const id in now) {
          if (lastOwner[id] !== now[id]) map.setFeatureState({ source: 'cells', id: index[id] }, { o: now[id] });
        }
        for (const id in lastOwner) {
          if (!(id in now)) map.setFeatureState({ source: 'cells', id: index[id] }, { o: -1 });
        }
        lastOwner = now;
        map.getSource('labels').setData({ type: 'FeatureCollection', features: labels });

        const nests = state.colonies.filter((c) => c.alive && c.queenAlive && c.nest).map((c) => ({
          type: 'Feature', properties: { c: c.color }, geometry: { type: 'Point', coordinates: center(c.nest) },
        }));
        map.getSource('nests').setData({ type: 'FeatureCollection', features: nests });

        this.renderMoves(state, state.tick);
      },
      /** Trajets en cours, avec la position animée de chaque colonne de fourmiz. */
      renderMoves(state, tickFloat) {
        const mv = [];
        for (const m of state.moves) {
          const a = center(m.from), b = center(m.to);
          if (Math.abs(a[0] - b[0]) > 180) b[0] += a[0] > b[0] ? 360 : -360;
          const t = Math.min(1, (tickFloat - m.depart) / Math.max(1, m.arrive - m.depart));
          const p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
          const color = state.colonies[m.owner].color;
          mv.push({ type: 'Feature', properties: { c: color }, geometry: { type: 'LineString', coordinates: [a, b] } });
          mv.push({ type: 'Feature', properties: { c: color }, geometry: { type: 'Point', coordinates: p } });
        }
        map.getSource('moves').setData({ type: 'FeatureCollection', features: mv });
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
      /** Réinitialise l'affichage (nouvelle partie). */
      reset() {
        for (const id in lastOwner) map.setFeatureState({ source: 'cells', id: index[id] }, { o: -1 });
        lastOwner = {};
        this.highlight({});
      },
    };
  }

  function empty() { return { type: 'FeatureCollection', features: [] }; }

  (root.FZ = root.FZ || {}).MAP = { createMap };
})(window);
