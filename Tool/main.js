import JSZip from "jszip";

/**
 * Berlin U-Bahn
 * - Track: Way-Geometrie (role "") aus der Route-Relation, lückenlos zusammengesetzt
 * - Stationen: Stop-Nodes auf den Track projiziert (kein Offset mehr)
 * - Bahnsteige: Länge und Breite aus den platform-Ways der Overpass-Daten
 */

const LINES = ["U1", "U2", "U3", "U4", "U5", "U6", "U7", "U8", "U9"];
const TRANSIT_ROUTE_MODES = {
  subway: { label: "U-Bahn", category: "rail_subway" },
  tram: { label: "Tram", category: "rail_tram" },
  train: { label: "Bahn", category: "rail_train" },
  light_rail: { label: "Light Rail", category: "rail_train" },
  bus: { label: "Bus", category: "bus" },
};

// ─── Karte ───────────────────────────────────────────────────────────────────

const map = L.map("map", { zoomControl: true, minZoom: 10, maxZoom: 18 })
  .setView([52.52, 13.405], 12);

L.tileLayer("https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}.png", {
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · ' +
    '<a href="https://carto.com/attributions">CARTO</a>',
  subdomains: "abcd",
  maxZoom: 20,
}).addTo(map);

L.tileLayer("https://tile.memomaps.de/tilegen/{z}/{x}/{y}.png", {
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · ' +
    '<a href="https://öpnvkarte.de/">ÖPNVKarte</a>',
  maxZoom: 18,
  opacity: 0.35,
}).addTo(map);

L.control.scale({ metric: true, imperial: false }).addTo(map);

const routeLayer = L.layerGroup().addTo(map);
const editLayer = L.layerGroup().addTo(map);
const splineLayer = L.layerGroup().addTo(map);
const areaSelectionLayer = L.layerGroup().addTo(map);
const areaRawLayer = L.layerGroup().addTo(map);
const areaProcessedLayer = L.layerGroup().addTo(map);
let uploadedJsonData = null;

const DEFAULT_HALF_LENGTH_M = 65; // 130m Fallback wenn kein platform-Way vorhanden
const DEFAULT_HALF_WIDTH_M = 2.7; // 5.4m Fallback
const TRACK_BLEND_M = 30; // Hermite-Blend-Distanz am Bahnsteig-Ein-/Austritt
const STATION_LEVEL_HEIGHT_M = 4; // Gameplay-Hoehe pro OSM-Ebene

// masterStations: einzige Quelle der Wahrheit für Stationsdaten
// { name, lat, lon, halfLengthM, halfWidthM, _osmLat?, _osmLon?, _osmHalfLengthM?, _osmHalfWidthM? }
let masterStations = null;
let lastRelation = null; // aktuelle OSM-Relation (für Richtungsanzeige)
let currentRouteMode = "subway";
let editModeActive = false;
let splineEditMode = false;
let customControlPoints = null; // [lat, lon][] – überschreibt Overpass-Mittellinie
let lastComputedCenterline = null; // letzte Overpass-Mittellinie (für Initialisierung)
let lastLoadData = null;
let selectedStation = null;
let currentEditsFile = null;
let currentSourceFile = null;
let currentSourceKind = null; // "overpass" | "master"

const SPLINE_SPACING_M = 50; // Abstand der initialen Spline-Kontrollpunkte
const OVERPASS_API_URL = "https://overpass-api.de/api/interpreter";
const NOMINATIM_API_URL = "https://nominatim.openstreetmap.org/search";
const OVERPASS_CACHE_KEY = "ubahn.overpass.dataset.v1";
const POSTAL_CODE_CACHE_KEY_PREFIX = "uemap.postal-code.";
const MASTER_CACHE_KEY_PREFIX = "ubahn.master.v4.";
const DEFAULT_AREA_BP_PATHS = {
  tunnel: "/Game/_UbahnWorkerGames/TEST/BP_CityTest.BP_CityTest",
  subway: "/Game/_UbahnWorkerGames/TEST/BP_CityTest.BP_CityTest",
  tram: "/Game/_UbahnWorkerGames/TEST/BP_CityTest.BP_CityTest",
  train: "/Game/_UbahnWorkerGames/TEST/BP_CityTest.BP_CityTest",
  bus: "/Game/_UbahnWorkerGames/TEST/BP_CityTest.BP_CityTest",
  street: "/Game/_UbahnWorkerGames/TEST/BP_CityTest.BP_CityTest",
  building: "/Game/_UbahnWorkerGames/TEST/BP_BuildingCube.BP_BuildingCube",
  tree: "/Game/_UbahnWorkerGames/TEST/BP_BuildingCube.BP_BuildingCube",
};
const AREA_BP_STORAGE_KEY_PREFIX = "ubahn.areaBpPath.";
let persistCacheTimer = null;

const LINE_STYLE = {
  color: "#64748b",
  weight: 4,
  opacity: 0.9,
  lineCap: "round",
  lineJoin: "round",
};

const PLATFORM_STYLE = {
  color: "#ec4899",
  weight: 1.5,
  opacity: 0.9,
  fillColor: "#f472b6",
  fillOpacity: 0.58,
  lineCap: "round",
  lineJoin: "round",
};

const AREA_STYLE = {
  motorway: { color: "#dc2626", weight: 4 },
  major_road: { color: "#f59e0b", weight: 3.5 },
  city_road: { color: "#475569", weight: 2.5 },
  service: { color: "#94a3b8", weight: 2 },
  rail_tram: { color: "#16a34a", weight: 3 },
  rail_train: { color: "#7c3aed", weight: 3 },
  rail_subway: { color: "#2563eb", weight: 3 },
  bus: { color: "#0891b2", weight: 2.5 },
  building: { color: "#64748b", weight: 1.2 },
  tree: { color: "#15803d", weight: 2 },
};

const AREA_SIMPLIFY_TOLERANCE_M = 3;
const AREA_SEGMENT_SPACING_M = 10;
const AREA_DEDUPE_DECIMALS = 5;
const AREA_DRAW_RAW_GEOMETRY = false;
const AREA_CENTERLINE_MAX_DISTANCE_M = 18;
const AREA_CENTERLINE_LENGTH_RATIO = 0.72;
const AREA_LARGE_REQUEST_KM2 = 25;
const AREA_MAX_REQUEST_KM2 = 100;
const AREA_EXPENSIVE_LAYERS = new Set(["city_road", "service", "building", "tree"]);
const DEFAULT_BUILDING_HEIGHT_CM = 300;
const DEFAULT_TREE_HEIGHT_CM = 600;
const DEFAULT_TREE_CROWN_DIAMETER_CM = 450;

const AREA_LAYER_LABELS = {
  motorway: "Autobahn",
  major_road: "Hauptstrasse",
  city_road: "Stadtstrasse",
  service: "Service",
  rail_tram: "Tram",
  rail_train: "Zug",
  rail_subway: "U-Bahn",
  bus: "Bus",
  building: "Gebaeude",
  tree: "Baeume",
};

const areaLayerVisibility = new Map(
  Object.keys(AREA_LAYER_LABELS).map((key) => [key, key === "rail_subway"]),
);

let areaSelectionBounds = null;
let areaSelectionRect = null;
let areaSelectionMoveMarker = null;
let areaSelectionResizeMarkers = [];
let areaSelectionDragState = null;
let areaSelectMode = false;
let areaDragStart = null;
let areaDraftRect = null;
let areaFeatures = [];
let areaCache = null;
let datatableAreaLines = [];
let detectedAreaTransitLines = [];

function getSelectedAreaCategories() {
  return [...areaLayerVisibility.entries()]
    .filter(([, visible]) => visible)
    .map(([category]) => category);
}

function areaBoundsCacheKey(bounds, categories = getSelectedAreaCategories()) {
  if (!bounds?.isValid?.()) return "";
  return [
    bounds.getSouth().toFixed(6),
    bounds.getWest().toFixed(6),
    bounds.getNorth().toFixed(6),
    bounds.getEast().toFixed(6),
    [...categories].sort().join("|"),
  ].join(",");
}

function areaBoundsSizeKm2(bounds) {
  if (!bounds?.isValid?.()) return 0;
  const southWest = [bounds.getSouth(), bounds.getWest()];
  const southEast = [bounds.getSouth(), bounds.getEast()];
  const northWest = [bounds.getNorth(), bounds.getWest()];
  return (haversineM(southWest, southEast) * haversineM(southWest, northWest)) / 1_000_000;
}

// ─── Geo-Mathematik ──────────────────────────────────────────────────────────

