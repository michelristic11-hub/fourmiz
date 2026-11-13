/**
 * Fourmiz — construction du monde : grille hexagonale H3 sur la terre ferme + biomes.
 *
 * Les terres viennent de Natural Earth (paquet world-atlas, domaine public).
 * La grille est calculée au chargement (≈ 1 s), donc aucune donnée lourde à héberger.
 */
(function (root) {
  'use strict';

  const LAND_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/land-110m.json';

  /** Rectangles [latMin, latMax, lngMin, lngMax] utilisés pour approximer les grands biomes. */
  const ZONES = {
    ice: [[59, 84, -74, -11]], // Groenland
    mountain: [
      [27, 39, 70, 102],    // Himalaya / Tibet
      [-42, 6, -79, -67.5], // Andes (bande ouest)
      [36, 60, -126, -106], // Rocheuses
      [43.5, 48, 5, 16],    // Alpes
      [37, 44, 40, 50],     // Caucase / Anatolie est
    ],
    desert: [
      [15, 32, -17, 35],    // Sahara
      [13, 32, 35, 60],     // Arabie
      [25, 37, 55, 72],     // Iran / Thar
      [37, 46, 90, 112],    // Gobi
      [-31, -19, 117, 143], // Australie intérieure
      [-29, -17, 12, 22],   // Kalahari / Namib
      [-28, -15, -72, -68], // Atacama
      [25, 37, -117, -104], // Sud-ouest des États-Unis / Mexique
      [38, 47, 52, 66],     // Karakoum / Kyzylkoum
    ],
    grass: [
      [30, 50, -105, -95],  // Grandes Plaines
      [-40, -28, -66, -56], // Pampa
      [44, 53, 30, 85],     // Steppe eurasienne
      [45, 49, 16, 28],     // Plaine de Pannonie
    ],
    savanna: [
      [-12, 12, 30, 52],    // Afrique de l'Est
      [-25, -10, -60, -40], // Cerrado
    ],
  };

  function inZone(name, lat, lng) {
    return ZONES[name].some((z) => lat >= z[0] && lat <= z[1] && lng >= z[2] && lng <= z[3]);
  }

  /** Biome approximatif d'un point (latitude, longitude). Déterministe. */
  function biomeFor(lat, lng) {
    const a = Math.abs(lat);
    if (inZone('ice', lat, lng)) return 'ice';
    if (inZone('mountain', lat, lng)) return 'mountain';
    if (a > 66) return 'tundra';
    if (a > 55) return 'taiga';
    if (inZone('desert', lat, lng)) return 'desert';
    if (inZone('grass', lat, lng)) return 'grass';
    if (inZone('savanna', lat, lng)) return 'savanna';
    if (a < 10) return 'jungle';
    if (a < 20) return 'savanna';
    if (a < 35) return 'grass';
    return 'forest';
  }

  // ---------- Point dans polygone ----------

  function ringContains(ring, x, y) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  function preparePolygons(geo) {
    const polys = [];
    const feats = geo.type === 'FeatureCollection' ? geo.features : [geo];
    for (const f of feats) {
      const g = f.geometry || f;
      const list = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
      for (const rings of list) {
        let minX = 180, maxX = -180, minY = 90, maxY = -90;
        for (const p of rings[0]) {
          if (p[0] < minX) minX = p[0];
          if (p[0] > maxX) maxX = p[0];
          if (p[1] < minY) minY = p[1];
          if (p[1] > maxY) maxY = p[1];
        }
        polys.push({ rings, minX, maxX, minY, maxY });
      }
    }
    return polys;
  }

  function onLand(polys, lng, lat) {
    for (const p of polys) {
      if (lng < p.minX || lng > p.maxX || lat < p.minY || lat > p.maxY) continue;
      if (!ringContains(p.rings[0], lng, lat)) continue;
      let hole = false;
      for (let k = 1; k < p.rings.length; k++) if (ringContains(p.rings[k], lng, lat)) { hole = true; break; }
      if (!hole) return true;
    }
    return false;
  }

  // ---------- Construction ----------

  /** Contour GeoJSON d'une case, corrigé pour les cases qui chevauchent l'antiméridien. */
  function boundary(h3, id) {
    const ring = h3.cellToBoundary(id, true);
    let min = 180, max = -180;
    for (const p of ring) { if (p[0] < min) min = p[0]; if (p[0] > max) max = p[0]; }
    if (max - min > 180) for (const p of ring) if (p[0] < 0) p[0] += 360;
    return ring;
  }

  function haversineKm(lat1, lng1, lat2, lng2) {
    const r = Math.PI / 180;
    const dLat = (lat2 - lat1) * r, dLng = (lng2 - lng1) * r;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLng / 2) ** 2;
    return 2 * 6371 * Math.asin(Math.sqrt(a));
  }

  /**
   * Construit le monde jouable.
   * @param {object} h3       bibliothèque h3-js v4
   * @param {object} landGeo  GeoJSON des terres
   * @param {object} cfg      FZ.CONFIG
   */
  function buildWorld(h3, landGeo, cfg) {
    const res = cfg.h3Resolution;
    const polys = preparePolygons(landGeo);
    const cells = {};
    const ids = [];
    for (const base of h3.getRes0Cells()) {
      for (const id of h3.cellToChildren(base, res)) {
        const [lat, lng] = h3.cellToLatLng(id);
        if (lat < cfg.minLatitude) continue;
        if (!onLand(polys, lng, lat)) continue;
        cells[id] = { id, lat, lng, biome: biomeFor(lat, lng) };
        ids.push(id);
      }
    }
    ids.sort();
    const spacingKm = h3.getHexagonEdgeLengthAvg(res, 'km') * Math.sqrt(3);
    const nbCache = {};
    return {
      ids,
      cells,
      neighbors(id) {
        let n = nbCache[id];
        if (!n) n = nbCache[id] = h3.gridDisk(id, 1).filter((x) => x !== id && cells[x]);
        return n;
      },
      distance(a, b) {
        const A = cells[a], B = cells[b];
        return haversineKm(A.lat, A.lng, B.lat, B.lng) / spacingKm;
      },
      boundary(id) { return boundary(h3, id); },
    };
  }

  /** Télécharge les terres (Natural Earth 1:110m) et les convertit en GeoJSON. */
  async function loadLand(topojson) {
    const resp = await fetch(LAND_URL);
    if (!resp.ok) throw new Error('Impossible de charger la carte des terres (' + resp.status + ')');
    const topo = await resp.json();
    return topojson.feature(topo, topo.objects.land);
  }

  const WORLD = { biomeFor, buildWorld, loadLand, preparePolygons, onLand, haversineKm };
  if (typeof module !== 'undefined' && module.exports) module.exports = WORLD;
  else (root.FZ = root.FZ || {}).WORLD = WORLD;
})(typeof window !== 'undefined' ? window : globalThis);