function haversineM(a, b) {
  const R = 6371000;
  const toRad = (v) => (v * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLon = toRad(b[1] - a[1]);
  const lat1 = toRad(a[0]);
  const lat2 = toRad(b[0]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Meter-pro-Grad am gegebenen Breitengrad */
function mpd(lat) {
  return { lat: 111320, lon: 111320 * Math.cos((lat * Math.PI) / 180) };
}

/**
 * Tangente eines Segments [a, b] als metrischer Einheitsvektor {dx, dy, refLat}.
 * dx = Ost-Anteil, dy = Nord-Anteil, beide normiert.
 */
function segmentTangent(a, b) {
  const refLat = (a[0] + b[0]) / 2;
  const m = mpd(refLat);
  const dy = (b[0] - a[0]) * m.lat;
  const dx = (b[1] - a[1]) * m.lon;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return null;
  return { dx: dx / len, dy: dy / len, refLat };
}

/** Verschiebt einen Punkt um distM Meter entlang des Tangentenvektors. */
function moveMeter(point, tangent, distM) {
  const m = mpd(point[0]);
  return [
    point[0] + (tangent.dy * distM) / m.lat,
    point[1] + (tangent.dx * distM) / m.lon,
  ];
}

/** Kumulierte Länge (m) entlang einer Polylinie. */
function pointKey(point) {
  return `${point[0].toFixed(7)},${point[1].toFixed(7)}`;
}

function cumLengths(poly) {
  const c = [0];
  for (let i = 1; i < poly.length; i++)
    c.push(c[i - 1] + haversineM(poly[i - 1], poly[i]));
  return c;
}

/** Gleichmäßig auf N Punkte entlang der Bogenlänge resamplen. */
function resamplePolyline(poly, n) {
  const cum = cumLengths(poly);
  const total = cum[cum.length - 1];
  const result = [];
  for (let i = 0; i < n; i++) {
    result.push(pointAtDist(poly, cum, (i / (n - 1)) * total));
  }
  return result;
}

/**
 * Entfernt Knicke (dot-product < 0 = Richtungsumkehr > 90°).
 * Iteriert, bis keine Knicke mehr übrig sind.
 */
function removeKinks(track) {
  if (track.length < 3) return track;
  let result = track;
  let changed = true;
  while (changed) {
    changed = false;
    const out = [result[0]];
    for (let i = 1; i < result.length - 1; i++) {
      const a = result[i - 1];
      const b = result[i];
      const c = result[i + 1];
      const dx1 = b[1] - a[1];
      const dy1 = b[0] - a[0];
      const dx2 = c[1] - b[1];
      const dy2 = c[0] - b[0];
      if (dx1 * dx2 + dy1 * dy2 < 0) {
        changed = true;
      } else {
        out.push(b);
      }
    }
    out.push(result[result.length - 1]);
    result = out;
  }
  return result;
}

/**
 * Mittellinie zwischen zwei Gleisen.
 * Dreht trackB bei Bedarf um, damit beide in dieselbe Richtung laufen.
 */
function computeCenterline(trackA, trackB) {
  const sameDir =
    haversineM(trackA[0], trackB[0]) +
    haversineM(trackA[trackA.length - 1], trackB[trackB.length - 1]);
  const oppDir =
    haversineM(trackA[0], trackB[trackB.length - 1]) +
    haversineM(trackA[trackA.length - 1], trackB[0]);
  const b = oppDir < sameDir ? [...trackB].reverse() : trackB;
  // 1 Punkt pro 5m → ~3600 Punkte für 18km, genug für enge Kurven
  const cumA = cumLengths(trackA);
  const n = Math.max(Math.ceil(cumA[cumA.length - 1] / 5), 500);
  const ra = resamplePolyline(trackA, n);
  const rb = resamplePolyline(b, n);
  return ra.map((a, i) => [(a[0] + rb[i][0]) / 2, (a[1] + rb[i][1]) / 2]);
}

// ─── Catmull-Rom Spline ───────────────────────────────────────────────────────

function catmullRomPoint(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  const c0 = 0.5 * (-t3 + 2 * t2 - t);
  const c1 = 0.5 * (3 * t3 - 5 * t2 + 2);
  const c2 = 0.5 * (-3 * t3 + 4 * t2 + t);
  const c3 = 0.5 * (t3 - t2);
  return [
    c0 * p0[0] + c1 * p1[0] + c2 * p2[0] + c3 * p3[0],
    c0 * p0[1] + c1 * p1[1] + c2 * p2[1] + c3 * p3[1],
  ];
}

/** Interpoliert sparse Kontrollpunkte zu einer dichten Polylinie. */
function catmullRomSpline(pts, steps = 8) {
  if (pts.length < 2) return [...pts];
  const result = [pts[0]];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let j = 1; j <= steps; j++) result.push(catmullRomPoint(p0, p1, p2, p3, j / steps));
  }
  return result;
}

/** Reduziert einen dichten Track auf gleichmäßig verteilte Kontrollpunkte. */
function subsampleToControlPoints(track, spacingM = SPLINE_SPACING_M) {
  if (!track || track.length < 2) return track ? [...track] : [];
  const cum = cumLengths(track);
  const total = cum[cum.length - 1];
  const n = Math.max(2, Math.round(total / spacingM));
  const pts = [];
  for (let i = 0; i <= n; i++) pts.push(pointAtDist(track, cum, (i / n) * total));
  return pts;
}

/**
 * Kubischer Hermite-Segment zwischen zwei Punkten mit Tangentenvektoren.
 * Gibt `steps` Zwischenpunkte zurück (inkl. Endpunkt).
 * p0/p1 = [lat, lon]; t0/t1 = unit tangent { dx (Ost), dy (Nord) }; dist = Abstand in Metern.
 */
function hermiteSegment(p0, t0, p1, t1, dist, steps = Math.max(5, Math.ceil(dist / 3))) {
  if (!t0 || !t1 || dist < 0.1) return p1 ? [p1] : [];
  const m = mpd((p0[0] + p1[0]) / 2);
  const pts = [];
  for (let i = 1; i <= steps; i++) {
    const s = i / steps;
    const h00 = 2 * s ** 3 - 3 * s ** 2 + 1;
    const h10 = (s ** 3 - 2 * s ** 2 + s) * dist;
    const h01 = -2 * s ** 3 + 3 * s ** 2;
    const h11 = (s ** 3 - s ** 2) * dist;
    pts.push([
      h00 * p0[0] + h10 * (t0.dy / m.lat) + h01 * p1[0] + h11 * (t1.dy / m.lat),
      h00 * p0[1] + h10 * (t0.dx / m.lon) + h01 * p1[1] + h11 * (t1.dx / m.lon),
    ]);
  }
  return pts;
}

/** Tangente der Polylinie an der Position distM Meter vom Start. */
function tangentAtDist(poly, cum, distM) {
  distM = Math.max(0, Math.min(cum[cum.length - 1], distM));
  let i = 0;
  while (i < cum.length - 2 && cum[i + 1] <= distM) i++;
  return segmentTangent(poly[i], poly[Math.min(i + 1, poly.length - 1)]);
}

/** Punkt auf der Polylinie bei genau distM Metern vom Start. */
function pointAtDist(poly, cum, distM) {
  distM = Math.max(0, Math.min(cum[cum.length - 1], distM));
  let i = 0;
  while (i < cum.length - 2 && cum[i + 1] < distM) i++;
  const span = cum[i + 1] - cum[i];
  const t = span < 1e-9 ? 0 : (distM - cum[i]) / span;
  return [
    poly[i][0] + t * (poly[i + 1][0] - poly[i][0]),
    poly[i][1] + t * (poly[i + 1][1] - poly[i][1]),
  ];
}

/**
 * Projiziert Punkt p auf Segment [a, b].
 * Gibt den Lotfußpunkt (in lat/lon) und den Parameter t ∈ [0,1] zurück.
 */
function projectOnSegment(p, a, b) {
  const lat0 = (a[0] + b[0]) / 2;
  const cosLat = Math.cos((lat0 * Math.PI) / 180);
  const ax = a[1] * cosLat, ay = a[0];
  const bx = b[1] * cosLat, by = b[0];
  const px = p[1] * cosLat, py = p[0];
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t =
    len2 < 1e-18 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return {
    proj: [ay + t * (by - ay), (ax + t * (bx - ax)) / cosLat],
    t,
  };
}

function elementPoint(el, idx, seen = new Set()) {
  if (!el) return null;
  const key = `${el.type}/${el.id}`;
  if (seen.has(key)) return null;
  seen.add(key);

  if (el.lat != null && el.lon != null) return [el.lat, el.lon];
  if (el.center?.lat != null && el.center?.lon != null) return [el.center.lat, el.center.lon];

  if (Array.isArray(el.geometry) && el.geometry.length) {
    let lat = 0;
    let lon = 0;
    let count = 0;
    for (const [pointLat, pointLon] of normalizeOverpassGeometry(el.geometry)) {
      lat += pointLat;
      lon += pointLon;
      count += 1;
    }
    if (count) return [lat / count, lon / count];
  }

  if (el.bounds) {
    return [
      (el.bounds.minlat + el.bounds.maxlat) / 2,
      (el.bounds.minlon + el.bounds.maxlon) / 2,
    ];
  }

  if (el.type === "relation" && Array.isArray(el.members)) {
    const pts = [];
    for (const m of el.members) {
      const child = idx.get(`${m.type}/${m.ref}`);
      const p = elementPoint(child, idx, seen);
      if (p) pts.push(p);
    }
    if (pts.length) {
      let lat = 0;
      let lon = 0;
      for (const p of pts) {
        lat += p[0];
        lon += p[1];
      }
      return [lat / pts.length, lon / pts.length];
    }
  }

  return null;
}

// ─── Track-Aufbau aus Way-Geometrie ──────────────────────────────────────────

/** Gibt die Way-Segmente des Gleises zurück (nur role === ""). */
function extractTrackSegments(relation, elements = []) {
  const elementByWayId = new Map(
    (elements || [])
      .filter((el) => el?.type === "way" && Array.isArray(el.geometry))
      .map((el) => [el.id, el]),
  );

  return (relation.members || [])
    .filter((m) => m.type === "way" && !isPlatformRole(m.role))
    .map((m) => {
      // Fall A: geometry direkt im Member (ältere/andere Overpass-Ausgaben)
      if (Array.isArray(m.geometry) && m.geometry.length >= 2) {
        const geometry = normalizeOverpassGeometry(m.geometry);
        return geometry.length >= 2 ? geometry : null;
      }
      // Fall B: geometry liegt im globalen way-Element (out body; >; out geom;)
      const way = elementByWayId.get(m.ref);
      if (way && Array.isArray(way.geometry) && way.geometry.length >= 2) {
        const geometry = normalizeOverpassGeometry(way.geometry);
        return geometry.length >= 2 ? geometry : null;
      }
      return null;
    })
    .filter(Boolean);
}

/**
 * Setzt Ways zur Polylinie zusammen.
 * Die Ways in OSM-Relationen sind bereits in Reihenfolge, aber einzelne Ways
 * können in der falschen Richtung vorliegen → pro Way ggf. umkehren.
 */
function stitchTrackSegments(segments) {
  if (!segments.length) return [];

  // Ausrichtung des ersten Segments anhand des zweiten bestimmen
  let first = segments[0];
  if (segments.length > 1) {
    const second = segments[1];
    const dEndStart = haversineM(first[first.length - 1], second[0]);
    const dEndEnd = haversineM(first[first.length - 1], second[second.length - 1]);
    const dStartStart = haversineM(first[0], second[0]);
    const dStartEnd = haversineM(first[0], second[second.length - 1]);
    if (Math.min(dStartStart, dStartEnd) < Math.min(dEndStart, dEndEnd)) {
      first = [...first].reverse();
    }
  }

  const result = [...first];
  for (let i = 1; i < segments.length; i++) {
    let seg = segments[i];
    const last = result[result.length - 1];
    if (haversineM(last, seg[seg.length - 1]) < haversineM(last, seg[0])) {
      seg = [...seg].reverse();
    }
    const skip = haversineM(last, seg[0]) < 5 ? 1 : 0;
    for (let k = skip; k < seg.length; k++) result.push(seg[k]);
  }
  return result;
}

// ─── Stationsextraktion ───────────────────────────────────────────────────────

function buildIndex(elements) {
  const idx = new Map();
  for (const el of elements || []) idx.set(`${el.type}/${el.id}`, el);
  return idx;
}

function getStationName(el) {
  return (el?.tags?.name || el?.tags?.["name:de"] || "").trim();
}

function parseOsmLevelValue(value) {
  if (value == null) return null;
  const text = String(value).trim().replace(",", ".");
  if (!text) return null;
  const match = text.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function stationHeightFromTags(...tagSources) {
  for (const tags of tagSources) {
    const level = parseOsmLevelValue(tags?.level);
    if (level != null) {
      return {
        level,
        heightM: level * STATION_LEVEL_HEIGHT_M,
        source: "osm_level",
      };
    }
  }
  for (const tags of tagSources) {
    const layer = parseOsmLevelValue(tags?.layer);
    if (layer != null) {
      return {
        level: layer,
        heightM: layer * STATION_LEVEL_HEIGHT_M,
        source: "osm_layer",
      };
    }
  }
  return { level: null, heightM: 0, source: "" };
}

function isStopRole(role) {
  const r = (role || "").toLowerCase();
  return r === "stop" || r === "stop_entry_only" || r === "stop_exit_only";
}

function isPlatformRole(role) {
  const r = (role || "").toLowerCase();
  return r.includes("platform");
}

function isStopMemberForRoute(member, routeMode = "subway") {
  if (isStopRole(member.role)) return true;
  return routeMode === "bus" && isPlatformRole(member.role);
}

/**
 * Gibt Stop-Nodes in Reihenfolge der Relation zurück, dedupliziert nach Name.
 * Nur Nodes mit stop-Role werden berücksichtigt (keine platform-Nodes).
 */
function extractStopNodes(relation, elements, routeMode = "subway") {
  const idx = buildIndex(elements);
  const seen = new Set();
  const stops = [];
  for (const member of relation.members || []) {
    if (!isStopMemberForRoute(member, routeMode)) continue;
    const el = idx.get(`${member.type}/${member.ref}`);
    const point = elementPoint(el, idx);
    if (!el || !point) continue;
    const name = getStationName(el) || getStationName(member);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    stops.push({ id: el.id, name, lat: point[0], lon: point[1], tags: el.tags || member.tags || {} });
  }
  return stops;
}

/** Entfernt "S+U", "S " und "U " Präfixe für Namens-Matching. */
function normalizeName(name) {
  return (name || "").replace(/^(S\+U|S|U)\s+/i, "").trim().toLowerCase();
}

/**
 * Baut einen Index aller platform-Ways aus den Relationen UND global aus allen Elementen.
 * Normaliserter Namekey → { id, name, geometry }.
 * Deckt Endhaltestellen ab, die nur global vorhanden sind.
 */
function buildPlatformIndex(relations, elements) {
  const idx = buildIndex(elements);
  const byNorm = new Map();

  function addEntry(id, tagsSource, geometryRaw) {
    const name = getStationName(tagsSource);
    if (!name) return;
    const norm = normalizeName(name);
    const geometry = normalizeOverpassGeometry(geometryRaw);
    if (!byNorm.has(norm) && geometry.length >= 2) {
      byNorm.set(norm, {
        id,
        name,
        tags: tagsSource?.tags || {},
        geometry,
      });
    }
  }

  // Relation-Members (platform-Ways)
  for (const relation of relations) {
    for (const member of relation.members || []) {
      if (member.type !== "way" || !isPlatformRole(member.role)) continue;
      const el = idx.get(`way/${member.ref}`);
      addEntry(member.ref, member.tags ? member : el, member.geometry || el?.geometry);
    }
  }

  // Globaler Scan: platform-Ways die nicht in Relationen referenziert sind (Endhaltestellen)
  for (const el of elements) {
    if (el.type !== "way") continue;
    if (el.tags?.public_transport !== "platform" && el.tags?.railway !== "platform") continue;
    addEntry(el.id, el, el.geometry);
  }

  return {
    get: (name) => byNorm.get(normalizeName(name)),
  };
}

function offsetByBasis(point, tangent, normal, alongM, acrossM) {
  const m = mpd(point[0]);
  return [
    point[0] + (tangent.dy * alongM + normal.dy * acrossM) / m.lat,
    point[1] + (tangent.dx * alongM + normal.dx * acrossM) / m.lon,
  ];
}

function buildPlatformPolygon(centerPoint, tangent, startAlongM, endAlongM, halfWidthM) {
  const normal = { dx: -tangent.dy, dy: tangent.dx };
  return [
    offsetByBasis(centerPoint, tangent, normal, startAlongM, -halfWidthM),
    offsetByBasis(centerPoint, tangent, normal, endAlongM, -halfWidthM),
    offsetByBasis(centerPoint, tangent, normal, endAlongM, halfWidthM),
    offsetByBasis(centerPoint, tangent, normal, startAlongM, halfWidthM),
  ];
}

function measurePlatformDimensions(platformWay, centerPoint, tangent) {
  if (!platformWay || !Array.isArray(platformWay.geometry) || platformWay.geometry.length < 2) {
    return null;
  }
  if (!tangent) return null;

  const normal = { dx: -tangent.dy, dy: tangent.dx };
  const m = mpd(centerPoint[0]);
  let minAlong = Infinity;
  let maxAlong = -Infinity;
  let minAcross = Infinity;
  let maxAcross = -Infinity;

  for (const [lat, lon] of platformWay.geometry) {
    const dx = (lon - centerPoint[1]) * m.lon;
    const dy = (lat - centerPoint[0]) * m.lat;
    const along = dx * tangent.dx + dy * tangent.dy;
    const across = dx * normal.dx + dy * normal.dy;
    if (along < minAlong) minAlong = along;
    if (along > maxAlong) maxAlong = along;
    if (across < minAcross) minAcross = across;
    if (across > maxAcross) maxAcross = across;
  }

  const halfLengthM = Math.max(Math.abs(minAlong), Math.abs(maxAlong));
  const halfWidthM = Math.max(Math.abs(minAcross), Math.abs(maxAcross));
  if (!(halfLengthM > 0) || !(halfWidthM > 0)) return null;

  return { halfLengthM, halfWidthM };
}

// ─── Projektion + Bahnsteigberechnung ────────────────────────────────────────

/** Projiziert einen Stop-Node auf den Track. Gibt Lotfußpunkt, Abstand und Tangente zurück. */
function projectOntoTrack(latLon, track) {
  let bestDist = Infinity;
  let bestPoint = null;
  let bestCumDist = 0;
  let bestSegIdx = 0;
  let cumDist = 0;

  for (let i = 0; i < track.length - 1; i++) {
    const segLen = haversineM(track[i], track[i + 1]);
    const { proj, t } = projectOnSegment(latLon, track[i], track[i + 1]);
    const dist = haversineM(latLon, proj);
    if (dist < bestDist) {
      bestDist = dist;
      bestPoint = proj;
      bestCumDist = cumDist + t * segLen;
      bestSegIdx = i;
    }
    cumDist += segLen;
  }

  return {
    point: bestPoint,
    distAlongTrack: bestCumDist,
    tangent: segmentTangent(track[bestSegIdx], track[bestSegIdx + 1]),
  };
}

/**
 * Schneidet den Track-Abschnitt [fromDist, toDist] heraus.
 * Gibt Anfangs- und Endpunkt interpoliert zurück, dazwischen alle echten Track-Punkte.
 */
function extractSection(track, cum, fromDist, toDist) {
  const pts = [pointAtDist(track, cum, fromDist)];
  for (let i = 0; i < track.length; i++) {
    if (cum[i] > fromDist && cum[i] < toDist) pts.push(track[i]);
  }
  pts.push(pointAtDist(track, cum, toDist));
  return pts;
}

/**
 * Baut den finalen Track:
 * - Geschwungene Abschnitte zwischen den Stationen (originale Way-Punkte)
 * - An jeder Station: gerade Bahnsteigfläche aus der OSM-Plattform-Geometrie
 */
function buildFinalTrack(rawTrack, stationProjections) {
  const cum = cumLengths(rawTrack);
  const totalLen = cum[cum.length - 1];

  const sorted = stationProjections
    .filter((s) => s.tangent !== null)
    .sort((a, b) => a.distAlongTrack - b.distAlongTrack);

  const result = [];
  const platformSegments = [];
  let cursor = 0;

  const append = (pts) => {
    for (const p of pts) {
      if (!result.length || haversineM(result[result.length - 1], p) > 0.1) {
        result.push(p);
      }
    }
  };

  for (const station of sorted) {
    const { halfLengthM, halfWidthM, distAlongTrack, point, tangent } = station;
    if (!tangent) continue;

    const segStart = Math.max(cursor, distAlongTrack - halfLengthM);
    const segEnd = Math.min(totalLen, distAlongTrack + halfLengthM);
    // Blend-Zonen: TRACK_BLEND_M vor und nach dem geraden Bahnsteig-Abschnitt
    const blendEntry = Math.max(cursor, segStart - TRACK_BLEND_M);
    const blendExit = Math.min(totalLen, segEnd + TRACK_BLEND_M);

    // 1. Geschwungener Track bis zum Beginn der Einfahrt-Blend-Zone
    if (blendEntry > cursor) {
      append(extractSection(rawTrack, cum, cursor, blendEntry));
    }

    // Bahnsteig-Endpunkte (entlang der lokalen Tangente)
    const beforePt = moveMeter(point, tangent, segStart - distAlongTrack);
    const afterPt = moveMeter(point, tangent, segEnd - distAlongTrack);

    // 2. Hermite-Einfahrt: natürliche Gleistangente → Bahnsteig-Tangente
    const entryP0 = pointAtDist(rawTrack, cum, blendEntry);
    const entryT0 = tangentAtDist(rawTrack, cum, blendEntry);
    const entryDist = haversineM(entryP0, beforePt);
    append(hermiteSegment(entryP0, entryT0, beforePt, tangent, entryDist));

    // 3. Gerader Bahnsteig-Abschnitt
    append([point, afterPt]);

    // 4. Hermite-Ausfahrt: Bahnsteig-Tangente → natürliche Gleistangente
    const exitP1 = pointAtDist(rawTrack, cum, blendExit);
    const exitT1 = tangentAtDist(rawTrack, cum, blendExit);
    const exitDist = haversineM(afterPt, exitP1);
    append(hermiteSegment(afterPt, tangent, exitP1, exitT1, exitDist));

    // Bahnsteig-Polygon
    platformSegments.push(
      buildPlatformPolygon(point, tangent, segStart - distAlongTrack, segEnd - distAlongTrack, halfWidthM),
    );

    cursor = blendExit;
  }

  // Restlicher Track nach der letzten Station
  if (cursor < totalLen) {
    append(extractSection(rawTrack, cum, cursor, totalLen));
  }

  return { route: result, platforms: platformSegments };
}

// ─── Datenladen ───────────────────────────────────────────────────────────────

function getRouteRelationsForRef(data, ref, routeMode = "subway") {
  return (data.elements || []).filter(
    (el) =>
      el.type === "relation" &&
      el.tags?.route === routeMode &&
      el.tags?.ref === ref,
  );
}

/**
 * Für jede Station beide Stop-Koordinaten (eine pro Richtungsrelation) mitteln.
 * Relation A gibt die Reihenfolge vor; B liefert nur den Gegengleispunkt.
 */
function mergeStopsFromBothRelations(relA, relB, elements, routeMode = "subway") {
  const stopsA = extractStopNodes(relA, elements, routeMode);
  const stopsB = extractStopNodes(relB, elements, routeMode);
  const bByName = new Map(stopsB.map((s) => [s.name, s]));
  return stopsA.map((s) => {
    const b = bByName.get(s.name);
    if (!b) return s;
    return { ...s, lat: (s.lat + b.lat) / 2, lon: (s.lon + b.lon) / 2 };
  });
}

function pickRelationWithMostStops(relations, elements, routeMode = "subway") {
  let best = null;
  let bestCount = -1;
  for (const rel of relations) {
    const n = extractStopNodes(rel, elements, routeMode).length;
    if (n > bestCount) {
      best = rel;
      bestCount = n;
    }
  }
  return best;
}

function buildCenterTrack(relations, elements = []) {
  const tracks = relations
    .map((r) => stitchTrackSegments(extractTrackSegments(r, elements)))
    .filter((t) => t.length >= 2);

  if (tracks.length === 0) return null;
  if (tracks.length === 1) return removeKinks(tracks[0]);
  return removeKinks(computeCenterline(tracks[0], tracks[1]));
}

// ─── Rendering ────────────────────────────────────────────────────────────────

function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function setStatus(text, isError = false) {
  const el = document.getElementById("status");
  if (!el) return;
  el.textContent = text;
  el.style.color = isError ? "#c5221f" : "var(--muted)";
}

function setDirectionText(text) {
  const el = document.getElementById("direction");
  if (!el) return;
  el.textContent = text;
  el.hidden = !text;
}

function _storageSet(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function _storageGet(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function cacheOverpassDataset(data) {
  _storageSet(OVERPASS_CACHE_KEY, { v: 1, ts: Date.now(), data });
}

function loadCachedOverpassDataset() {
  const payload = _storageGet(OVERPASS_CACHE_KEY);
  if (!payload || payload.v !== 1 || !payload.data || !Array.isArray(payload.data.elements)) return null;
  return payload.data;
}

function buildMasterStatePayload(ref) {
  if (!masterStations || masterStations.length === 0) return null;
  const ctrlPts =
    customControlPoints ??
    (lastComputedCenterline ? subsampleToControlPoints(lastComputedCenterline) : null);
  if (!ctrlPts || ctrlPts.length < 2) return null;
  return {
    v: 4,
    ref,
    controlPoints: ctrlPts.map((p) => [+p[0].toFixed(7), +p[1].toFixed(7)]),
    masterStations: masterStations.map((s) => ({
      name: s.name,
      lat: +s.lat.toFixed(7),
      lon: +s.lon.toFixed(7),
      halfLengthM: +s.halfLengthM.toFixed(2),
      halfWidthM: +s.halfWidthM.toFixed(2),
      level: s.level ?? null,
      heightM: +(s.heightM || 0).toFixed(2),
      heightSource: s.heightSource || "",
    })),
  };
}

function cacheMasterForRef(ref) {
  if (currentRouteMode !== "subway") return;
  if (!ref) return;
  const payload = buildMasterStatePayload(ref);
  if (!payload) return;
  _storageSet(`${MASTER_CACHE_KEY_PREFIX}${ref}`, { v: 1, ts: Date.now(), payload });
}

function scheduleCachePersist(ref) {
  if (currentRouteMode !== "subway") return;
  if (!ref) return;
  if (persistCacheTimer) clearTimeout(persistCacheTimer);
  persistCacheTimer = setTimeout(() => {
    cacheMasterForRef(ref);
    persistCacheTimer = null;
  }, 220);
}

function loadCachedMasterForRef(ref) {
  if (!ref) return false;
  const cached = _storageGet(`${MASTER_CACHE_KEY_PREFIX}${ref}`);
  const payload = cached?.payload;
  if (!payload || payload.v !== 4 || !Array.isArray(payload.controlPoints) || !Array.isArray(payload.masterStations)) {
    return false;
  }
  applyEditsFromParsed(payload);
  return true;
}

function clearRoute() {
  routeLayer.clearLayers();
}

function normalizeAreaKey(sourceValue) {
  let normalized = String(sourceValue || "").trim();
  const replacements = new Map([
    ["\u00c4", "Ae"], ["\u00d6", "Oe"], ["\u00dc", "Ue"],
    ["\u00e4", "ae"], ["\u00f6", "oe"], ["\u00fc", "ue"], ["\u00df", "ss"],
    ["Ã„", "Ae"], ["Ã–", "Oe"], ["Ãœ", "Ue"],
    ["Ã¤", "ae"], ["Ã¶", "oe"], ["Ã¼", "ue"], ["ÃŸ", "ss"],
  ]);
  for (const [from, to] of replacements) normalized = normalized.split(from).join(to);

  let result = "";
  let lastWasUnderscore = false;
  for (const ch of normalized) {
    if (/^[A-Za-z0-9]$/.test(ch)) {
      result += ch;
      lastWasUnderscore = false;
    } else if (!lastWasUnderscore) {
      result += "_";
      lastWasUnderscore = true;
    }
  }
  return result.replace(/^_+|_+$/g, "");
}

function classifyAreaWay(tags = {}) {
  if (tags.building && tags.building !== "no") return "building";
  const highway = tags.highway;
  if (highway) {
    if (["motorway", "motorway_link", "trunk", "trunk_link"].includes(highway)) return "motorway";
    if (["primary", "primary_link", "secondary", "secondary_link"].includes(highway)) return "major_road";
    if (["tertiary", "tertiary_link", "unclassified", "residential", "living_street", "road"].includes(highway)) {
      return "city_road";
    }
    if (highway === "service") return "service";
  }

  const railway = tags.railway;
  if (railway === "tram") return "rail_tram";
  if (railway === "subway") return "rail_subway";
  if (railway === "rail" || railway === "light_rail") return "rail_train";
  return null;
}

function classifyAreaNode(tags = {}) {
  if (tags.natural === "tree") return "tree";
  return null;
}

function areaOverpassFilterForCategory(category) {
  switch (category) {
    case "motorway":
      return 'way["highway"~"^(motorway|motorway_link|trunk|trunk_link)$"]';
    case "major_road":
      return 'way["highway"~"^(primary|primary_link|secondary|secondary_link)$"]';
    case "city_road":
      return 'way["highway"~"^(tertiary|tertiary_link|unclassified|residential|living_street|road)$"]';
    case "service":
      return 'way["highway"="service"]';
    case "rail_tram":
      return 'way["railway"="tram"]';
    case "rail_train":
      return 'way["railway"~"^(rail|light_rail)$"]';
    case "rail_subway":
      return 'way["railway"="subway"]';
    case "bus":
      return null;
    case "building":
      return 'way["building"]';
    case "tree":
      return 'node["natural"="tree"]';
    default:
      return null;
  }
}

function areaRouteModesForCategories(categories) {
  const modes = [];
  for (const [mode, config] of Object.entries(TRANSIT_ROUTE_MODES)) {
    if (categories.includes(config.category)) modes.push(mode);
  }
  return modes;
}

function buildAreaOverpassQuery(bounds, categories = getSelectedAreaCategories()) {
  const bbox = [
    bounds.getSouth().toFixed(7),
    bounds.getWest().toFixed(7),
    bounds.getNorth().toFixed(7),
    bounds.getEast().toFixed(7),
  ].join(",");
  const clauses = categories
    .map(areaOverpassFilterForCategory)
    .filter(Boolean)
    .map((filter) => `  ${filter}(${bbox});`)
    .join("\n");
  const relationClauses = areaRouteModesForCategories(categories)
    .map((mode) => `  relation["type"="route"]["route"="${mode}"](${bbox});`)
    .join("\n");
  if (!clauses && !relationClauses) throw new Error("Keine Bereichs-Layer fuer Overpass ausgewaehlt.");
  return `[out:json][timeout:120];
(
${clauses}${relationClauses ? `\n${relationClauses}` : ""}
);
out geom(${bbox});`;
}

function outCode(lat, lon, bounds) {
  let code = 0;
  if (lon < bounds.getWest()) code |= 1;
  else if (lon > bounds.getEast()) code |= 2;
  if (lat < bounds.getSouth()) code |= 4;
  else if (lat > bounds.getNorth()) code |= 8;
  return code;
}

function clipSegmentToBounds(a, b, bounds) {
  let lat0 = a[0];
  let lon0 = a[1];
  let lat1 = b[0];
  let lon1 = b[1];
  let code0 = outCode(lat0, lon0, bounds);
  let code1 = outCode(lat1, lon1, bounds);

  while (true) {
    if (!(code0 | code1)) return [[lat0, lon0], [lat1, lon1]];
    if (code0 & code1) return null;

    const codeOut = code0 || code1;
    let lat;
    let lon;
    if (codeOut & 8) {
      lat = bounds.getNorth();
      lon = lon0 + ((lon1 - lon0) * (lat - lat0)) / (lat1 - lat0);
    } else if (codeOut & 4) {
      lat = bounds.getSouth();
      lon = lon0 + ((lon1 - lon0) * (lat - lat0)) / (lat1 - lat0);
    } else if (codeOut & 2) {
      lon = bounds.getEast();
      lat = lat0 + ((lat1 - lat0) * (lon - lon0)) / (lon1 - lon0);
    } else {
      lon = bounds.getWest();
      lat = lat0 + ((lat1 - lat0) * (lon - lon0)) / (lon1 - lon0);
    }

    if (codeOut === code0) {
      lat0 = lat;
      lon0 = lon;
      code0 = outCode(lat0, lon0, bounds);
    } else {
      lat1 = lat;
      lon1 = lon;
      code1 = outCode(lat1, lon1, bounds);
    }
  }
}

function clipPolylineToBounds(poly, bounds) {
  const result = [];
  let current = [];
  for (let i = 0; i < poly.length - 1; i++) {
    const clipped = clipSegmentToBounds(poly[i], poly[i + 1], bounds);
    if (!clipped) {
      if (current.length >= 2) result.push(current);
      current = [];
      continue;
    }
    const [start, end] = clipped;
    if (!current.length || pointKey(current[current.length - 1]) !== pointKey(start)) {
      if (current.length >= 2) result.push(current);
      current = [start];
    }
    current.push(end);
  }
  if (current.length >= 2) result.push(current);
  return result;
}

function perpendicularDistanceM(point, a, b) {
  const refLat = (a[0] + b[0]) / 2;
  const m = mpd(refLat);
  const px = (point[1] - a[1]) * m.lon;
  const py = (point[0] - a[0]) * m.lat;
  const bx = (b[1] - a[1]) * m.lon;
  const by = (b[0] - a[0]) * m.lat;
  const lenSq = bx * bx + by * by;
  if (lenSq < 1e-9) return Math.hypot(px, py);
  const t = Math.max(0, Math.min(1, (px * bx + py * by) / lenSq));
  return Math.hypot(px - bx * t, py - by * t);
}

function simplifyPolyline(poly, toleranceM) {
  if (poly.length <= 2) return poly;
  let maxDist = 0;
  let index = 0;
  for (let i = 1; i < poly.length - 1; i++) {
    const dist = perpendicularDistanceM(poly[i], poly[0], poly[poly.length - 1]);
    if (dist > maxDist) {
      index = i;
      maxDist = dist;
    }
  }
  if (maxDist <= toleranceM) return [poly[0], poly[poly.length - 1]];
  const left = simplifyPolyline(poly.slice(0, index + 1), toleranceM);
  const right = simplifyPolyline(poly.slice(index), toleranceM);
  return [...left.slice(0, -1), ...right];
}

function resamplePolylineBySpacing(poly, spacingM) {
  if (poly.length < 2) return poly;
  const cum = cumLengths(poly);
  const total = cum[cum.length - 1];
  if (total <= spacingM) return [poly[0], poly[poly.length - 1]];
  const result = [];
  for (let d = 0; d < total; d += spacingM) {
    result.push(pointAtDist(poly, cum, d));
  }
  result.push(pointAtDist(poly, cum, total));
  return result;
}

function areaGeometrySignature(category, geometry) {
  const points = geometry.map((point) => `${point[0].toFixed(AREA_DEDUPE_DECIMALS)},${point[1].toFixed(AREA_DEDUPE_DECIMALS)}`);
  const forward = points.join("|");
  const backward = [...points].reverse().join("|");
  return `${category}:${forward < backward ? forward : backward}`;
}

function polylineLengthM(poly) {
  if (!Array.isArray(poly) || poly.length < 2) return 0;
  return cumLengths(poly).at(-1) || 0;
}

function areaGroupName(tags, category, id) {
  return tags?.name || tags?.ref || `${AREA_LAYER_LABELS[category]} ${id}`;
}

function isRoundaboutTags(tags = {}) {
  return tags.junction === "roundabout" || tags.junction === "circular";
}

function isClosedPolyline(poly, toleranceM = 2) {
  return Array.isArray(poly) && poly.length >= 4 && haversineM(poly[0], poly[poly.length - 1]) <= toleranceM;
}

function areaCenterlineGroupKey(category, name) {
  return normalizeAreaKey(`${category}_${name}`).toLowerCase();
}

function averagePointDistanceM(trackA, trackB) {
  const n = Math.max(2, Math.min(24, Math.round(Math.min(trackA.length, trackB.length))));
  const a = resamplePolyline(trackA, n);
  const b = resamplePolyline(trackB, n);
  const bForward = b.reduce((sum, point, index) => sum + haversineM(point, a[index]), 0) / n;
  const bReverse = [...b].reverse().reduce((sum, point, index) => sum + haversineM(point, a[index]), 0) / n;
  return Math.min(bForward, bReverse);
}

function shouldMergeAreaCenterline(a, b) {
  if (a.category !== b.category) return false;
  if (a.shape === "roundabout" || b.shape === "roundabout") return false;
  const lenA = polylineLengthM(a.segment10mGeometry);
  const lenB = polylineLengthM(b.segment10mGeometry);
  if (lenA <= 0 || lenB <= 0) return false;
  const lengthRatio = Math.min(lenA, lenB) / Math.max(lenA, lenB);
  if (lengthRatio < AREA_CENTERLINE_LENGTH_RATIO) return false;
  return averagePointDistanceM(a.segment10mGeometry, b.segment10mGeometry) <= AREA_CENTERLINE_MAX_DISTANCE_M;
}

function mergeAreaCenterlinePair(a, b) {
  const centerline = computeCenterline(a.segment10mGeometry, b.segment10mGeometry);
  const simplifiedGeometry = simplifyPolyline(centerline, AREA_SIMPLIFY_TOLERANCE_M);
  const segment10mGeometry = resamplePolylineBySpacing(simplifiedGeometry, AREA_SEGMENT_SPACING_M);
  return {
    ...a,
    id: `${a.id}+${b.id}`,
    key: normalizeAreaKey(`${a.category}_${a.name}_${a.id}_${b.id}_centerline`),
    sourceIds: [...(a.sourceIds || [a.id]), ...(b.sourceIds || [b.id])],
    clippedGeometry: centerline,
    simplifiedGeometry,
    controlGeometry: simplifiedGeometry,
    segment10mGeometry,
    mergedCenterline: true,
  };
}

function mergeAreaCenterlines(features) {
  const groups = new Map();
  for (const feature of features) {
    const key = areaCenterlineGroupKey(feature.category, feature.name);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(feature);
  }

  const merged = [];
  for (const group of groups.values()) {
    const used = new Set();
    for (let i = 0; i < group.length; i++) {
      if (used.has(i)) continue;
      let current = group[i];
      for (let j = i + 1; j < group.length; j++) {
        if (used.has(j)) continue;
        if (!shouldMergeAreaCenterline(current, group[j])) continue;
        current = mergeAreaCenterlinePair(current, group[j]);
        used.add(j);
      }
      used.add(i);
      merged.push(current);
    }
  }
  return merged;
}

function canStitchAreaFeatures(a, b) {
  return a.category === b.category &&
    a.shape !== "roundabout" &&
    b.shape !== "roundabout" &&
    areaCenterlineGroupKey(a.category, a.name) === areaCenterlineGroupKey(b.category, b.name);
}

function stitchAreaFeaturePair(a, b) {
  const options = [
    { distance: haversineM(a.controlGeometry.at(-1), b.controlGeometry[0]), geometry: [...a.controlGeometry, ...b.controlGeometry.slice(1)] },
    { distance: haversineM(a.controlGeometry.at(-1), b.controlGeometry.at(-1)), geometry: [...a.controlGeometry, ...[...b.controlGeometry].reverse().slice(1)] },
    { distance: haversineM(a.controlGeometry[0], b.controlGeometry.at(-1)), geometry: [...b.controlGeometry, ...a.controlGeometry.slice(1)] },
    { distance: haversineM(a.controlGeometry[0], b.controlGeometry[0]), geometry: [...[...b.controlGeometry].reverse(), ...a.controlGeometry.slice(1)] },
  ].sort((x, y) => x.distance - y.distance);

  if (options[0].distance > 6) return null;
  const controlGeometry = simplifyPolyline(options[0].geometry, AREA_SIMPLIFY_TOLERANCE_M);
  return {
    ...a,
    id: `${a.id}+${b.id}`,
    key: normalizeAreaKey(`${a.category}_${a.name}_${a.id}_${b.id}_stitched`),
    sourceIds: [...(a.sourceIds || [a.id]), ...(b.sourceIds || [b.id])],
    clippedGeometry: controlGeometry,
    simplifiedGeometry: controlGeometry,
    controlGeometry,
    segment10mGeometry: resamplePolylineBySpacing(controlGeometry, AREA_SEGMENT_SPACING_M),
  };
}

function stitchConnectedAreaFeatures(features) {
  let pending = [...features];
  let changed = true;
  while (changed) {
    changed = false;
    outer:
    for (let i = 0; i < pending.length; i++) {
      for (let j = i + 1; j < pending.length; j++) {
        if (!canStitchAreaFeatures(pending[i], pending[j])) continue;
        const stitched = stitchAreaFeaturePair(pending[i], pending[j]);
        if (!stitched) continue;
        pending = pending.filter((_, index) => index !== i && index !== j);
        pending.push(stitched);
        changed = true;
        break outer;
      }
    }
  }
  return pending;
}

function buildAreaTransitRelationFeatures(data, bounds, seenSignatures) {
  const features = [];
  const elements = data.elements || [];
  for (const relation of elements) {
    const tags = relation.tags || {};
    if (relation.type !== "relation" || tags.type !== "route" || tags.route !== "bus") continue;

    const stitched = stitchTrackSegments(extractTrackSegments(relation, elements));
    if (stitched.length < 2) continue;
    const clippedParts = clipPolylineToBounds(stitched, bounds);
    for (let partIndex = 0; partIndex < clippedParts.length; partIndex++) {
      const clippedGeometry = clippedParts[partIndex];
      if (clippedGeometry.length < 2) continue;
      const simplifiedGeometry = simplifyPolyline(clippedGeometry, AREA_SIMPLIFY_TOLERANCE_M);
      const segment10mGeometry = resamplePolylineBySpacing(simplifiedGeometry, AREA_SEGMENT_SPACING_M);
      const signature = areaGeometrySignature("bus", segment10mGeometry);
      if (seenSignatures.has(signature)) continue;
      seenSignatures.add(signature);
      const ref = tags.ref || tags.route_ref || "";
      const name = tags.name || (ref ? `Bus ${ref}` : `Bus ${relation.id}`);
      const key = normalizeAreaKey(`bus_${ref || name}_${relation.id}_${partIndex}`);
      if (!key) throw new Error(`Bus-Relation ${relation.id} konnte nicht zu einem gueltigen Key normalisiert werden.`);
      features.push({
        id: relation.id,
        key,
        category: "bus",
        shape: "line",
        closed: false,
        name,
        sourceIds: [relation.id],
        tags,
        rawGeometry: stitched,
        clippedGeometry,
        simplifiedGeometry,
        controlGeometry: simplifiedGeometry,
        segment10mGeometry,
        routeRef: ref,
      });
    }
  }
  return features;
}

function buildAreaFeatures(data, bounds) {
  const features = [];
  const seenSignatures = new Set();
  for (const el of data.elements || []) {
    if (el.type === "node" && Number.isFinite(el.lat) && Number.isFinite(el.lon)) {
      if (!bounds.contains(L.latLng(el.lat, el.lon))) continue;
      const category = classifyAreaNode(el.tags || {});
      if (!category) continue;
      const tags = el.tags || {};
      const name = areaGroupName(tags, category, el.id);
      const key = normalizeAreaKey(`${category}_${name}_${el.id}`);
      if (!key) throw new Error(`Node ${el.id} konnte nicht zu einem gueltigen Key normalisiert werden.`);
      features.push({
        id: el.id,
        key,
        category,
        shape: "point",
        closed: false,
        name,
        sourceIds: [el.id],
        tags,
        rawGeometry: [[el.lat, el.lon]],
        clippedGeometry: [[el.lat, el.lon]],
        simplifiedGeometry: [[el.lat, el.lon]],
        controlGeometry: [[el.lat, el.lon]],
        segment10mGeometry: [[el.lat, el.lon]],
      });
      continue;
    }

    if (el.type !== "way" || !Array.isArray(el.geometry) || el.geometry.length < 2) continue;
    const category = classifyAreaWay(el.tags || {});
    if (!category) continue;

    const rawGeometry = normalizeOverpassGeometry(el.geometry);
    if (rawGeometry.length < 2) continue;
    const clippedParts = clipPolylineToBounds(rawGeometry, bounds);
    for (let partIndex = 0; partIndex < clippedParts.length; partIndex++) {
      const clippedGeometry = clippedParts[partIndex];
      const tags = el.tags || {};
      const roundabout = isRoundaboutTags(tags);
      const closed = isClosedPolyline(clippedGeometry);
      const simplifiedGeometry = roundabout && closed
        ? clippedGeometry
        : simplifyPolyline(clippedGeometry, AREA_SIMPLIFY_TOLERANCE_M);
      const segment10mGeometry = resamplePolylineBySpacing(simplifiedGeometry, AREA_SEGMENT_SPACING_M);
      const signature = areaGeometrySignature(category, segment10mGeometry);
      if (seenSignatures.has(signature)) continue;
      seenSignatures.add(signature);
      const name = areaGroupName(tags, category, el.id);
      const key = normalizeAreaKey(`${category}_${name}_${el.id}_${partIndex}`);
      if (!key) throw new Error(`Way ${el.id} konnte nicht zu einem gueltigen Key normalisiert werden.`);
      features.push({
        id: el.id,
        key,
        category,
        shape: roundabout ? "roundabout" : "line",
        closed,
        name,
        sourceIds: [el.id],
        tags,
        rawGeometry,
        clippedGeometry,
        simplifiedGeometry,
        controlGeometry: simplifiedGeometry,
        segment10mGeometry,
      });
    }
  }
  features.push(...buildAreaTransitRelationFeatures(data, bounds, seenSignatures));
  const pointFeatures = features.filter((feature) => feature.shape === "point");
  const lineFeatures = features.filter((feature) => feature.shape !== "point");
  return [...stitchConnectedAreaFeatures(mergeAreaCenterlines(lineFeatures)), ...pointFeatures];
}

function areaFeatureLabel(feature) {
  const roadType = feature.tags.highway || feature.tags.railway || feature.tags.route || feature.tags.natural || "";
  const shape = feature.shape === "roundabout" ? " · Ringverkehr" : "";
  return `${AREA_LAYER_LABELS[feature.category]}: ${feature.name} (${roadType})${shape}`;
}

function normalizeOverpassGeometry(geometry) {
  if (!Array.isArray(geometry)) return [];
  return geometry
    .map((point) => {
      if (!point) return null;
      const lat = Array.isArray(point) ? point[0] : point.lat;
      const lon = Array.isArray(point) ? point[1] : point.lon;
      return Number.isFinite(lat) && Number.isFinite(lon) ? [lat, lon] : null;
    })
    .filter(Boolean);
}

function renderAreaFeatures() {
  areaRawLayer.clearLayers();
  areaProcessedLayer.clearLayers();

  const counts = new Map(Object.keys(AREA_LAYER_LABELS).map((key) => [key, 0]));
  let visibleCount = 0;
  for (const feature of areaFeatures) {
    counts.set(feature.category, (counts.get(feature.category) || 0) + 1);
    if (!areaLayerVisibility.get(feature.category)) continue;
    visibleCount += 1;

    const style = AREA_STYLE[feature.category];
    if (feature.shape === "point") {
      L.circleMarker(feature.controlGeometry[0], {
        radius: 4,
        color: style.color,
        weight: style.weight,
        opacity: 0.9,
        fillColor: style.color,
        fillOpacity: 0.5,
      }).bindTooltip(areaFeatureLabel(feature)).addTo(areaProcessedLayer);
      continue;
    }

    if (AREA_DRAW_RAW_GEOMETRY) {
      L.polyline(feature.clippedGeometry, {
        color: style.color,
        weight: Math.max(1, style.weight - 1),
        opacity: 0.22,
        dashArray: "2 6",
        lineCap: "round",
        lineJoin: "round",
      }).addTo(areaRawLayer);
    }

    const processed = L.polyline(feature.controlGeometry, {
      color: style.color,
      weight: style.weight,
      opacity: 0.9,
      lineCap: "round",
      lineJoin: "round",
    }).addTo(areaProcessedLayer);
    processed.bindTooltip(areaFeatureLabel(feature), { sticky: true });
  }

  if (areaFeatures.length) {
    updateDatatableAreaLineSelection();
    setStatus(formatAreaContentStatus(counts, visibleCount));
    return;
    const summary = [...counts.entries()]
      .filter(([key, count]) => count > 0 && areaLayerVisibility.get(key))
      .map(([key, count]) => `${AREA_LAYER_LABELS[key]} ${count}`)
      .join(" · ");
    setStatus(`Bereich geladen: ${visibleCount}/${areaFeatures.length} Linien sichtbar${summary ? ` · ${summary}` : ""}`);
  }
}

function renderAreaTransitLinesOnlyStatus() {
  areaRawLayer.clearLayers();
  areaProcessedLayer.clearLayers();
  updateDatatableAreaLineSelection();
  const lines = datatableAreaLines.length ? datatableAreaLines.map(transitLineLabel).join(", ") : "keine";
  setStatus(`Bereich geladen: keine sichtbaren Segmente · ÖPNV-Linien: ${lines}`);
}

function formatAreaContentStatus(counts, visibleCount) {
  const selectedCategories = getSelectedAreaCategories();
  const selectedLabels = selectedCategories.map((category) => AREA_LAYER_LABELS[category]).join(", ");
  const content = [...counts.entries()]
    .filter(([, count]) => count > 0)
    .map(([key, count]) => `${AREA_LAYER_LABELS[key]} ${count}`)
    .join(" | ");
  const lines = datatableAreaLines.length ? datatableAreaLines.map(transitLineLabel).join(", ") : "keine";
  return [
    `Bereich geladen: ${visibleCount}/${areaFeatures.length} sichtbare Segmente`,
    `ÖPNV-Linien: ${lines}`,
    `Inhalt: ${content || "nichts gefunden"}`,
    `Layer: ${selectedLabels || "keine"}`,
  ].join(" · ");
}

function setAreaSelectMode(active) {
  areaSelectMode = active;
  document.getElementById("btn-area-select")?.classList.toggle("active", areaSelectMode);
  map.getContainer().style.cursor = areaSelectMode ? "crosshair" : "";
  if (!areaSelectMode) {
    areaDragStart = null;
    if (areaDraftRect) {
      areaSelectionLayer.removeLayer(areaDraftRect);
      areaDraftRect = null;
    }
  }
}

function areaSelectionStatus(bounds, prefix = "Bereich markiert") {
  const sizeM = [
    haversineM([bounds.getSouth(), bounds.getWest()], [bounds.getNorth(), bounds.getWest()]),
    haversineM([bounds.getSouth(), bounds.getWest()], [bounds.getSouth(), bounds.getEast()]),
  ];
  setStatus(`${prefix}: ${sizeM[1].toFixed(0)} m x ${sizeM[0].toFixed(0)} m · Jetzt "Bereich laden" klicken.`);
}

function areaSelectionCornerLatLngs(bounds) {
  return {
    nw: L.latLng(bounds.getNorth(), bounds.getWest()),
    ne: L.latLng(bounds.getNorth(), bounds.getEast()),
    se: L.latLng(bounds.getSouth(), bounds.getEast()),
    sw: L.latLng(bounds.getSouth(), bounds.getWest()),
  };
}

function areaSelectionHandleIcon(kind) {
  const isMove = kind === "move";
  return L.divIcon({
    className: "",
    html: `<div class="area-edit-handle${isMove ? " move" : ""}"></div>`,
    iconSize: isMove ? [18, 18] : [14, 14],
    iconAnchor: isMove ? [9, 9] : [7, 7],
  });
}

function removeAreaSelectionEditor() {
  if (areaSelectionMoveMarker) {
    areaSelectionLayer.removeLayer(areaSelectionMoveMarker);
    areaSelectionMoveMarker = null;
  }
  for (const marker of areaSelectionResizeMarkers) areaSelectionLayer.removeLayer(marker);
  areaSelectionResizeMarkers = [];
  areaSelectionDragState = null;
}

function updateAreaSelectionVisuals(bounds) {
  areaSelectionBounds = bounds;
  areaSelectionRect?.setBounds(bounds);
  const corners = areaSelectionCornerLatLngs(bounds);
  areaSelectionMoveMarker?.setLatLng(bounds.getCenter());
  for (const marker of areaSelectionResizeMarkers) {
    marker.setLatLng(corners[marker.options.areaCorner]);
  }
}

function boundsFromMoveDrag(currentLatLng) {
  const state = areaSelectionDragState;
  const startBounds = state.bounds;
  const deltaLat = currentLatLng.lat - state.startLatLng.lat;
  const deltaLng = currentLatLng.lng - state.startLatLng.lng;
  return L.latLngBounds(
    [startBounds.getSouth() + deltaLat, startBounds.getWest() + deltaLng],
    [startBounds.getNorth() + deltaLat, startBounds.getEast() + deltaLng],
  );
}

function boundsFromResizeDrag(currentLatLng) {
  const opposite = areaSelectionDragState.opposite;
  return L.latLngBounds(
    [Math.min(opposite.lat, currentLatLng.lat), Math.min(opposite.lng, currentLatLng.lng)],
    [Math.max(opposite.lat, currentLatLng.lat), Math.max(opposite.lng, currentLatLng.lng)],
  );
}

function renderAreaSelectionEditor() {
  removeAreaSelectionEditor();
  if (!areaSelectionBounds?.isValid?.()) return;

  areaSelectionMoveMarker = L.marker(areaSelectionBounds.getCenter(), {
    icon: areaSelectionHandleIcon("move"),
    draggable: true,
    zIndexOffset: 2500,
    title: "Bereich verschieben",
  }).addTo(areaSelectionLayer);
  areaSelectionMoveMarker.on("dragstart", (event) => {
    map.dragging.disable();
    areaSelectionDragState = { type: "move", startLatLng: event.target.getLatLng(), bounds: areaSelectionBounds };
  });
  areaSelectionMoveMarker.on("drag", (event) => updateAreaSelectionVisuals(boundsFromMoveDrag(event.target.getLatLng())));
  areaSelectionMoveMarker.on("dragend", () => {
    map.dragging.enable();
    setAreaSelectionBounds(areaSelectionBounds, "Bereich verschoben");
  });

  const corners = areaSelectionCornerLatLngs(areaSelectionBounds);
  const opposites = { nw: "se", ne: "sw", se: "nw", sw: "ne" };
  areaSelectionResizeMarkers = Object.entries(corners).map(([corner, latLng]) => {
    const marker = L.marker(latLng, {
      icon: areaSelectionHandleIcon(corner),
      draggable: true,
      zIndexOffset: 2600,
      title: "Bereich skalieren",
      areaCorner: corner,
    }).addTo(areaSelectionLayer);
    marker.on("dragstart", () => {
      map.dragging.disable();
      areaSelectionDragState = { type: "resize", corner, opposite: corners[opposites[corner]] };
    });
    marker.on("drag", (event) => updateAreaSelectionVisuals(boundsFromResizeDrag(event.target.getLatLng())));
    marker.on("dragend", () => {
      map.dragging.enable();
      setAreaSelectionBounds(areaSelectionBounds, "Bereich skaliert");
    });
    return marker;
  });
}

function setAreaSelectionBounds(bounds, statusPrefix = "Bereich markiert") {
  if (!bounds?.isValid?.()) {
    setStatus("Bereichsauswahl ist ungueltig.", true);
    return;
  }
  areaSelectionBounds = bounds;
  if (areaSelectionRect) areaSelectionLayer.removeLayer(areaSelectionRect);
  removeAreaSelectionEditor();
  areaSelectionRect = L.rectangle(bounds, {
    color: "#0f766e",
    weight: 2,
    fillColor: "#14b8a6",
    fillOpacity: 0.08,
    dashArray: "6 4",
  }).addTo(areaSelectionLayer);
  renderAreaSelectionEditor();
  areaSelectionStatus(bounds, statusPrefix);
}

function beginAreaSelection(e) {
  if (!areaSelectMode) return;
  L.DomEvent.stop(e);
  areaDragStart = e.latlng;
  map.dragging.disable();
  removeAreaSelectionEditor();
  if (areaSelectionRect) {
    areaSelectionLayer.removeLayer(areaSelectionRect);
    areaSelectionRect = null;
  }
  if (areaDraftRect) areaSelectionLayer.removeLayer(areaDraftRect);
  areaDraftRect = L.rectangle(L.latLngBounds(areaDragStart, areaDragStart), {
    color: "#0f766e",
    weight: 1,
    fillColor: "#14b8a6",
    fillOpacity: 0.05,
    dashArray: "4 4",
  }).addTo(areaSelectionLayer);
}

function updateAreaSelection(e) {
  if (!areaSelectMode || !areaDragStart || !areaDraftRect) return;
  areaDraftRect.setBounds(L.latLngBounds(areaDragStart, e.latlng));
}

function finishAreaSelection(e) {
  if (!areaSelectMode || !areaDragStart) return;
  const bounds = L.latLngBounds(areaDragStart, e.latlng);
  map.dragging.enable();
  if (areaDraftRect) {
    areaSelectionLayer.removeLayer(areaDraftRect);
    areaDraftRect = null;
  }
  areaDragStart = null;
  setAreaSelectMode(false);
  setAreaSelectionBounds(bounds);
}

function drawRoute(finalTrack, stations, fromTo, ref, fitView = false) {
  clearRoute();
  editLayer.clearLayers();

  L.polyline(finalTrack, LINE_STYLE).addTo(routeLayer);

  for (let i = 0; i < stations.length; i++) {
    const s = stations[i];
    const marker = L.circleMarker([s.lat, s.lon], {
      radius: 5,
      color: "#be185d",
      weight: 1.5,
      fillColor: "#f9a8d4",
      fillOpacity: 0.95,
    }).addTo(routeLayer);
    marker.bindTooltip(`${i + 1}. ${s.name}`, {
      direction: "top",
      offset: [0, -4],
      className: "station-tip",
      sticky: true,
    });
    marker.bindPopup(`<strong>${i + 1}. ${escapeHtml(s.name)}</strong>`);
    marker.on("click", () => {
      const ms = masterStations?.find((m) => m.name === s.name) || s;
      showEditPanel(ms);
    });
  }

  const from = fromTo?.from || "";
  const to = fromTo?.to || "";
  setDirectionText(from && to ? `${from} → ${to}` : from || to);

  if (fitView) {
    map.fitBounds(L.latLngBounds(finalTrack), { padding: [48, 48], maxZoom: 13 });
  }

  if (splineEditMode) renderSplineControls();
}

// ─── Render-Helfer: aus masterStations auf Track projizieren + zeichnen ────────

function _renderFromMasterStations(rawTrack, ref, fitView) {
  if (!masterStations || masterStations.length === 0) {
    setStatus("Keine Stationsdaten.", true);
    return;
  }

  const projections = masterStations.map((s) => ({
    ...projectOntoTrack([s.lat, s.lon], rawTrack),
    name: s.name,
    halfLengthM: s.halfLengthM,
    halfWidthM: s.halfWidthM,
    level: s.level ?? null,
    heightM: s.heightM || 0,
    heightSource: s.heightSource || "",
  }));

  const finalGeometry = buildFinalTrack(rawTrack, projections);

  const stationsOrdered = [...projections]
    .sort((a, b) => a.distAlongTrack - b.distAlongTrack)
    .map((p) => ({
      name: p.name,
      lat: p.point[0],
      lon: p.point[1],
      halfLengthM: p.halfLengthM,
      halfWidthM: p.halfWidthM,
      level: p.level ?? null,
      heightM: p.heightM || 0,
      heightSource: p.heightSource || "",
    }));

  const fromTo = lastRelation?.tags
    ? { from: lastRelation.tags.from || "", to: lastRelation.tags.to || "" }
    : {
        from: stationsOrdered[0]?.name || "",
        to: stationsOrdered[stationsOrdered.length - 1]?.name || "",
      };

  drawRoute(finalGeometry.route, stationsOrdered, fromTo, ref, fitView);

  for (const seg of finalGeometry.platforms) {
    L.polygon(seg, PLATFORM_STYLE).addTo(routeLayer);
  }

  if (editModeActive) renderEditMarkers(stationsOrdered);

  scheduleCachePersist(ref);
  setStatus(`Linie ${ref} · ${stationsOrdered.length} Stationen`);
}

function rebuildAndDraw() {
  if (!masterStations) {
    // Noch kein masterStations → normaler Overpass-Pfad
    if (lastLoadData) loadFromUploadedData(lastLoadData.data, lastLoadData.ref);
    return;
  }

  // masterStations vorhanden → Track direkt bauen, kein Overpass-Roundtrip
  let rawTrack;
  if (customControlPoints && customControlPoints.length >= 2) {
    rawTrack = catmullRomSpline(customControlPoints);
  } else if (lastComputedCenterline) {
    rawTrack = lastComputedCenterline;
  } else if (lastLoadData?.data) {
    loadFromUploadedData(lastLoadData.data, lastLoadData.ref);
    return;
  } else {
    setStatus("Kein Track vorhanden.", true);
    return;
  }

  _renderFromMasterStations(rawTrack, lastLoadData?.ref || "?", false);
}

// ─── Spline-Editor ────────────────────────────────────────────────────────────

function renderSplineControls() {
  splineLayer.clearLayers();
  if (!splineEditMode || !customControlPoints) return;

  customControlPoints.forEach((pt, idx) => {
    const icon = L.divIcon({
      html: '<div class="spline-control"></div>',
      iconSize: [10, 10],
      iconAnchor: [5, 5],
      className: "",
    });
    const marker = L.marker(pt, { icon, draggable: true, zIndexOffset: 1500 });

    marker.on("dragend", () => {
      const { lat, lng } = marker.getLatLng();
      customControlPoints[idx] = [lat, lng];
      rebuildAndDraw();
    });

    // Rechtsklick: Kontrollpunkt löschen
    marker.on("contextmenu", (e) => {
      L.DomEvent.stop(e);
      e.originalEvent?.preventDefault?.();
      if (customControlPoints.length > 2) {
        customControlPoints.splice(idx, 1);
        rebuildAndDraw();
      }
    });

    marker.addTo(splineLayer);
  });
}

function handleSplineMapClick(e) {
  if (!splineEditMode || !customControlPoints) return;
  const click = [e.latlng.lat, e.latlng.lng];

  // Nächsten Abschnitt zwischen zwei Kontrollpunkten finden
  let minDist = Infinity;
  let insertIdx = 1;
  for (let i = 0; i < customControlPoints.length - 1; i++) {
    const { proj } = projectOnSegment(click, customControlPoints[i], customControlPoints[i + 1]);
    const d = haversineM(click, proj);
    if (d < minDist) {
      minDist = d;
      insertIdx = i + 1;
    }
  }
  // Nur einfügen wenn Klick nah am Spline (< 80m)
  if (minDist > 80) return;
  customControlPoints.splice(insertIdx, 0, click);
  rebuildAndDraw();
}

function toggleSplineEdit() {
  splineEditMode = !splineEditMode;
  document.getElementById("btn-spline")?.classList.toggle("active", splineEditMode);

  if (splineEditMode) {
    // Kontrollpunkte aus der letzten Overpass-Mittellinie initialisieren
    if (!customControlPoints && lastComputedCenterline) {
      customControlPoints = subsampleToControlPoints(lastComputedCenterline, SPLINE_SPACING_M);
    }
    map.on("click", handleSplineMapClick);
    renderSplineControls();
  } else {
    splineLayer.clearLayers();
    map.off("click", handleSplineMapClick);
  }
}

// ─── UE5-Export ──────────────────────────────────────────────────────────────

/**
 * Exportiert den finalen Track + Stationsdaten als UE5-kompatibles JSON.
 *
 * Koordinatensystem: lokal metrisch, Origin = erster Spline-Kontrollpunkt
 *   X = Nord  (cm)
 *   Y = Ost   (cm)
 *   Z = 0     (Höhe später in UE setzen)
 *
 * Tangenten: Catmull-Rom im selben Raum, direkt in USplineComponent verwendbar.
 *
 * sections-Array: für jede Strecken-Position "tunnel" oder "platform(name)"
 *   → Abfrage in UE: Finde section wo from_m <= distAlongTrack <= to_m
 */
function exportToUnreal(buildOnly = false) {
  if (!masterStations || masterStations.length === 0) {
    setStatus("Keine Stationsdaten vorhanden.", true);
    return;
  }
  const ctrlPts =
    customControlPoints ??
    (lastComputedCenterline ? subsampleToControlPoints(lastComputedCenterline) : null);
  if (!ctrlPts || ctrlPts.length < 2) {
    setStatus("Kein Spline für UE-Export vorhanden.", true);
    return;
  }

  const ref = lastLoadData?.ref || "?";

  // ── Kontrollpunkte / finale Web-Geometrie ─────────────────────────────────
  const orientNorthToSouth = (track) => {
    if (!Array.isArray(track) || track.length < 2) return track;
    const first = track[0];
    const last = track[track.length - 1];
    // Immer N -> S: nördlicher Punkt zuerst
    if (first[0] < last[0]) return [...track].reverse();
    return track;
  };

  const orientedCtrlPts = orientNorthToSouth(ctrlPts);
  const rawTrack = catmullRomSpline(orientedCtrlPts);
  const rawTrackLengthM =
    rawTrack.length > 1 ? rawTrack.slice(1).reduce((acc, _, i) => acc + haversineM(rawTrack[i], rawTrack[i + 1]), 0) : 0;

  const projections = masterStations.map((s) => ({
    ...projectOntoTrack([s.lat, s.lon], rawTrack),
    name: s.name,
    stopLat: s.lat,
    stopLon: s.lon,
    halfLengthM: s.halfLengthM,
    halfWidthM: s.halfWidthM,
    level: s.level ?? null,
    heightM: s.heightM || 0,
    heightSource: s.heightSource || "",
  }));

  const finalGeometry = buildFinalTrack(rawTrack, projections);
  const finalTrack = orientNorthToSouth(finalGeometry.route);
  const finalRouteLengthM =
    finalTrack.length > 1
      ? finalTrack.slice(1).reduce((acc, _, i) => acc + haversineM(finalTrack[i], finalTrack[i + 1]), 0)
      : rawTrackLengthM;

  // ── Koordinaten-Konversion: WGS84 → lokales ENU → UE cm ───────────────────
  const [lat0, lon0] = finalTrack[0] || ctrlPts[0];
  const cosLat = Math.cos((lat0 * Math.PI) / 180);
  const MPD_LAT = 111320;
  const MPD_LON = 111320 * cosLat;

  // UE5: X=Ost, Y=Nord, Z=hoch (alles in cm)
  function toUEcm(lat, lon, zM = 0) {
    const eastM = (lon - lon0) * MPD_LON;
    const northM = (lat - lat0) * MPD_LAT;
    return [
      +(eastM * 100).toFixed(1),
      +(northM * 100).toFixed(1),
      +(zM * 100).toFixed(1),
    ];
  }

  // Stationen auf finale Web-Route projizieren, danach Hoehen entlang der Route interpolieren.
  const finalStations = masterStations.map((s) => ({
    ...projectOntoTrack([s.lat, s.lon], finalTrack),
    name: s.name,
    stopLat: Number.isFinite(s.lat) ? s.lat : null,
    stopLon: Number.isFinite(s.lon) ? s.lon : null,
    halfLengthM: s.halfLengthM,
    halfWidthM: s.halfWidthM,
    level: s.level ?? null,
    heightM: s.heightM || 0,
    heightSource: s.heightSource || "",
  }));
  const sorted = [...finalStations].sort((a, b) => a.distAlongTrack - b.distAlongTrack);

  const heightAnchors = [
    { distM: 0, heightM: 0 },
    ...sorted.map((s) => ({ distM: s.distAlongTrack, heightM: s.heightM || 0 })),
    { distM: finalRouteLengthM, heightM: 0 },
  ]
    .filter((anchor) => Number.isFinite(anchor.distM) && Number.isFinite(anchor.heightM))
    .sort((a, b) => a.distM - b.distM);

  function heightAtDistanceM(distM) {
    if (!heightAnchors.length) return 0;
    if (distM <= heightAnchors[0].distM) return heightAnchors[0].heightM;
    for (let index = 0; index < heightAnchors.length - 1; index += 1) {
      const a = heightAnchors[index];
      const b = heightAnchors[index + 1];
      if (distM > b.distM) continue;
      const span = b.distM - a.distM;
      if (span <= 0.001) return b.heightM;
      const t = (distM - a.distM) / span;
      return a.heightM + (b.heightM - a.heightM) * t;
    }
    return heightAnchors.at(-1).heightM;
  }

  // ── Kontroll-Spline mit Tangenten ─────────────────────────────────────────
  const pts = orientedCtrlPts.map((p) => {
    const proj = projectOntoTrack(p, finalTrack);
    return toUEcm(p[0], p[1], heightAtDistanceM(proj.distAlongTrack));
  });
  const n = pts.length;
  const splinePoints = pts.map((p, i) => {
    const prev = pts[Math.max(0, i - 1)];
    const next = pts[Math.min(n - 1, i + 1)];
    const tx =
      i === 0 ? next[0] - p[0] : i === n - 1 ? p[0] - prev[0] : 0.5 * (next[0] - prev[0]);
    const ty =
      i === 0 ? next[1] - p[1] : i === n - 1 ? p[1] - prev[1] : 0.5 * (next[1] - prev[1]);
    const tz =
      i === 0 ? next[2] - p[2] : i === n - 1 ? p[2] - prev[2] : 0.5 * (next[2] - prev[2]);
    return {
      location: p,
      arrive_tangent: [+tx.toFixed(1), +ty.toFixed(1), +tz.toFixed(1)],
      leave_tangent: [+tx.toFixed(1), +ty.toFixed(1), +tz.toFixed(1)],
    };
  });

  // ── Finale Route exakt wie im Web als dichte Punktfolge ───────────────────
  const routePoints = [];
  let routeCum = 0;
  for (let i = 0; i < finalTrack.length; i++) {
    if (i > 0) routeCum += haversineM(finalTrack[i - 1], finalTrack[i]);
    routePoints.push({
      index: i,
      dist_m: +routeCum.toFixed(2),
      height_m: +heightAtDistanceM(routeCum).toFixed(2),
      wgs84: [+finalTrack[i][0].toFixed(7), +finalTrack[i][1].toFixed(7)],
      pos_cm: toUEcm(finalTrack[i][0], finalTrack[i][1], heightAtDistanceM(routeCum)),
    });
  }

  // ── Sections: tunnel / platform auf Basis der finalen Route ──────────────
  const sections = [];
  let cursor = 0;
  for (const s of sorted) {
    const pStart = +(Math.max(0, s.distAlongTrack - s.halfLengthM)).toFixed(2);
    const pEnd = +(Math.min(finalRouteLengthM, s.distAlongTrack + s.halfLengthM)).toFixed(2);

    if (pStart > cursor + 0.1) {
      sections.push({
        type: "tunnel",
        from_m: +cursor.toFixed(2),
        to_m: pStart,
        from_height_m: +heightAtDistanceM(cursor).toFixed(2),
        to_height_m: +heightAtDistanceM(pStart).toFixed(2),
        center_height_m: +heightAtDistanceM((cursor + pStart) * 0.5).toFixed(2),
      });
    }
    sections.push({
      type: "platform",
      station: s.name,
      from_m: pStart,
      to_m: pEnd,
      center_m: +s.distAlongTrack.toFixed(2),
      from_height_m: +(s.heightM || 0).toFixed(2),
      to_height_m: +(s.heightM || 0).toFixed(2),
      center_height_m: +(s.heightM || 0).toFixed(2),
    });
    cursor = pEnd;
  }
  if (cursor < finalRouteLengthM - 0.1) {
    sections.push({
      type: "tunnel",
      from_m: +cursor.toFixed(2),
      to_m: +finalRouteLengthM.toFixed(2),
      from_height_m: +heightAtDistanceM(cursor).toFixed(2),
      to_height_m: +heightAtDistanceM(finalRouteLengthM).toFixed(2),
      center_height_m: +heightAtDistanceM((cursor + finalRouteLengthM) * 0.5).toFixed(2),
    });
  }

  const platformGeometry = sorted.map((s) => {
    const start = moveMeter(s.point, s.tangent, -s.halfLengthM);
    const end = moveMeter(s.point, s.tangent, s.halfLengthM);
    return {
      station: s.name,
      level: s.level ?? null,
      height_m: +(s.heightM || 0).toFixed(2),
      height_source: s.heightSource || "",
      corners_cm: buildPlatformPolygon(s.point, s.tangent, -s.halfLengthM, s.halfLengthM, s.halfWidthM)
        .map((p) => toUEcm(p[0], p[1], s.heightM || 0)),
      center_line_cm: [toUEcm(start[0], start[1], s.heightM || 0), toUEcm(end[0], end[1], s.heightM || 0)],
    };
  });

  // ── Payload ───────────────────────────────────────────────────────────────
  const from = lastRelation?.tags?.from || "";
  const to = lastRelation?.tags?.to || "";

  const namesByRoute = sorted.map((s) => s.name);
  const rotateToName = (arr, targetName) => {
    if (!targetName) return arr;
    const normTarget = normalizeName(targetName);
    const idx = arr.findIndex((n) => normalizeName(n) === normTarget);
    if (idx <= 0) return arr;
    return [...arr.slice(idx), ...arr.slice(0, idx)];
  };
  const namesFromTo = rotateToName(namesByRoute, from);
  const namesToFrom = [...namesFromTo].reverse();
  const idxFromTo = new Map(namesFromTo.map((name, i) => [name, i]));
  const idxToFrom = new Map(namesToFrom.map((name, i) => [name, i]));
  const northSouth = [...sorted].sort((a, b) => {
    const dLat = b.point[0] - a.point[0]; // nördlich zuerst
    if (Math.abs(dLat) > 1e-9) return dLat;
    return a.point[1] - b.point[1]; // bei Gleichstand west->ost stabil
  });
  const namesNorthToSouth = northSouth.map((s) => s.name);
  const namesSouthToNorth = [...namesNorthToSouth].reverse();
  const idxNorthToSouth = new Map(namesNorthToSouth.map((name, i) => [name, i]));
  const idxSouthToNorth = new Map(namesSouthToNorth.map((name, i) => [name, i]));

  const payload = {
    version: 2,
    ref,
    origin_wgs84: { lat: lat0, lon: lon0 },
    coordinate_system: {
      space: "local_enu_cm",
      x_axis: "east",
      y_axis: "north",
      z_axis: "up",
      origin: "first_final_route_point",
    },
    coordinate_note: "X=East Y=North Z=Up in cm. Origin is first final-route point.",
    query_hint: "To check if dist_m is in a station: find section where from_m <= dist_m <= to_m",
    spline: {
      type: "catmull_rom_control_points",
      total_length_m: +rawTrackLengthM.toFixed(2),
      point_count: splinePoints.length,
      control_points: splinePoints,
    },
    route: {
      type: "final_web_route",
      total_length_m: +finalRouteLengthM.toFixed(2),
      point_count: routePoints.length,
      points: routePoints,
    },
    direction: {
      from,
      to,
      export_forward: "north_to_south",
      track_side_hint: "right_track_is_forward_to_south",
      station_order: {
        route_origin: namesByRoute,
        from_to: namesFromTo,
        to_from: namesToFrom,
        north_to_south: namesNorthToSouth,
        south_to_north: namesSouthToNorth,
      },
    },
    stations: sorted.map((s) => {
      const stopLat = Number.isFinite(s.stopLat) ? s.stopLat : s.point[0];
      const stopLon = Number.isFinite(s.stopLon) ? s.stopLon : s.point[1];
      return {
        name: s.name,
        dist_m: +s.distAlongTrack.toFixed(2),
        order_idx_route_origin: namesByRoute.indexOf(s.name),
        order_idx_from_to: idxFromTo.get(s.name) ?? -1,
        order_idx_to_from: idxToFrom.get(s.name) ?? -1,
        order_idx_north_to_south: idxNorthToSouth.get(s.name) ?? -1,
        order_idx_south_to_north: idxSouthToNorth.get(s.name) ?? -1,
        platform_start_m: +(s.distAlongTrack - s.halfLengthM).toFixed(2),
        platform_end_m: +(s.distAlongTrack + s.halfLengthM).toFixed(2),
        half_length_m: +s.halfLengthM.toFixed(2),
        half_width_m: +s.halfWidthM.toFixed(2),
        level: s.level ?? null,
        height_m: +(s.heightM || 0).toFixed(2),
        height_source: s.heightSource || "",
        wgs84: [+s.point[0].toFixed(7), +s.point[1].toFixed(7)],
        stop_wgs84: [+stopLat.toFixed(7), +stopLon.toFixed(7)],
        location_cm: toUEcm(s.point[0], s.point[1], s.heightM || 0),
        stop_location_cm: toUEcm(stopLat, stopLon, s.heightM || 0),
      };
    }),
    sections,
    platform_geometry: platformGeometry,
  };

  if (buildOnly) return payload;

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `ue5-${ref}-spline.json`;
  a.click();
  URL.revokeObjectURL(a.href);

  setStatus(
    `UE5-Export: ${sorted.length} Stationen · ${sections.length} Abschnitte · ${(finalRouteLengthM / 1000).toFixed(1)} km`,
  );
  return payload;
}

function exportMaster() {
  if (!masterStations) {
    setStatus("Keine Stationsdaten vorhanden.", true);
    return;
  }
  const ctrlPts =
    customControlPoints ??
    (lastComputedCenterline ? subsampleToControlPoints(lastComputedCenterline) : null);
  if (!ctrlPts) {
    setStatus("Kein Track für Export vorhanden.", true);
    return;
  }
  const ref = lastLoadData?.ref || "?";
  const uePayload = exportToUnreal(true);
  const payload = {
    v: 4,
    ref,
    controlPoints: ctrlPts.map((p) => [+p[0].toFixed(7), +p[1].toFixed(7)]),
    masterStations: masterStations.map((s) => ({
      name: s.name,
      lat: +s.lat.toFixed(7),
      lon: +s.lon.toFixed(7),
      halfLengthM: +s.halfLengthM.toFixed(2),
      halfWidthM: +s.halfWidthM.toFixed(2),
      level: s.level ?? null,
      heightM: +(s.heightM || 0).toFixed(2),
      heightSource: s.heightSource || "",
    })),
    // UE-Importer kann direkt diese Felder nutzen (kein separater UE-Export nötig)
    ...uePayload,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `ubahn-master-${ref}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function areaFeatureExportClass(feature) {
  return feature.tags.highway || feature.tags.railway || feature.tags.route || "";
}

function areaTagBool(value) {
  return value != null && value !== "no" && value !== "false" && value !== "0";
}

function areaTagInt(value) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : 0;
}

function areaTagFloat(value) {
  if (value == null) return null;
  const normalized = String(value).replace(",", ".").match(/[0-9]+(?:\.[0-9]+)?/);
  if (!normalized) return null;
  const n = Number.parseFloat(normalized[0]);
  return Number.isFinite(n) ? n : null;
}

function buildingHeightCm(tags = {}) {
  const heightM = areaTagFloat(tags.height);
  if (heightM != null && heightM > 0) return heightM * 100;
  const levels = areaTagFloat(tags["building:levels"]);
  if (levels != null && levels > 0) return levels * 300;
  return DEFAULT_BUILDING_HEIGHT_CM;
}

function treeHeightCm(tags = {}) {
  const heightM = areaTagFloat(tags.height);
  if (heightM != null && heightM > 0) return heightM * 100;
  return DEFAULT_TREE_HEIGHT_CM;
}

function treeCrownDiameterCm(tags = {}) {
  const crownDiameterM = areaTagFloat(tags["diameter_crown"]) ?? areaTagFloat(tags["crown:diameter"]);
  if (crownDiameterM != null && crownDiameterM > 0) return crownDiameterM * 100;
  const circumferenceM = areaTagFloat(tags.circumference);
  if (circumferenceM != null && circumferenceM > 0) return Math.max(100, (circumferenceM / Math.PI) * 800);
  return DEFAULT_TREE_CROWN_DIAMETER_CM;
}

function treeType(tags = {}) {
  return tags.species || tags.genus || tags.taxon || tags.leaf_type || tags.leaf_cycle || tags.denotation || "tree";
}

function areaFeatureWidthM(feature) {
  const explicitWidth = areaTagFloat(feature.tags.width);
  if (explicitWidth != null) return explicitWidth;

  const lanes = areaTagFloat(feature.tags.lanes);
  if (lanes != null && lanes > 0) return lanes * 3.5;

  switch (feature.category) {
    case "motorway":
      return 14;
    case "major_road":
      return 9;
    case "city_road":
      return 6;
    case "service":
      return 3.5;
    case "rail_tram":
    case "rail_train":
    case "rail_subway":
      return 4;
    case "bus":
      return 3.5;
    case "building":
      return 1;
    case "tree":
      return Math.max(1, treeCrownDiameterCm(feature.tags) / 100);
    default:
      return 5;
  }
}

function areaPcgRowName(key, pointIndex) {
  return `${key}_${String(pointIndex).padStart(4, "0")}`;
}

function buildAreaPcgSplines() {
  const selected = areaFeatures.filter(
    (feature) => areaLayerVisibility.get(feature.category) && Array.isArray(feature.controlGeometry) && feature.controlGeometry.length >= 2,
  );
  if (!selected.length) return null;

  const origin = selected[0].controlGeometry[0];
  const [lat0, lon0] = origin;
  const cosLat = Math.cos((lat0 * Math.PI) / 180);
  const metersPerDegreeLat = 111320;
  const metersPerDegreeLon = 111320 * cosLat;

  function toPointCm([lat, lon]) {
    return {
      X: +(((lon - lon0) * metersPerDegreeLon) * 100).toFixed(1),
      Y: +(((lat - lat0) * metersPerDegreeLat) * 100).toFixed(1),
      Z: 0,
    };
  }

  const rows = [];
  for (const feature of selected) {
    if (!feature.key) throw new Error(`Feature ${feature.id} hat keinen gueltigen Export-Key.`);
    const controlPoints = feature.controlGeometry.map(toPointCm);
    const pointCount = controlPoints.length;
    const bClosed = Boolean(feature.closed || isClosedPolyline(feature.controlGeometry));
    controlPoints.forEach((point, pointIndex) => {
      rows.push({
        Name: areaPcgRowName(feature.key, pointIndex),
        SplineKey: feature.key,
        PointIndex: pointIndex,
        PointCount: pointCount,
        Type: feature.category,
        Shape: feature.shape || "line",
        Street: feature.name || "",
        OsmClass: areaFeatureExportClass(feature),
        bBridge: areaTagBool(feature.tags.bridge),
        bTunnel: areaTagBool(feature.tags.tunnel),
        OsmLayer: areaTagInt(feature.tags.layer),
        bClosed,
        X: point.X,
        Y: point.Y,
        Z: point.Z,
      });
    });
  }
  return rows;
}

function buildAreaPythonSplineData() {
  const selected = areaFeatures.filter(
    (feature) => areaLayerVisibility.get(feature.category) && Array.isArray(feature.controlGeometry) && feature.controlGeometry.length >= 2,
  );
  if (!selected.length) return null;

  const origin = selected[0].controlGeometry[0];
  const [lat0, lon0] = origin;
  const cosLat = Math.cos((lat0 * Math.PI) / 180);
  const metersPerDegreeLat = 111320;
  const metersPerDegreeLon = 111320 * cosLat;

  function toPointCm([lat, lon]) {
    return [
      +(((lon - lon0) * metersPerDegreeLon * 100).toFixed(1)),
      +(((lat - lat0) * metersPerDegreeLat * 100).toFixed(1)),
      0,
    ];
  }

  return selected.map((feature) => {
    if (!feature.key) throw new Error(`Feature ${feature.id} hat keinen gueltigen Export-Key.`);
    return {
      SplineKey: feature.key,
      Type: feature.category,
      Shape: feature.shape || "line",
      Street: feature.name || "",
      OsmClass: areaFeatureExportClass(feature),
      WidthM: +areaFeatureWidthM(feature).toFixed(2),
      bBridge: areaTagBool(feature.tags.bridge),
      bTunnel: areaTagBool(feature.tags.tunnel),
      OsmLayer: areaTagInt(feature.tags.layer),
      bClosed: Boolean(feature.closed || isClosedPolyline(feature.controlGeometry)),
      Points: feature.controlGeometry.map(toPointCm),
    };
  });
}

function pointBounds(points) {
  const lats = points.map((point) => point[0]);
  const lons = points.map((point) => point[1]);
  return {
    south: Math.min(...lats),
    north: Math.max(...lats),
    west: Math.min(...lons),
    east: Math.max(...lons),
  };
}

function normalizeDegrees(degrees) {
  let normalized = degrees;
  while (normalized <= -180) normalized += 360;
  while (normalized > 180) normalized -= 360;
  return +normalized.toFixed(3);
}

function buildAreaExportTransform(selected) {
  const origin = selected.find((feature) => feature.controlGeometry?.length)?.controlGeometry[0];
  if (!origin) return null;
  const [lat0, lon0] = origin;
  const metersPerDegreeLat = 111320;
  const metersPerDegreeLon = 111320 * Math.cos((lat0 * Math.PI) / 180);
  return {
    originWgs84: { lat: lat0, lon: lon0 },
    toPointCm([lat, lon]) {
      return {
        X: +(((lon - lon0) * metersPerDegreeLon * 100).toFixed(1)),
        Y: +(((lat - lat0) * metersPerDegreeLat * 100).toFixed(1)),
        Z: 0,
      };
    },
  };
}

function buildingFootprintMetrics(feature, transform) {
  const points = feature.controlGeometry.map((point) => transform.toPointCm(point));
  const openPoints = points.length > 1 && points[0].X === points.at(-1).X && points[0].Y === points.at(-1).Y
    ? points.slice(0, -1)
    : points;
  if (openPoints.length < 3) return null;

  let longestEdge = null;
  for (let index = 0; index < openPoints.length; index += 1) {
    const a = openPoints[index];
    const b = openPoints[(index + 1) % openPoints.length];
    const dx = b.X - a.X;
    const dy = b.Y - a.Y;
    const lengthSq = dx * dx + dy * dy;
    if (!longestEdge || lengthSq > longestEdge.lengthSq) longestEdge = { dx, dy, lengthSq };
  }
  if (!longestEdge || longestEdge.lengthSq <= 0) return null;

  const yawRad = Math.atan2(longestEdge.dy, longestEdge.dx);
  const axisX = { x: Math.cos(yawRad), y: Math.sin(yawRad) };
  const axisY = { x: -axisX.y, y: axisX.x };
  const projected = openPoints.map((point) => ({
    u: point.X * axisX.x + point.Y * axisX.y,
    v: point.X * axisY.x + point.Y * axisY.y,
  }));
  const minU = Math.min(...projected.map((point) => point.u));
  const maxU = Math.max(...projected.map((point) => point.u));
  const minV = Math.min(...projected.map((point) => point.v));
  const maxV = Math.max(...projected.map((point) => point.v));
  const centerU = (minU + maxU) * 0.5;
  const centerV = (minV + maxV) * 0.5;

  return {
    center: {
      X: +(centerU * axisX.x + centerV * axisY.x).toFixed(1),
      Y: +(centerU * axisX.y + centerV * axisY.y).toFixed(1),
      Z: 0,
    },
    widthCm: +Math.max(100, maxU - minU).toFixed(1),
    depthCm: +Math.max(100, maxV - minV).toFixed(1),
    yawDeg: normalizeDegrees((yawRad * 180) / Math.PI),
    footprintCm: openPoints.map((point) => ({ X: point.X, Y: point.Y, Z: point.Z })),
  };
}

function buildBuildingData(selected, transform) {
  return selected
    .filter((feature) => feature.category === "building" && feature.controlGeometry.length >= 3)
    .map((feature) => {
      const bounds = pointBounds(feature.controlGeometry);
      const metrics = buildingFootprintMetrics(feature, transform);
      if (!metrics) return null;
      const heightCm = +buildingHeightCm(feature.tags).toFixed(1);
      return {
        BuildingKey: feature.key,
        OsmId: feature.id,
        Name: feature.name || feature.key,
        Type: feature.tags.building || "building",
        FootprintCm: metrics.footprintCm,
        WidthCm: metrics.widthCm,
        DepthCm: metrics.depthCm,
        HeightCm: Math.max(100, heightCm),
        YawDeg: metrics.yawDeg,
        X: metrics.center.X,
        Y: metrics.center.Y,
        Z: heightCm * 0.5,
        CenterWgs84: {
          lat: +(((bounds.south + bounds.north) * 0.5).toFixed(7)),
          lon: +(((bounds.west + bounds.east) * 0.5).toFixed(7)),
        },
      };
    })
    .filter(Boolean);
}

function buildTreeData(selected, transform) {
  return selected
    .filter((feature) => feature.category === "tree" && feature.controlGeometry.length >= 1)
    .map((feature) => {
      const [lat, lon] = feature.controlGeometry[0];
      const location = transform.toPointCm([lat, lon]);
      const heightCm = +treeHeightCm(feature.tags).toFixed(1);
      const crownDiameterCm = +treeCrownDiameterCm(feature.tags).toFixed(1);
      return {
        TreeKey: feature.key,
        OsmId: feature.id,
        Name: feature.name || feature.key,
        Type: treeType(feature.tags),
        Species: feature.tags.species || "",
        Genus: feature.tags.genus || "",
        LeafType: feature.tags.leaf_type || "",
        LeafCycle: feature.tags.leaf_cycle || "",
        Denotation: feature.tags.denotation || "",
        HeightCm: Math.max(100, heightCm),
        CrownDiameterCm: Math.max(100, crownDiameterCm),
        CircumferenceM: areaTagFloat(feature.tags.circumference) ?? null,
        X: location.X,
        Y: location.Y,
        Z: 0,
        Wgs84: {
          lat: +lat.toFixed(7),
          lon: +lon.toFixed(7),
        },
      };
    });
}

function buildAreaPythonExportPayload() {
  const selected = areaFeatures.filter(
    (feature) => areaLayerVisibility.get(feature.category) && Array.isArray(feature.controlGeometry) && feature.controlGeometry.length >= 1,
  );
  if (!selected.length) return null;
  const transform = buildAreaExportTransform(selected);
  if (!transform) return null;

  const splines = buildAreaPythonSplineData() || [];
  return {
    origin_wgs84: transform.originWgs84,
    splines: splines.filter((row) => row.Type !== "building"),
    buildings: buildBuildingData(selected, transform),
    trees: buildTreeData(selected, transform),
  };
}

function exportAreaPcgSplines() {
  try {
    const payload = buildAreaPcgSplines();
    if (!payload) {
      setStatus("Keine sichtbaren Bereichsdaten fuer PCG-Export vorhanden.", true);
      return;
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "ue-pcg-area-splines.json";
    a.click();
    URL.revokeObjectURL(a.href);
    setStatus(`PCG-Export: ${payload.length} DataTable-Zeilen`);
  } catch (error) {
    setStatus(`PCG-Export fehlgeschlagen: ${error.message}`, true);
  }
}

function buildAreaUnrealPythonScript(rows) {
  const jsonText = JSON.stringify(rows, null, 2);
  const jsonLiteral = JSON.stringify(jsonText);
  return `import json
import re

import unreal


STREET_ROWS = json.loads(${jsonLiteral})
ACTOR_LABEL_PREFIX = "CITY_STREET"
SPLINE_COMPONENT_NAME = "StreetSpline"
WORLD_OFFSET_CM = unreal.Vector(0.0, 0.0, 0.0)
FORCE_ZERO_Z = True
LINEAR_SPLINES = True


def log(level, message):
    unreal.log(f"[{level}] {message}")


def fail(message):
    unreal.log_error(message)
    raise RuntimeError(message)


def destroy_existing_actor_with_prefix(prefix):
    for actor in unreal.EditorLevelLibrary.get_all_level_actors():
        if actor.get_actor_label().startswith(prefix):
            unreal.EditorLevelLibrary.destroy_actor(actor)


def require_key(row, key, row_index):
    if key not in row:
        fail(f"Row {row_index} is missing required key '{key}': {row}")
    return row[key]


def require_string(row, key, row_index):
    value = require_key(row, key, row_index)
    if not isinstance(value, str) or not value:
        fail(f"Row {row_index} key '{key}' must be a non-empty string")
    return value


def require_int(row, key, row_index):
    value = require_key(row, key, row_index)
    if isinstance(value, bool) or not isinstance(value, int):
        fail(f"Row {row_index} key '{key}' must be an integer")
    return value


def require_bool(row, key, row_index):
    value = require_key(row, key, row_index)
    if not isinstance(value, bool):
        fail(f"Row {row_index} key '{key}' must be a bool")
    return value


def require_number(row, key, row_index):
    value = require_key(row, key, row_index)
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        fail(f"Row {row_index} key '{key}' must be numeric")
    return float(value)


def validate_row(row, row_index):
    if not isinstance(row, dict):
        fail(f"Row {row_index} must be a JSON object")

    return {
        "Name": require_string(row, "Name", row_index),
        "SplineKey": require_string(row, "SplineKey", row_index),
        "PointIndex": require_int(row, "PointIndex", row_index),
        "PointCount": require_int(row, "PointCount", row_index),
        "Type": require_string(row, "Type", row_index),
        "Shape": require_string(row, "Shape", row_index),
        "Street": str(row.get("Street", "")),
        "OsmClass": str(row.get("OsmClass", "")),
        "bBridge": require_bool(row, "bBridge", row_index),
        "bTunnel": require_bool(row, "bTunnel", row_index),
        "OsmLayer": require_int(row, "OsmLayer", row_index),
        "bClosed": require_bool(row, "bClosed", row_index),
        "X": require_number(row, "X", row_index),
        "Y": require_number(row, "Y", row_index),
        "Z": require_number(row, "Z", row_index),
    }


def group_rows(rows):
    groups = {}
    for row_index, row in enumerate(rows):
        validated = validate_row(row, row_index)
        groups.setdefault(validated["SplineKey"], []).append(validated)
    if not groups:
        fail("No street spline rows found")
    return groups


def validate_group(spline_key, rows):
    point_counts = {row["PointCount"] for row in rows}
    if len(point_counts) != 1:
        fail(f"Spline '{spline_key}' has inconsistent PointCount values: {sorted(point_counts)}")

    point_count = point_counts.pop()
    if point_count != len(rows):
        fail(f"Spline '{spline_key}' declares PointCount={point_count}, but has {len(rows)} rows")
    if point_count < 2:
        fail(f"Spline '{spline_key}' needs at least 2 points")

    sorted_rows = sorted(rows, key=lambda row: row["PointIndex"])
    actual_indices = [row["PointIndex"] for row in sorted_rows]
    expected_indices = list(range(point_count))
    if actual_indices != expected_indices:
        fail(f"Spline '{spline_key}' has invalid PointIndex sequence: {actual_indices}")
    return sorted_rows


def sanitize_label_part(value):
    sanitized = re.sub(r"[^A-Za-z0-9_]+", "_", value).strip("_")
    return sanitized or "Unnamed"


def point_to_vector(row):
    return unreal.Vector(
        row["X"] + WORLD_OFFSET_CM.x,
        row["Y"] + WORLD_OFFSET_CM.y,
        (0.0 if FORCE_ZERO_Z else row["Z"]) + WORLD_OFFSET_CM.z,
    )


def spawn_empty_actor(label):
    actor = unreal.EditorLevelLibrary.spawn_actor_from_class(
        unreal.Actor,
        unreal.Vector(0.0, 0.0, 0.0),
        unreal.Rotator(0.0, 0.0, 0.0),
    )
    if actor is None:
        fail(f"Failed to spawn actor '{label}'")
    actor.set_actor_label(label)
    return actor


def add_spline_component(actor):
    if not hasattr(actor, "add_component_by_class"):
        fail("Actor.add_component_by_class is not exposed. Use the file import script with a BP actor fallback.")

    component = actor.add_component_by_class(
        unreal.SplineComponent,
        False,
        unreal.Transform(),
        False,
    )
    if component is None:
        fail(f"Failed to add SplineComponent to actor '{actor.get_actor_label()}'")
    component.set_editor_property("component_tags", [unreal.Name("CityStreetSpline")])
    component.rename(SPLINE_COMPONENT_NAME)
    return component


def set_editor_property_if_present(obj, property_name, value):
    try:
        obj.set_editor_property(property_name, value)
        return True
    except Exception:
        return False


def configure_spline_component(spline_component, rows):
    set_editor_property_if_present(spline_component, "override_construction_script", True)
    set_editor_property_if_present(spline_component, "input_spline_points_to_construction_script", False)
    spline_component.clear_spline_points(False)

    for row in rows:
        spline_component.add_spline_point(point_to_vector(row), unreal.SplineCoordinateSpace.LOCAL, False)

    for index in range(len(rows)):
        point_type = unreal.SplinePointType.LINEAR if LINEAR_SPLINES else unreal.SplinePointType.CURVE
        spline_component.set_spline_point_type(index, point_type, False)

    if hasattr(spline_component, "set_closed_loop"):
        spline_component.set_closed_loop(bool(rows[0]["bClosed"]), False)
    elif bool(rows[0]["bClosed"]):
        fail("SplineComponent does not expose set_closed_loop, but the source spline is closed")

    spline_component.update_spline()


def set_actor_tags(actor, rows):
    first = rows[0]
    tags = ["CityStreet", first["SplineKey"], first["Type"], first["Shape"], first["OsmClass"]]
    if first["Street"]:
        tags.append(first["Street"])
    if first["bBridge"]:
        tags.append("Bridge")
    if first["bTunnel"]:
        tags.append("Tunnel")
    actor.tags = [unreal.Name(str(tag)) for tag in tags if str(tag)]


def create_street_spline_actor(spline_key, rows):
    sorted_rows = validate_group(spline_key, rows)
    label = f"{ACTOR_LABEL_PREFIX}_{sanitize_label_part(spline_key)}"
    actor = spawn_empty_actor(label)
    spline_component = add_spline_component(actor)
    configure_spline_component(spline_component, sorted_rows)
    set_actor_tags(actor, sorted_rows)
    return actor


def main():
    groups = group_rows(STREET_ROWS)
    destroy_existing_actor_with_prefix(f"{ACTOR_LABEL_PREFIX}_")
    created = 0
    for spline_key, rows in groups.items():
        create_street_spline_actor(spline_key, rows)
        created += 1
    log("INFO", f"Imported {created} city street splines from {len(STREET_ROWS)} point rows")


main()
`;
}

function buildCompactAreaUnrealPythonScript(payload, bpPaths) {
  const splines = Array.isArray(payload) ? payload : (payload?.splines || []);
  const buildings = Array.isArray(payload) ? [] : (payload?.buildings || []);
  const trees = Array.isArray(payload) ? [] : (payload?.trees || []);
  const jsonLiteral = JSON.stringify(JSON.stringify(splines));
  const buildingJsonLiteral = JSON.stringify(JSON.stringify(buildings));
  const treeJsonLiteral = JSON.stringify(JSON.stringify(trees));
  const bpPathsLiteral = JSON.stringify(JSON.stringify({
    ...DEFAULT_AREA_BP_PATHS,
    ...(bpPaths || {}),
  }));
  return `import json
import re

import unreal


STREET_SPLINES = json.loads(${jsonLiteral})
BUILDINGS = json.loads(${buildingJsonLiteral})
TREES = json.loads(${treeJsonLiteral})
BP_PATHS = json.loads(${bpPathsLiteral})
ACTOR_LABEL_PREFIX = "CITY_STREET"
BUILDING_ACTOR_LABEL_PREFIX = "OSM_BUILDING"
TREE_ACTOR_LABEL_PREFIX = "OSM_TREE"
SPLINE_COMPONENT_NAMES = ["StreetSpline", "Spline"]
WORLD_OFFSET_CM = unreal.Vector(0.0, 0.0, 0.0)
FORCE_ZERO_Z = True
LINEAR_SPLINES = True
CUBE_BASE_CM = 100.0


def fail(message):
    unreal.log_error(message)
    raise RuntimeError(message)


def destroy_existing_actor_with_prefix(prefix):
    for actor in unreal.EditorLevelLibrary.get_all_level_actors():
        if actor.get_actor_label().startswith(prefix):
            unreal.EditorLevelLibrary.destroy_actor(actor)


def load_bp_class(asset_path):
    asset_class = unreal.EditorAssetLibrary.load_blueprint_class(asset_path)
    if asset_class is None:
        fail(f"Could not load Blueprint class: {asset_path}")
    return asset_class


def bp_kind_for_row(row):
    if bool(row.get("bTunnel", False)):
        return "tunnel"
    row_type = str(row.get("Type", ""))
    if row_type == "rail_subway":
        return "subway"
    if row_type == "rail_tram":
        return "tram"
    if row_type == "rail_train":
        return "train"
    if row_type == "bus":
        return "bus"
    return "street"


def bp_class_for_row(row, cache):
    kind = bp_kind_for_row(row)
    asset_path = BP_PATHS.get(kind) or BP_PATHS.get("street")
    if not isinstance(asset_path, str) or not asset_path.strip():
        fail(f"No Blueprint path configured for kind '{kind}'")
    if asset_path not in cache:
        cache[asset_path] = load_bp_class(asset_path)
    return cache[asset_path]


def sanitize_label_part(value):
    sanitized = re.sub(r"[^A-Za-z0-9_]+", "_", str(value)).strip("_")
    return sanitized or "Unnamed"


def point_to_vector(point):
    if not isinstance(point, list) or len(point) != 3:
        fail(f"Invalid point: {point}")
    x, y, z = point
    if isinstance(x, bool) or isinstance(y, bool) or isinstance(z, bool):
        fail(f"Invalid bool coordinate in point: {point}")
    if not isinstance(x, (int, float)) or not isinstance(y, (int, float)) or not isinstance(z, (int, float)):
        fail(f"Invalid numeric coordinate in point: {point}")
    return unreal.Vector(
        float(x) + WORLD_OFFSET_CM.x,
        float(y) + WORLD_OFFSET_CM.y,
        (0.0 if FORCE_ZERO_Z else float(z)) + WORLD_OFFSET_CM.z,
    )


def require_spline(row, index):
    if not isinstance(row, dict):
        fail(f"Spline {index} must be an object")
    key = row.get("SplineKey")
    points = row.get("Points")
    if not isinstance(key, str) or not key:
        fail(f"Spline {index} has no valid SplineKey")
    if not isinstance(points, list) or len(points) < 2:
        fail(f"Spline '{key}' needs at least 2 points")
    return row


def find_spline_component(actor):
    spline_components = actor.get_components_by_class(unreal.SplineComponent)
    for component_name in SPLINE_COMPONENT_NAMES:
        for component in spline_components:
            if component.get_name() == component_name:
                return component
    if spline_components:
        return spline_components[0]
    fail(f"No SplineComponent found on actor '{actor.get_actor_label()}'. Add one to BP_CityTest.")


def set_editor_property_if_present(obj, property_name, value):
    try:
        obj.set_editor_property(property_name, value)
        return True
    except Exception:
        return False


def configure_spline_component(spline_component, row):
    set_editor_property_if_present(spline_component, "override_construction_script", True)
    set_editor_property_if_present(spline_component, "input_spline_points_to_construction_script", False)
    spline_component.clear_spline_points(False)
    for point in row["Points"]:
        spline_component.add_spline_point(point_to_vector(point), unreal.SplineCoordinateSpace.LOCAL, False)
    for index in range(len(row["Points"])):
        point_type = unreal.SplinePointType.LINEAR if LINEAR_SPLINES else unreal.SplinePointType.CURVE
        spline_component.set_spline_point_type(index, point_type, False)
    if hasattr(spline_component, "set_closed_loop"):
        spline_component.set_closed_loop(bool(row.get("bClosed", False)), False)
    elif bool(row.get("bClosed", False)):
        fail("SplineComponent does not expose set_closed_loop, but the source spline is closed")
    spline_component.update_spline()


def set_actor_tags(actor, row):
    tags = [
        "CityStreet",
        f"Strasse Name:{row.get('Street', '') or row.get('SplineKey', '')}",
        f"Typ:{row.get('Type', '')}",
        f"Breite:{float(row.get('WidthM', 0.0)):.2f}",
        f"SplineKey:{row.get('SplineKey', '')}",
        f"OsmClass:{row.get('OsmClass', '')}",
    ]
    if row.get("bBridge"):
        tags.append("Bridge")
    if row.get("bTunnel"):
        tags.append("Tunnel")
    actor.tags = [unreal.Name(str(tag)) for tag in tags if str(tag)]


def create_street_spline_actor(actor_class, row):
    label = f"{ACTOR_LABEL_PREFIX}_{sanitize_label_part(row['SplineKey'])}"
    actor = unreal.EditorLevelLibrary.spawn_actor_from_class(
        actor_class,
        unreal.Vector(0.0, 0.0, 0.0),
        unreal.Rotator(0.0, 0.0, 0.0),
    )
    if actor is None:
        fail(f"Failed to spawn actor '{label}'")
    actor.set_actor_label(label)
    spline_component = find_spline_component(actor)
    configure_spline_component(spline_component, row)
    set_actor_tags(actor, row)
    return actor


def create_building_actor(actor_class, row):
    label = f"{BUILDING_ACTOR_LABEL_PREFIX}_{sanitize_label_part(row.get('BuildingKey', row.get('Name', 'Building')))}"
    location = unreal.Vector(
        float(row["X"]) + WORLD_OFFSET_CM.x,
        float(row["Y"]) + WORLD_OFFSET_CM.y,
        float(row["Z"]) + WORLD_OFFSET_CM.z,
    )
    rotation = unreal.Rotator(roll=0.0, pitch=0.0, yaw=float(row.get("YawDeg", 0.0)))
    actor = unreal.EditorLevelLibrary.spawn_actor_from_class(actor_class, location, rotation)
    if actor is None:
        fail(f"Failed to spawn actor '{label}'")
    actor.set_actor_label(label)
    actor.set_actor_scale3d(
        unreal.Vector(
            max(0.01, float(row["WidthCm"]) / CUBE_BASE_CM),
            max(0.01, float(row["DepthCm"]) / CUBE_BASE_CM),
            max(0.01, float(row["HeightCm"]) / CUBE_BASE_CM),
        )
    )
    actor.tags = [
        unreal.Name("building"),
        unreal.Name(str(row.get("BuildingKey", ""))),
        unreal.Name(str(row.get("OsmId", ""))),
        unreal.Name(str(row.get("Name", ""))),
        unreal.Name(str(row.get("Type", ""))),
    ]
    return actor


def create_tree_actor(actor_class, row):
    label = f"{TREE_ACTOR_LABEL_PREFIX}_{sanitize_label_part(row.get('TreeKey', row.get('Name', 'Tree')))}"
    location = unreal.Vector(
        float(row["X"]) + WORLD_OFFSET_CM.x,
        float(row["Y"]) + WORLD_OFFSET_CM.y,
        float(row.get("Z", 0.0)) + WORLD_OFFSET_CM.z,
    )
    actor = unreal.EditorLevelLibrary.spawn_actor_from_class(actor_class, location, unreal.Rotator(0.0, 0.0, 0.0))
    if actor is None:
        fail(f"Failed to spawn actor '{label}'")
    actor.set_actor_label(label)
    crown_scale = max(0.01, float(row.get("CrownDiameterCm", CUBE_BASE_CM)) / CUBE_BASE_CM)
    height_scale = max(0.01, float(row.get("HeightCm", CUBE_BASE_CM)) / CUBE_BASE_CM)
    actor.set_actor_scale3d(unreal.Vector(crown_scale, crown_scale, height_scale))
    actor.tags = [
        unreal.Name("tree"),
        unreal.Name(str(row.get("TreeKey", ""))),
        unreal.Name(str(row.get("OsmId", ""))),
        unreal.Name(str(row.get("Type", ""))),
        unreal.Name(f"HeightCm:{row.get('HeightCm', '')}"),
        unreal.Name(f"CrownDiameterCm:{row.get('CrownDiameterCm', '')}"),
        unreal.Name(f"Species:{row.get('Species', '')}"),
        unreal.Name(f"LeafType:{row.get('LeafType', '')}"),
    ]
    return actor


def main():
    bp_class_cache = {}
    destroy_existing_actor_with_prefix(f"{ACTOR_LABEL_PREFIX}_")
    destroy_existing_actor_with_prefix(f"{BUILDING_ACTOR_LABEL_PREFIX}_")
    destroy_existing_actor_with_prefix(f"{TREE_ACTOR_LABEL_PREFIX}_")
    point_count = 0
    for index, source_row in enumerate(STREET_SPLINES):
        row = require_spline(source_row, index)
        point_count += len(row["Points"])
        actor_class = bp_class_for_row(row, bp_class_cache)
        create_street_spline_actor(actor_class, row)
    building_actor_class = load_bp_class(BP_PATHS["building"]) if BUILDINGS else None
    for row in BUILDINGS:
        create_building_actor(building_actor_class, row)
    tree_actor_class = load_bp_class(BP_PATHS["tree"]) if TREES else None
    for row in TREES:
        create_tree_actor(tree_actor_class, row)
    unreal.log(f"[INFO] Imported {len(STREET_SPLINES)} city street splines from {point_count} points, {len(BUILDINGS)} buildings and {len(TREES)} trees")


main()
`;
}

let latestAreaPythonScript = "";

function downloadTextFile(filename, content, type = "text/plain") {
  const blob = new Blob([content], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function stationExportKey(name) {
  return normalizeAreaKey(name).replace(/_+/g, "_").replace(/^_+|_+$/g, "") || "Station";
}

function datatableNumber(value) {
  return +Number(value || 0).toFixed(2);
}

function getStoredAreaBpPath(kind) {
  const fallback = DEFAULT_AREA_BP_PATHS[kind] || DEFAULT_AREA_BP_PATHS.street;
  const stored = window.localStorage.getItem(`${AREA_BP_STORAGE_KEY_PREFIX}${kind}`);
  return stored?.trim() || fallback;
}

function setStoredAreaBpPath(kind, value) {
  const fallback = DEFAULT_AREA_BP_PATHS[kind] || DEFAULT_AREA_BP_PATHS.street;
  const normalized = String(value || "").trim();
  window.localStorage.setItem(`${AREA_BP_STORAGE_KEY_PREFIX}${kind}`, normalized || fallback);
}

function getAreaBpPathsForExport() {
  const paths = {};
  for (const kind of Object.keys(DEFAULT_AREA_BP_PATHS)) {
    const input = document.getElementById(`${kind}-bp-path-input`);
    paths[kind] = input?.value?.trim() || getStoredAreaBpPath(kind);
  }
  return paths;
}

function initAreaBpPathInputs() {
  for (const kind of Object.keys(DEFAULT_AREA_BP_PATHS)) {
    const input = document.getElementById(`${kind}-bp-path-input`);
    if (!input) continue;
    input.value = getStoredAreaBpPath(kind);
    input.addEventListener("change", () => setStoredAreaBpPath(kind, input.value));
    input.addEventListener("blur", () => setStoredAreaBpPath(kind, input.value));
  }
}

function buildBlueprintSetupPythonScript(bpPaths) {
  const pathsLiteral = JSON.stringify(JSON.stringify({
    ...DEFAULT_AREA_BP_PATHS,
    ...(bpPaths || {}),
  }));
  return `import json

import unreal


BP_PATHS = json.loads(${pathsLiteral})

SPLINE_KINDS = {"tunnel", "subway", "tram", "train", "bus", "street"}
MESH_KINDS = {"building", "tree"}
KIND_LABELS = {
    "tunnel": "Tunnel",
    "subway": "U-Bahn/Gleis",
    "tram": "Tram",
    "train": "S-Bahn/Zug",
    "bus": "Bus",
    "street": "Strasse",
    "building": "Gebaeude",
    "tree": "Baum",
}
MESH_BY_KIND = {
    "building": "/Engine/BasicShapes/Cube.Cube",
    "tree": "/Engine/BasicShapes/Sphere.Sphere",
}


def fail(message):
    unreal.log_error(message)
    raise RuntimeError(message)


def log(message):
    unreal.log(f"[UEMap BP Setup] {message}")


def normalize_asset_path(asset_path):
    if not isinstance(asset_path, str) or not asset_path.startswith("/Game/"):
        fail(f"Blueprint path must start with /Game/: {asset_path!r}")
    package_asset = asset_path.split(".")[0]
    package_path, asset_name = package_asset.rsplit("/", 1)
    if not package_path or not asset_name:
        fail(f"Invalid Blueprint path: {asset_path!r}")
    return package_path, asset_name, f"{package_path}/{asset_name}"


def create_actor_blueprint(package_path, asset_name):
    existing_path = f"{package_path}/{asset_name}"
    existing_class = unreal.EditorAssetLibrary.load_blueprint_class(existing_path)
    if existing_class is not None:
        log(f"Exists: {existing_path}")
        return unreal.EditorAssetLibrary.load_asset(existing_path), False

    factory = unreal.BlueprintFactory()
    factory.set_editor_property("parent_class", unreal.Actor)
    asset_tools = unreal.AssetToolsHelpers.get_asset_tools()
    blueprint = asset_tools.create_asset(asset_name, package_path, unreal.Blueprint, factory)
    if blueprint is None:
        fail(f"Could not create Blueprint: {existing_path}")
    log(f"Created: {existing_path}")
    return blueprint, True


def component_exists_scs(blueprint, component_name):
    scs = blueprint.get_editor_property("simple_construction_script")
    for node in scs.get_all_nodes():
        if str(node.get_variable_name()) == component_name:
            return True
    return False


def add_component_scs(blueprint, component_class, component_name):
    scs = blueprint.get_editor_property("simple_construction_script")
    if component_exists_scs(blueprint, component_name):
        return None
    node = scs.create_node(component_class, unreal.Name(component_name))
    scs.add_node(node)
    return node.get_editor_property("component_template")


def add_component_subobject(blueprint, component_class, component_name):
    subsystem = unreal.get_engine_subsystem(unreal.SubobjectDataSubsystem)
    if subsystem is None:
        fail("SubobjectDataSubsystem is not available in this Unreal version")
    handles = subsystem.k2_gather_subobject_data_for_blueprint(blueprint)
    if not handles:
        fail(f"No subobject root found for {blueprint.get_name()}")
    params = unreal.AddNewSubobjectParams(
        parent_handle=handles[0],
        new_class=component_class,
        blueprint_context=blueprint,
    )
    result = subsystem.add_new_subobject(params)
    handle = result[0] if isinstance(result, tuple) else result
    subsystem.rename_subobject(handle, unreal.Text(component_name))
    data = unreal.SubobjectDataBlueprintFunctionLibrary.get_data(handle)
    return unreal.SubobjectDataBlueprintFunctionLibrary.get_object(data)


def add_component(blueprint, component_class, component_name):
    try:
        return add_component_scs(blueprint, component_class, component_name)
    except Exception as scs_error:
        log(f"SCS add failed for {blueprint.get_name()}.{component_name}: {scs_error}")
        return add_component_subobject(blueprint, component_class, component_name)


def configure_spline_blueprint(blueprint):
    component = add_component(blueprint, unreal.SplineComponent, "StreetSpline")
    if component is not None:
        try:
            component.set_editor_property("component_tags", [unreal.Name("CityStreetSpline")])
        except Exception:
            pass


def configure_mesh_blueprint(blueprint, kind):
    component = add_component(blueprint, unreal.StaticMeshComponent, "PreviewMesh")
    if component is None:
        return
    mesh_path = MESH_BY_KIND.get(kind)
    mesh = unreal.EditorAssetLibrary.load_asset(mesh_path)
    if mesh is None:
        log(f"Mesh not found, leaving PreviewMesh empty: {mesh_path}")
        return
    component.set_editor_property("static_mesh", mesh)
    if kind == "tree":
        component.set_editor_property("relative_scale3d", unreal.Vector(1.0, 1.0, 1.5))


def setup_blueprint(kind, asset_path):
    package_path, asset_name, package_asset = normalize_asset_path(asset_path)
    blueprint, created = create_actor_blueprint(package_path, asset_name)
    if blueprint is None:
        fail(f"Could not load created Blueprint asset: {package_asset}")

    if kind in SPLINE_KINDS:
        configure_spline_blueprint(blueprint)
    elif kind in MESH_KINDS:
        configure_mesh_blueprint(blueprint, kind)
    else:
        fail(f"Unknown BP kind: {kind}")

    unreal.KismetEditorUtilities.compile_blueprint(blueprint)
    unreal.EditorAssetLibrary.save_loaded_asset(blueprint)
    log(f"Ready: {KIND_LABELS.get(kind, kind)} -> {package_asset}")
    return created


def main():
    created_count = 0
    for kind, asset_path in BP_PATHS.items():
        if kind not in SPLINE_KINDS and kind not in MESH_KINDS:
            continue
        created = setup_blueprint(kind, asset_path)
        created_count += int(bool(created))
    log(f"Done. Created {created_count} new Blueprint asset(s).")


main()
`;
}

function encodeTransitLine(line) {
  return `${line.route}:${line.ref}`;
}

function transitLineLabel(line) {
  return `${TRANSIT_ROUTE_MODES[line.route]?.label || line.route} ${line.ref}`;
}

function extractTransitRefsFromText(value) {
  const refs = new Set();
  const text = String(value || "").toUpperCase();
  for (const match of text.matchAll(/\b(?:U\s*)?([A-Z]?\d{1,3}[A-Z]?)\b/g)) refs.add(match[0].replace(/\s+/g, ""));
  return refs;
}

function areaFeatureTransitLines(feature) {
  const tags = feature.tags || {};
  const route = Object.entries(TRANSIT_ROUTE_MODES).find(([, config]) => config.category === feature?.category)?.[0];
  if (!route) return [];
  for (const key of ["ref", "route_ref", "line", "lines", "name", "description"]) {
    const refs = [...extractTransitRefsFromText(tags[key])];
    if (refs.length) return refs.map((ref) => ({ route, ref }));
  }
  return [];
}

function overpassTransitRouteLines(data) {
  const lines = new Map();
  for (const element of data?.elements || []) {
    const tags = element.tags || {};
    if (element.type !== "relation" || tags.type !== "route" || !TRANSIT_ROUTE_MODES[tags.route]) continue;
    for (const key of ["ref", "route_ref", "line", "lines", "name"]) {
      for (const ref of extractTransitRefsFromText(tags[key])) {
        const line = { route: tags.route, ref };
        lines.set(encodeTransitLine(line), line);
      }
    }
  }
  return [...lines.values()].sort((a, b) => transitLineLabel(a).localeCompare(transitLineLabel(b), "de"));
}

function getAreaTransitLines() {
  const lines = new Map();
  for (const line of detectedAreaTransitLines) lines.set(encodeTransitLine(line), line);
  for (const feature of areaFeatures) {
    for (const line of areaFeatureTransitLines(feature)) lines.set(encodeTransitLine(line), line);
  }
  return [...lines.values()].sort((a, b) => transitLineLabel(a).localeCompare(transitLineLabel(b), "de"));
}

function updateDatatableAreaLineSelection() {
  datatableAreaLines = getAreaTransitLines();
  const lineList = document.getElementById("datatable-line-list");
  const allCheckbox = document.getElementById("datatable-line-all");
  if (!lineList) return;

  const previousInputs = [...lineList.querySelectorAll("input[data-datatable-line]")];
  const hadPreviousOptions = previousInputs.length > 0;
  const previousChecked = new Set(previousInputs.filter((input) => input.checked).map((input) => input.value));
  const previousAllChecked = allCheckbox?.checked ?? true;
  lineList.textContent = "";

  if (!datatableAreaLines.length) {
    if (allCheckbox) {
      allCheckbox.checked = false;
      allCheckbox.disabled = true;
    }
    const empty = document.createElement("span");
    empty.className = "datatable-line-empty";
    empty.textContent = areaFeatures.length ? "keine ÖPNV-Linie im Bereich" : "erst Bereich laden";
    lineList.appendChild(empty);
    return;
  }

  if (allCheckbox) allCheckbox.disabled = false;
  const shouldSelectAll = !hadPreviousOptions || previousAllChecked;

  for (const line of datatableAreaLines) {
    const encoded = encodeTransitLine(line);
    const label = document.createElement("label");
    label.className = "toggle";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = encoded;
    checkbox.dataset.datatableLine = encoded;
    checkbox.checked = shouldSelectAll || previousChecked.has(encoded);
    checkbox.addEventListener("change", syncDatatableLineAllCheckbox);

    label.appendChild(checkbox);
    label.append(transitLineLabel(line));
    lineList.appendChild(label);
  }

  syncDatatableLineAllCheckbox();
}

function getSelectedDatatableLines(availableLines) {
  const selected = new Set(
    [...document.querySelectorAll("#datatable-line-list input[data-datatable-line]:checked")]
      .map((input) => input.value),
  );
  return availableLines.filter((line) => selected.has(encodeTransitLine(line)));
}

function syncDatatableLineAllCheckbox() {
  const allCheckbox = document.getElementById("datatable-line-all");
  if (!allCheckbox) return;
  const inputs = [...document.querySelectorAll("#datatable-line-list input[data-datatable-line]")];
  allCheckbox.checked = inputs.length > 0 && inputs.every((input) => input.checked);
  allCheckbox.indeterminate = inputs.some((input) => input.checked) && !allCheckbox.checked;
}

function clipRouteSegmentToBounds(a, b, bounds) {
  const lat0 = a.lat;
  const lon0 = a.lon;
  const lat1 = b.lat;
  const lon1 = b.lon;
  const dLat = lat1 - lat0;
  const dLon = lon1 - lon0;
  let t0 = 0;
  let t1 = 1;

  function clip(p, q) {
    if (Math.abs(p) < 1e-12) return q >= 0;
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  }

  if (!clip(-dLon, lon0 - bounds.getWest())) return null;
  if (!clip(dLon, bounds.getEast() - lon0)) return null;
  if (!clip(-dLat, lat0 - bounds.getSouth())) return null;
  if (!clip(dLat, bounds.getNorth() - lat0)) return null;
  if (t1 < t0) return null;

  const fromM = a.dist + (b.dist - a.dist) * t0;
  const toM = a.dist + (b.dist - a.dist) * t1;
  return toM > fromM ? { fromM, toM } : null;
}

function buildAreaRouteSegments(uePayload, bounds = areaSelectionBounds) {
  if (!bounds?.isValid?.()) return [];
  const routePoints = (uePayload?.route?.points || [])
    .map((point) => {
      const [lat, lon] = point.wgs84 || [];
      const dist = Number(point.dist_m);
      return Number.isFinite(lat) && Number.isFinite(lon) && Number.isFinite(dist)
        ? { lat, lon, dist }
        : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.dist - b.dist);
  if (routePoints.length < 2) return [];

  const intervals = [];
  for (let index = 0; index < routePoints.length - 1; index += 1) {
    const interval = clipRouteSegmentToBounds(routePoints[index], routePoints[index + 1], bounds);
    if (!interval) continue;
    const previous = intervals.at(-1);
    if (previous && interval.fromM <= previous.toM + 2) {
      previous.toM = Math.max(previous.toM, interval.toM);
    } else {
      intervals.push(interval);
    }
  }

  return intervals
    .filter((interval) => interval.toM - interval.fromM > 1)
    .map((interval, index, all) => ({
      fromM: interval.fromM,
      toM: interval.toM,
      bounds,
      suffix: all.length > 1 ? `_area_${String(index + 1).padStart(2, "0")}` : "_area",
    }));
}

function stationInBounds(station, bounds) {
  if (!bounds?.isValid?.()) return false;
  const [lat, lon] = station.stop_wgs84 || station.wgs84 || [];
  return Number.isFinite(lat) && Number.isFinite(lon) && bounds.contains(L.latLng(lat, lon));
}

function buildDatatablePayloads(uePayload, segmentRange = null, line = null) {
  const allStations = [...(uePayload?.stations || [])].sort((a, b) => a.dist_m - b.dist_m);
  if (!allStations.length) throw new Error(`${uePayload?.ref || "Linie"} hat keine Stationsdaten.`);

  const routeLength = Number(uePayload?.route?.total_length_m || 0);
  const segmentStartM = segmentRange
    ? Math.max(0, Number(segmentRange.fromM))
    : Math.max(0, Number(allStations[0].platform_start_m ?? allStations[0].dist_m));
  const segmentEndM = segmentRange
    ? Math.min(routeLength || Number(segmentRange.toM), Number(segmentRange.toM))
    : Math.min(
      routeLength || Number(allStations[allStations.length - 1].platform_end_m ?? allStations[allStations.length - 1].dist_m),
      Number(allStations[allStations.length - 1].platform_end_m ?? allStations[allStations.length - 1].dist_m),
  );
  if (!Number.isFinite(segmentStartM) || !Number.isFinite(segmentEndM) || segmentEndM <= segmentStartM) {
    throw new Error(`${uePayload.ref} hat keinen gueltigen Bereich im markierten Rechteck.`);
  }

  const selectedStations = allStations.filter((station) => {
    const start = Number(station.platform_start_m ?? station.dist_m);
    const end = Number(station.platform_end_m ?? station.dist_m);
    const stationDist = Number(station.dist_m);
    const overlapsSegment = end >= segmentStartM && start <= segmentEndM;
    const distanceInSegment = stationDist >= segmentStartM && stationDist <= segmentEndM;
    const stopInSelection = segmentRange?.bounds && stationInBounds(station, segmentRange.bounds);
    return overlapsSegment || distanceInSegment || stopInSelection;
  });

  const lineName = line ? transitLineLabel(line) : (uePayload?.ref || "");
  const stations = selectedStations.map((station) => ({
    Key: stationExportKey(station.name),
    Name: station.name,
    Linien: lineName ? [lineName] : [],
    DistanceAtSpline: datatableNumber(station.dist_m - segmentStartM),
  }));
  if (!stations.length) {
    throw new Error(`${uePayload.ref} hat keine Haltestellen im exportierten Bereich.`);
  }

  const stationByName = new Map(selectedStations.map((station) => [station.name, station]));

  const sections = [];
  let tunnelIndex = 1;
  for (const section of uePayload.sections || []) {
    const fromM = Math.max(Number(section.from_m), segmentStartM);
    const toM = Math.min(Number(section.to_m), segmentEndM);
    if (!Number.isFinite(fromM) || !Number.isFinite(toM) || toM <= fromM) continue;

    if (section.type === "platform") {
      const sectionStation = stationByName.get(section.station);
      const stationKey = stationExportKey(section.station);
      sections.push({
        Name: `platform_${stationKey}`,
        UB_SectionType: "platform",
        UB_StationKey: stationKey,
        UB_FromM: datatableNumber(fromM - segmentStartM),
        UB_ToM: datatableNumber(toM - segmentStartM),
        UB_CenterM: datatableNumber(Number(section.center_m || 0) - segmentStartM),
        UB_Level: sectionStation?.level ?? null,
        UB_HeightM: datatableNumber(section.center_height_m ?? sectionStation?.height_m ?? 0),
        UB_FromHeightM: datatableNumber(section.from_height_m ?? section.center_height_m ?? sectionStation?.height_m ?? 0),
        UB_ToHeightM: datatableNumber(section.to_height_m ?? section.center_height_m ?? sectionStation?.height_m ?? 0),
        UB_HeightSource: sectionStation?.height_source || "",
      });
      continue;
    }

    sections.push({
      Name: `tunnel_${String(tunnelIndex++).padStart(3, "0")}`,
      UB_SectionType: "tunnel",
      UB_StationKey: "",
      UB_FromM: datatableNumber(fromM - segmentStartM),
      UB_ToM: datatableNumber(toM - segmentStartM),
      UB_CenterM: 0,
      UB_Level: null,
      UB_HeightM: datatableNumber(section.center_height_m || 0),
      UB_FromHeightM: datatableNumber(section.from_height_m || 0),
      UB_ToHeightM: datatableNumber(section.to_height_m || 0),
      UB_HeightSource: "",
    });
  }

  const suffix = segmentRange?.suffix || "";
  return { stations, sections, suffix };
}

async function ensureLineLoadedForDatatableExport(line) {
  const { ref, route } = line;
  if (lastLoadData?.ref === ref && lastLoadData?.routeMode === route && masterStations?.length) return;
  if (route === "subway" && loadCachedMasterForRef(ref)) return;
  if (uploadedJsonData || loadCachedOverpassDataset()) {
    loadLine(ref, route);
    if (lastLoadData?.ref === ref && lastLoadData?.routeMode === route && masterStations?.length) return;
  }
  const imported = await importFromOverpass(ref, route);
  if (!imported || lastLoadData?.ref !== ref || lastLoadData?.routeMode !== route || !masterStations?.length) {
    throw new Error(`${transitLineLabel(line)} konnte nicht fuer den Datatable-Export geladen werden.`);
  }
}

async function exportDatatableZip() {
  const availableLines = datatableAreaLines.length ? datatableAreaLines : getAreaTransitLines();
  if (!availableLines.length) {
    setStatus("Erst einen Bereich mit ÖPNV-Linien laden.", true);
    return;
  }

  const checked = getSelectedDatatableLines(availableLines);
  if (!checked.length) {
    setStatus("Mindestens eine Linie aus dem geladenen Bereich anhaken.", true);
    return;
  }

  const zip = new JSZip();

  try {
    setStatus(`Erzeuge Datatable-ZIP fuer Bereichslinien ${checked.map(transitLineLabel).join(", ")} ...`);
    for (const line of checked) {
      const { ref } = line;
      await ensureLineLoadedForDatatableExport(line);
      const uePayload = exportToUnreal(true);
      if (!uePayload) throw new Error(`${transitLineLabel(line)} hat keinen UE-Payload.`);
      const areaSegments = buildAreaRouteSegments(uePayload);
      if (!areaSegments.length) throw new Error(`${transitLineLabel(line)} verlaeuft nicht durch den aktuell markierten Bereich.`);
      for (const areaSegment of areaSegments) {
        const { stations, sections, suffix } = buildDatatablePayloads(uePayload, areaSegment, line);
        const folderName = `${line.route}_${ref}${suffix}`;
        const folder = zip.folder(folderName);
        folder.file(`${line.route}_${ref}${suffix}_stations.json`, JSON.stringify(stations, null, "\t"));
        folder.file(`${line.route}_${ref}${suffix}_sections.json`, JSON.stringify(sections, null, "\t"));
      }
    }

    const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
    const suffix = checked.length === 1 ? encodeTransitLine(checked[0]).replace(":", "_") : "selection";
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `transit-datatables-${suffix}.zip`;
    a.click();
    URL.revokeObjectURL(a.href);
    setStatus(`Datatable-ZIP exportiert: ${checked.length} Linie(n), je stations + sections.`);
  } catch (error) {
    setStatus(`Datatable-Export fehlgeschlagen: ${error.message}`, true);
  }
}

function showPythonCodeModal(code) {
  latestAreaPythonScript = code;
  const modal = document.getElementById("python-code-modal");
  const output = document.getElementById("python-code-output");
  if (!modal || !output) {
    downloadTextFile("ue_import_city_street_splines_embedded.py", code, "text/x-python");
    return;
  }
  output.value = code;
  modal.hidden = false;
  output.focus();
  output.select();
}

function closePythonCodeModal() {
  const modal = document.getElementById("python-code-modal");
  if (modal) modal.hidden = true;
}

function openOptionsModal() {
  const modal = document.getElementById("options-modal");
  if (modal) modal.hidden = false;
}

function closeOptionsModal() {
  const modal = document.getElementById("options-modal");
  if (modal) modal.hidden = true;
}

async function copyPythonCodeFromModal() {
  const output = document.getElementById("python-code-output");
  const code = output?.value || latestAreaPythonScript;
  if (!code) return;
  try {
    await navigator.clipboard.writeText(code);
    setStatus("UE-Python-Code kopiert.");
  } catch {
    output?.focus();
    output?.select();
    document.execCommand("copy");
    setStatus("UE-Python-Code kopiert.");
  }
}

function exportAreaUnrealPython() {
  try {
    const payload = buildAreaPythonExportPayload();
    if (!payload) {
      setStatus("Keine sichtbaren Bereichsdaten fuer Unreal-Python-Export vorhanden.", true);
      return;
    }
    const bpPaths = getAreaBpPathsForExport();
    for (const [kind, path] of Object.entries(bpPaths)) setStoredAreaBpPath(kind, path);
    const code = buildCompactAreaUnrealPythonScript(payload, bpPaths);
    showPythonCodeModal(code);
    const pointCount = payload.splines.reduce((sum, spline) => sum + spline.Points.length, 0);
    setStatus(`UE-Python-Code: ${payload.splines.length} Splines / ${pointCount} Punkte / ${payload.buildings.length} Gebaeude / ${payload.trees.length} Baeume eingebettet`);
  } catch (error) {
    setStatus(`UE-Python-Export fehlgeschlagen: ${error.message}`, true);
  }
}

function showBlueprintSetupPython() {
  try {
    const bpPaths = getAreaBpPathsForExport();
    for (const [kind, path] of Object.entries(bpPaths)) setStoredAreaBpPath(kind, path);
    const code = buildBlueprintSetupPythonScript(bpPaths);
    showPythonCodeModal(code);
    setStatus("BP-Python-Code erzeugt.");
  } catch (error) {
    setStatus(`BP-Python-Code fehlgeschlagen: ${error.message}`, true);
  }
}

function applyEditsFromParsed(parsed) {
  // v4: Master + eingebetteter UE-Importblock
  if (parsed?.v === 4) {
    if (!Array.isArray(parsed.controlPoints) || !Array.isArray(parsed.masterStations)) {
      setStatus("Ungültige Master-Datei (v4): controlPoints und masterStations erforderlich.", true);
      return;
    }
    customControlPoints = parsed.controlPoints;
    masterStations = parsed.masterStations;
    lastRelation = null;
    const ref = parsed.ref || "?";
    lastLoadData = { data: null, ref };
    if (select) select.value = ref;
    const rawTrack = catmullRomSpline(customControlPoints);
    _renderFromMasterStations(rawTrack, ref, true);
    return;
  }

  // v3: vollständige Master-Datei (standalone, kein Overpass nötig)
  if (parsed?.v === 3) {
    if (!Array.isArray(parsed.controlPoints) || !Array.isArray(parsed.stations)) {
      setStatus("Ungültige Master-Datei (v3): controlPoints und stations erforderlich.", true);
      return;
    }
    customControlPoints = parsed.controlPoints;
    masterStations = parsed.stations;
    lastRelation = null;
    const ref = parsed.ref || "?";
    lastLoadData = { data: null, ref };
    if (select) select.value = ref;
    const rawTrack = catmullRomSpline(customControlPoints);
    _renderFromMasterStations(rawTrack, ref, true);
    return;
  }

  // v2: controlPoints + editState-Format (Altformat, Overpass noch nötig)
  if (parsed?.v === 2) {
    if (!Array.isArray(parsed.controlPoints)) {
      setStatus("Ungültige Master-Datei (v2).", true);
      return;
    }
    customControlPoints = parsed.controlPoints;
    // Alte edits als Overrides auf masterStations anwenden
    if (parsed.edits && masterStations) {
      for (const [name, edit] of Object.entries(parsed.edits)) {
        const ms = masterStations.find((s) => s.name === name);
        if (ms) {
          if (edit.lat != null) ms.lat = edit.lat;
          if (edit.lon != null) ms.lon = edit.lon;
          if (edit.halfLengthM != null) ms.halfLengthM = edit.halfLengthM;
          if (edit.halfWidthM != null) ms.halfWidthM = edit.halfWidthM;
        }
      }
    }
    const ref = parsed.ref || lastLoadData?.ref;
    if (ref && select) select.value = ref;
    const data = lastLoadData?.data || uploadedJsonData;
    if (data && ref) {
      loadFromUploadedData(data, ref);
    } else {
      setStatus("Master (v2) geladen – Overpass-JSON für Stationsdaten erforderlich.", false);
    }
    return;
  }

  // v1: nur Stationsedits (Altformat)
  if (parsed?.v !== 1 || typeof parsed?.edits !== "object") {
    setStatus("Ungültige Datei (kein bekanntes Format).", true);
    return;
  }
  if (masterStations) {
    for (const [name, edit] of Object.entries(parsed.edits)) {
      const ms = masterStations.find((s) => s.name === name);
      if (ms) {
        if (edit.lat != null) ms.lat = edit.lat;
        if (edit.lon != null) ms.lon = edit.lon;
        if (edit.halfLengthM != null) ms.halfLengthM = edit.halfLengthM;
        if (edit.halfWidthM != null) ms.halfWidthM = edit.halfWidthM;
      }
    }
  }
  const ref = parsed.ref || lastLoadData?.ref;
  if (ref && select) select.value = ref;
  const data = lastLoadData?.data || uploadedJsonData;
  if (data && ref) loadFromUploadedData(data, ref);
}

function renderEditMarkers(stations) {
  editLayer.clearLayers();
  for (const s of stations) {
    const icon = L.divIcon({
      html: '<div class="edit-handle"></div>',
      iconSize: [24, 24],
      iconAnchor: [12, 12],
      className: "",
    });
    const marker = L.marker([s.lat, s.lon], { icon, draggable: true, zIndexOffset: 4000 });

    marker.on("dragend", () => {
      const { lat, lng } = marker.getLatLng();
      const ms = masterStations?.find((m) => m.name === s.name);
      if (ms) {
        ms.lat = lat;
        ms.lon = lng;
        if (selectedStation?.name === ms.name) selectedStation = ms;
      }
      rebuildAndDraw();
    });

    marker.on("click", () => showEditPanel(masterStations?.find((m) => m.name === s.name) || s));
    marker.addTo(editLayer);
  }
}

function showEditPanel(station) {
  selectedStation = station;
  const panel = document.getElementById("edit-panel");
  if (!panel) return;
  const ms = masterStations?.find((m) => m.name === station.name) || station;
  document.getElementById("edit-name").textContent = station.name;
  document.getElementById("edit-len").value = Math.round(ms.halfLengthM * 2);
  document.getElementById("edit-wid").value = (ms.halfWidthM * 2).toFixed(1);
  panel.hidden = false;
}

function toggleEditMode() {
  editModeActive = !editModeActive;
  const btn = document.getElementById("btn-edit");
  if (btn) btn.classList.toggle("active", editModeActive);
  const panel = document.getElementById("edit-panel");
  if (!editModeActive) {
    editLayer.clearLayers();
    if (panel) panel.hidden = true;
    selectedStation = null;
  }
  rebuildAndDraw();
}

function loadFromUploadedData(data, ref, routeMode = currentRouteMode || "subway") {
  currentRouteMode = routeMode;
  const isNewLoad = !lastLoadData || lastLoadData.ref !== ref || lastLoadData.routeMode !== routeMode || lastLoadData.data !== data;

  // Linienwechsel → masterStations neu aus Overpass berechnen
  if (lastLoadData && (lastLoadData.ref !== ref || lastLoadData.routeMode !== routeMode)) {
    masterStations = null;
    lastRelation = null;
  }

  lastLoadData = { data, ref, routeMode };

  // ── Track ermitteln ───────────────────────────────────────────────────────
  let rawTrack;
  if (customControlPoints && customControlPoints.length >= 2) {
    rawTrack = catmullRomSpline(customControlPoints);
  } else if (data) {
    const relations = getRouteRelationsForRef(data, ref, currentRouteMode);
    if (!relations.length) {
      // Wenn JSON die Linie nicht enthält, aber Master-Cache existiert: daraus laden.
      if (currentRouteMode === "subway" && loadCachedMasterForRef(ref)) {
        setStatus(`Linie ${ref} aus Master-Cache geladen (JSON ohne Relation).`);
        return;
      }
      setStatus(`Keine ${TRANSIT_ROUTE_MODES[currentRouteMode]?.label || currentRouteMode}-Relation fuer ${ref} in der JSON.`, true);
      clearRoute();
      return;
    }
    rawTrack = buildCenterTrack(relations, data.elements || []);
    if (rawTrack && rawTrack.length >= 2) lastComputedCenterline = rawTrack;
  } else if (lastComputedCenterline) {
    rawTrack = lastComputedCenterline;
  }

  if (!rawTrack || rawTrack.length < 2) {
    setStatus(`Keine Track-Geometrie für ${ref}.`, true);
    clearRoute();
    return;
  }

  // ── Stationsdaten: masterStations hat Vorrang, sonst aus Overpass ─────────
  if (!masterStations) {
    if (!data) {
      setStatus("Keine Stationsdaten und keine Overpass-JSON.", true);
      return;
    }
    const relations = getRouteRelationsForRef(data, ref, currentRouteMode);
    const relation = pickRelationWithMostStops(relations, data.elements || [], currentRouteMode);
    if (!relation) {
      setStatus("Keine passende Relation.", true);
      clearRoute();
      return;
    }
    lastRelation = relation;

    const relB = relations.find((r) => r !== relation);
    const stopNodes = relB
      ? mergeStopsFromBothRelations(relation, relB, data.elements || [], currentRouteMode)
      : extractStopNodes(relation, data.elements || [], currentRouteMode);
    if (!stopNodes.length) {
      setStatus(`Keine Stop-Nodes für ${ref} gefunden.`, true);
      clearRoute();
      return;
    }

    const platformIndex = buildPlatformIndex(relations, data.elements || []);
    const missingPlatforms = [];

    masterStations = stopNodes.map((s) => {
      const proj = projectOntoTrack([s.lat, s.lon], rawTrack);
      const platformWay = platformIndex.get(s.name);
      const dims = measurePlatformDimensions(platformWay, proj.point, proj.tangent);
      const height = stationHeightFromTags(platformWay?.tags, s.tags);
      if (!dims) missingPlatforms.push(s.name);
      const halfLengthM = dims?.halfLengthM ?? DEFAULT_HALF_LENGTH_M;
      const halfWidthM = dims?.halfWidthM ?? DEFAULT_HALF_WIDTH_M;
      return {
        name: s.name,
        lat: s.lat,
        lon: s.lon,
        halfLengthM,
        halfWidthM,
        level: height.level,
        heightM: height.heightM,
        heightSource: height.source,
        // Original-OSM-Werte für Zurücksetzen
        _osmLat: s.lat,
        _osmLon: s.lon,
        _osmHalfLengthM: halfLengthM,
        _osmHalfWidthM: halfWidthM,
        _osmLevel: height.level,
        _osmHeightM: height.heightM,
        _osmHeightSource: height.source,
      };
    });

    if (missingPlatforms.length) {
      console.warn("Fehlende Plattformmaße:", missingPlatforms.join(", "));
    }
  }

  _renderFromMasterStations(rawTrack, ref, isNewLoad);
}

function loadLine(ref, routeMode = currentRouteMode || "subway") {
  currentRouteMode = routeMode;
  setStatus("Lade …");
  setDirectionText("");

  // Falls bereits passender Master-State im Speicher ist
  if (masterStations && lastLoadData?.ref === ref && lastLoadData?.routeMode === routeMode) {
    lastLoadData = { data: null, ref, routeMode };
    rebuildAndDraw();
    return;
  }

  // Cache-first: eigener Master-State (inkl. Edits)
  if (routeMode === "subway" && loadCachedMasterForRef(ref)) {
    setStatus(`Linie ${ref} aus Cache geladen.`);
    return;
  }

  if (uploadedJsonData) {
    loadFromUploadedData(uploadedJsonData, ref, routeMode);
    return;
  }

  // Fallback: zuletzt gecachte Overpass-Antwort
  const cachedOverpass = loadCachedOverpassDataset();
  if (cachedOverpass) {
    uploadedJsonData = cachedOverpass;
    loadFromUploadedData(uploadedJsonData, ref, routeMode);
    return;
  }

  setStatus("⇣ Overpass oder 📂 Master laden.");
  clearRoute();
  setDirectionText("");
  return;
}

function overpassBbox(bounds) {
  if (!bounds?.isValid?.()) return null;
  return [
    bounds.getSouth().toFixed(7),
    bounds.getWest().toFixed(7),
    bounds.getNorth().toFixed(7),
    bounds.getEast().toFixed(7),
  ].join(",");
}

function buildOverpassQuery(ref, routeMode = "subway", bounds = null) {
  const bbox = overpassBbox(bounds);
  if (bbox) {
    return `[out:json][timeout:360];
(
  relation["type"="route"]["route"="${routeMode}"]["ref"="${ref}"](${bbox});
);
out body;
>;
out geom;`;
  }

  return `[out:json][timeout:360];
area["name"="Berlin"]["boundary"="administrative"]->.searchArea;
(
  relation["type"="route"]["route"="${routeMode}"]["ref"="${ref}"](area.searchArea);
);
out body;
>;
out geom;`;
}

async function importFromOverpass(ref, routeMode = "subway", bounds = areaSelectionBounds) {
  try {
    const modeLabel = TRANSIT_ROUTE_MODES[routeMode]?.label || routeMode;
    const scopedToArea = bounds?.isValid?.();
    setStatus(`Lade ${modeLabel} ${ref} ${scopedToArea ? "aus dem Bereich" : "direkt"} von Overpass …`);
    setDirectionText("");

    const response = await fetch(OVERPASS_API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: buildOverpassQuery(ref, routeMode, scopedToArea ? bounds : null),
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const data = await response.json();
    if (!data || typeof data !== "object" || !Array.isArray(data.elements)) {
      throw new Error("Antwort ohne elements");
    }

    cacheOverpassDataset(data);
    uploadedJsonData = data;
    currentSourceFile = null;
    currentSourceKind = null;
    customControlPoints = null;
    lastComputedCenterline = null;
    masterStations = null;
    lastRelation = null;
    loadLine(ref, routeMode);
    return lastLoadData?.ref === ref && lastLoadData?.routeMode === routeMode && Boolean(masterStations?.length);
  } catch (error) {
    setStatus(`Overpass-Direktimport fehlgeschlagen: ${error.message}`, true);
    return false;
  }
}

// ─── UI ───────────────────────────────────────────────────────────────────────

async function importAreaFromOverpass(bounds = areaSelectionBounds) {
  if (!bounds?.isValid?.()) {
    setStatus("Erst einen Bereich auf der Karte ziehen.", true);
    return false;
  }

  try {
    const selectedCategories = getSelectedAreaCategories();
    if (!selectedCategories.length) {
      setStatus("Mindestens einen Bereichs-Layer anhaken.", true);
      return false;
    }
    const areaKm2 = areaBoundsSizeKm2(bounds);
    if (areaKm2 > AREA_MAX_REQUEST_KM2) {
      setStatus(`Bereich zu gross (${areaKm2.toFixed(1)} km²). Bitte kleiner als ${AREA_MAX_REQUEST_KM2} km² ziehen.`, true);
      return false;
    }
    const expensiveLayers = selectedCategories.filter((category) => AREA_EXPENSIVE_LAYERS.has(category));
    if (areaKm2 > AREA_LARGE_REQUEST_KM2 && expensiveLayers.length) {
      const expensiveLabels = expensiveLayers.map((category) => AREA_LAYER_LABELS[category]).join(", ");
      setStatus(
        `Bereich ${areaKm2.toFixed(1)} km² ist fuer ${expensiveLabels} zu gross. Diese Layer abwaehlen oder kleiner als ${AREA_LARGE_REQUEST_KM2} km² ziehen.`,
        true,
      );
      return false;
    }
    const cacheKey = areaBoundsCacheKey(bounds, selectedCategories);
    if (areaCache?.key === cacheKey && Array.isArray(areaCache.features)) {
      areaFeatures = areaCache.features;
      detectedAreaTransitLines = areaCache.transitLines || [];
      if (areaFeatures.length) renderAreaFeatures();
      else renderAreaTransitLinesOnlyStatus();
      return true;
    }

    const layerLabels = selectedCategories.map((category) => AREA_LAYER_LABELS[category]).join(", ");
    setStatus(`Lade Bereichsdaten von Overpass (${areaKm2.toFixed(2)} km², ${layerLabels}) ...`);
    const response = await fetch(OVERPASS_API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: buildAreaOverpassQuery(bounds, selectedCategories),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();
    if (!data || typeof data !== "object" || !Array.isArray(data.elements)) {
      throw new Error("Antwort ohne elements");
    }

    detectedAreaTransitLines = overpassTransitRouteLines(data);
    areaFeatures = buildAreaFeatures(data, bounds);
    areaCache = { key: cacheKey, bounds, features: areaFeatures, transitLines: detectedAreaTransitLines };
    if (!areaFeatures.length && !detectedAreaTransitLines.length) {
      areaRawLayer.clearLayers();
      areaProcessedLayer.clearLayers();
      updateDatatableAreaLineSelection();
      setStatus("Keine passenden OSM-Daten oder ÖPNV-Linien im Bereich gefunden.", true);
      return false;
    }
    if (areaFeatures.length) renderAreaFeatures();
    else renderAreaTransitLinesOnlyStatus();
    return true;
  } catch (error) {
    setStatus(`Bereichsimport fehlgeschlagen: ${error.message}`, true);
    return false;
  }
}

async function importLineAndAreaFromOverpass(ref) {
  const lineLoaded = await importFromOverpass(ref);
  if (!lineLoaded) return;
  const bounds = areaSelectionBounds?.isValid?.() ? areaSelectionBounds : map.getBounds();
  await importAreaFromOverpass(bounds);
}

async function importCurrentOverpassSelection(ref) {
  if (areaSelectionBounds?.isValid?.()) {
    await importAreaFromOverpass(areaSelectionBounds);
    map.fitBounds(areaSelectionBounds, { padding: [48, 48], maxZoom: 14 });
    return;
  }
  await importLineAndAreaFromOverpass(ref);
}

function boundsFromNominatimResult(result) {
  if (!Array.isArray(result?.boundingbox) || result.boundingbox.length !== 4) return null;
  const south = Number(result.boundingbox[0]);
  const north = Number(result.boundingbox[1]);
  const west = Number(result.boundingbox[2]);
  const east = Number(result.boundingbox[3]);
  if (![south, north, west, east].every(Number.isFinite)) return null;
  return L.latLngBounds([south, west], [north, east]);
}

async function findPostalCodeBounds(postalCode) {
  const normalized = String(postalCode || "").trim();
  if (!/^\d{4,6}$/.test(normalized)) {
    throw new Error("PLZ muss 4 bis 6 Ziffern haben.");
  }

  const cacheKey = `${POSTAL_CODE_CACHE_KEY_PREFIX}${normalized}`;
  const cached = _storageGet(cacheKey);
  const cachedBounds = boundsFromNominatimResult(cached?.result);
  if (cachedBounds?.isValid?.()) return { bounds: cachedBounds, label: cached.result.display_name };

  const url = new URL(NOMINATIM_API_URL);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("countrycodes", "de");
  url.searchParams.set("postalcode", normalized);
  url.searchParams.set("limit", "1");
  url.searchParams.set("addressdetails", "1");

  const response = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Nominatim HTTP ${response.status}`);

  const results = await response.json();
  if (!Array.isArray(results) || !results.length) {
    throw new Error(`Keine Ortsdaten fuer PLZ ${normalized} gefunden.`);
  }

  const result = results[0];
  const bounds = boundsFromNominatimResult(result);
  if (!bounds?.isValid?.()) {
    throw new Error(`PLZ ${normalized} hat keine gueltige Bounding Box.`);
  }
  _storageSet(cacheKey, { v: 1, ts: Date.now(), result });
  return { bounds, label: result.display_name };
}

async function selectPostalCodeArea() {
  const input = document.getElementById("postal-code-input");
  const postalCode = input?.value || "";
  try {
    setStatus("Suche PLZ ...");
    const { bounds, label } = await findPostalCodeBounds(postalCode);
    setAreaSelectionBounds(bounds);
    map.fitBounds(bounds, { padding: [48, 48], maxZoom: 14 });
    setStatus(`PLZ-Bereich gewaehlt: ${label}`);
  } catch (error) {
    setStatus(`PLZ-Suche fehlgeschlagen: ${error.message}`, true);
  }
}

const select = document.getElementById("line-select");
if (select) {
  for (const line of LINES) {
    const opt = document.createElement("option");
    opt.value = line;
    opt.textContent = line;
    select.appendChild(opt);
  }
  select.value = "U8";
  select.addEventListener("change", () => loadLine(select.value));
}

const datatableLineList = document.getElementById("datatable-line-list");
if (datatableLineList) {
  updateDatatableAreaLineSelection();
}
document.getElementById("datatable-line-all")?.addEventListener("change", (event) => {
  for (const input of document.querySelectorAll("#datatable-line-list input[data-datatable-line]")) {
    input.checked = event.target.checked;
  }
  syncDatatableLineAllCheckbox();
});
initAreaBpPathInputs();

async function reloadCurrentFile() {
  const sourceFile = currentSourceFile;
  if (!sourceFile) {
    setStatus("Keine geladene Datei zum Neuladen vorhanden.", true);
    return;
  }

  try {
    const text = await sourceFile.text();
    const parsed = JSON.parse(text);

    if (currentSourceKind === "overpass") {
      if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.elements)) {
        setStatus("Overpass-Datei konnte nicht neu geladen werden.", true);
        return;
      }
      cacheOverpassDataset(parsed);
      uploadedJsonData = parsed;
      customControlPoints = null;
      lastComputedCenterline = null;
      masterStations = null;
      lastRelation = null;
      loadLine(select?.value || "U8");
      return;
    }

    applyEditsFromParsed(parsed);
  } catch (error) {
    setStatus(`Reload fehlgeschlagen: ${error.message}`, true);
  }
}

setStatus("Bereich wählen und OSM Bereich laden oder Master laden.");

// ─── Edit-Panel Handler ───────────────────────────────────────────────────────

document.getElementById("btn-edit")?.addEventListener("click", toggleEditMode);
document.getElementById("btn-overpass")?.addEventListener("click", () => importCurrentOverpassSelection(select?.value || "U8"));

document.getElementById("edit-len")?.addEventListener("input", (e) => {
  if (!selectedStation) return;
  const v = parseFloat(e.target.value);
  if (!isFinite(v) || v < 5) return;
  const ms = masterStations?.find((m) => m.name === selectedStation.name);
  if (ms) ms.halfLengthM = v / 2;
  rebuildAndDraw();
});

document.getElementById("edit-wid")?.addEventListener("input", (e) => {
  if (!selectedStation) return;
  const v = parseFloat(e.target.value);
  if (!isFinite(v) || v < 1) return;
  const ms = masterStations?.find((m) => m.name === selectedStation.name);
  if (ms) ms.halfWidthM = v / 2;
  rebuildAndDraw();
});

document.getElementById("edit-reset")?.addEventListener("click", () => {
  if (!selectedStation) return;
  const ms = masterStations?.find((m) => m.name === selectedStation.name);
  if (ms) {
    // Auf OSM-Originalwerte zurücksetzen (falls vorhanden), sonst Defaults
    ms.lat = ms._osmLat ?? ms.lat;
    ms.lon = ms._osmLon ?? ms.lon;
    ms.halfLengthM = ms._osmHalfLengthM ?? DEFAULT_HALF_LENGTH_M;
    ms.halfWidthM = ms._osmHalfWidthM ?? DEFAULT_HALF_WIDTH_M;
    ms.level = ms._osmLevel ?? null;
    ms.heightM = ms._osmHeightM ?? 0;
    ms.heightSource = ms._osmHeightSource ?? "";
  }
  document.getElementById("edit-panel").hidden = true;
  selectedStation = null;
  rebuildAndDraw();
});

document.getElementById("btn-export-master")?.addEventListener("click", exportMaster);
document.getElementById("btn-export-datatables")?.addEventListener("click", exportDatatableZip);
document.getElementById("btn-export-pcg")?.addEventListener("click", exportAreaPcgSplines);
document.getElementById("btn-export-area-python")?.addEventListener("click", exportAreaUnrealPython);
document.getElementById("btn-python-close")?.addEventListener("click", closePythonCodeModal);
document.getElementById("btn-python-copy")?.addEventListener("click", copyPythonCodeFromModal);
document.getElementById("btn-python-download")?.addEventListener("click", () => {
  if (latestAreaPythonScript) {
    downloadTextFile("ue_import_city_street_splines_embedded.py", latestAreaPythonScript, "text/x-python");
  }
});
document.getElementById("python-code-modal")?.addEventListener("click", (event) => {
  if (event.target?.id === "python-code-modal") closePythonCodeModal();
});
document.getElementById("btn-options")?.addEventListener("click", openOptionsModal);
document.getElementById("btn-options-close")?.addEventListener("click", closeOptionsModal);
document.getElementById("btn-generate-bp-python")?.addEventListener("click", showBlueprintSetupPython);
document.getElementById("options-modal")?.addEventListener("click", (event) => {
  if (event.target?.id === "options-modal") closeOptionsModal();
});
document.getElementById("btn-reload")?.addEventListener("click", reloadCurrentFile);
document.getElementById("btn-area-select")?.addEventListener("click", () => {
  setAreaSelectMode(!areaSelectMode);
});
document.getElementById("btn-area-load")?.addEventListener("click", () => importAreaFromOverpass());
document.getElementById("btn-postal-code")?.addEventListener("click", selectPostalCodeArea);
document.getElementById("postal-code-input")?.addEventListener("keydown", (event) => {
  if (event.key === "Enter") selectPostalCodeArea();
});

map.on("mousedown", beginAreaSelection);
map.on("mousemove", updateAreaSelection);
map.on("mouseup", finishAreaSelection);

document.querySelectorAll("[data-area-layer]").forEach((input) => {
  areaLayerVisibility.set(input.dataset.areaLayer, input.checked);
  input.addEventListener("change", () => {
    areaLayerVisibility.set(input.dataset.areaLayer, input.checked);
    if (areaFeatures.length) {
      renderAreaFeatures();
      return;
    }
    const selectedLabels = getSelectedAreaCategories().map((category) => AREA_LAYER_LABELS[category]).join(", ");
    setStatus(selectedLabels ? `Auswahl fuer ersten OSM-Load: ${selectedLabels}` : "Mindestens einen Bereichs-Layer anhaken.", !selectedLabels);
  });
});

document.getElementById("btn-fit")?.addEventListener("click", () => {
  const bounds = areaProcessedLayer.getBounds().isValid()
    ? areaProcessedLayer.getBounds()
    : routeLayer.getBounds();
  if (bounds.isValid()) map.fitBounds(bounds, { padding: [48, 48], maxZoom: 13 });
});

document.getElementById("btn-load-edits")?.addEventListener("click", () => {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json,application/json";
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (!file) return;
    currentEditsFile = file;
    currentSourceFile = file;
    currentSourceKind = "master";
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        applyEditsFromParsed(JSON.parse(e.target.result));
      } catch {
        setStatus("Bearbeitungsdatei konnte nicht gelesen werden.", true);
      }
    };
    reader.readAsText(file);
  });
  input.click();
});
