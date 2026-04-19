/**
 * Berlin U-Bahn
 * - Track: Way-Geometrie (role "") aus der Route-Relation, lückenlos zusammengesetzt
 * - Stationen: Stop-Nodes auf den Track projiziert (kein Offset mehr)
 * - Bahnsteige: Länge und Breite aus den platform-Ways der Overpass-Daten
 */

import JSZip from "jszip";

const LINES = ["U1", "U2", "U3", "U4", "U5", "U6", "U7", "U8", "U9"];

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
let uploadedJsonData = null;

const DEFAULT_HALF_LENGTH_M = 60; // 120m Fallback wenn kein platform-Way vorhanden (halbe Länge)
const DEFAULT_HALF_WIDTH_M = 2.7; // 5.4m Fallback
// Blend zurück auf Originalgleis: min (fast gerade) bis max (starke Kurve).
const TRACK_BLEND_M_MIN = 10;
const TRACK_BLEND_M_MAX = 60;

// masterStations: einzige Quelle der Wahrheit für Stationsdaten
// { name, lat, lon, halfLengthM, halfWidthM, _osmLat?, _osmLon?, _osmHalfLengthM?, _osmHalfWidthM? }
let masterStations = null;
let lastRelation = null; // aktuelle OSM-Relation (für Richtungsanzeige)
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
const OVERPASS_CACHE_KEY = "ubahn.overpass.dataset.v1";
const MASTER_CACHE_KEY_PREFIX = "ubahn.master.v4.";
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
    for (const g of el.geometry) {
      if (g?.lat == null || g?.lon == null) continue;
      lat += g.lat;
      lon += g.lon;
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
    .filter((m) => m.type === "way" && m.role === "")
    .map((m) => {
      // Fall A: geometry direkt im Member (ältere/andere Overpass-Ausgaben)
      if (Array.isArray(m.geometry) && m.geometry.length >= 2) {
        return m.geometry.map((g) => [g.lat, g.lon]);
      }
      // Fall B: geometry liegt im globalen way-Element (out body; >; out geom;)
      const way = elementByWayId.get(m.ref);
      if (way && Array.isArray(way.geometry) && way.geometry.length >= 2) {
        return way.geometry.map((g) => [g.lat, g.lon]);
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

function isStopRole(role) {
  const r = (role || "").toLowerCase();
  return r === "stop" || r === "stop_entry_only" || r === "stop_exit_only";
}

function isPlatformRole(role) {
  const r = (role || "").toLowerCase();
  return r.includes("platform");
}

/**
 * Gibt Stop-Nodes in Reihenfolge der Relation zurück, dedupliziert nach Name.
 * Nur Nodes mit stop-Role werden berücksichtigt (keine platform-Nodes).
 */
function extractStopNodes(relation, elements) {
  const idx = buildIndex(elements);
  const seen = new Set();
  const stops = [];
  for (const member of relation.members || []) {
    if (member.type !== "node" || !isStopRole(member.role)) continue;
    const el = idx.get(`node/${member.ref}`);
    if (!el || el.lat == null || el.lon == null) continue;
    const name = getStationName(el);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    stops.push({ id: el.id, name, lat: el.lat, lon: el.lon });
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
    if (!byNorm.has(norm) && Array.isArray(geometryRaw) && geometryRaw.length >= 2) {
      byNorm.set(norm, {
        id,
        name,
        geometry: geometryRaw.map((g) => [g.lat ?? g[0], g.lon ?? g[1]]),
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
/**
 * Winkel zwischen zwei Tangenten-Vektoren in Grad.
 * Gibt 0 zurück wenn einer der Vektoren null ist.
 */
function tangentAngleDeg(t0, t1) {
  if (!t0 || !t1) return 0;
  const dot = Math.max(-1, Math.min(1, t0.dx * t1.dx + t0.dy * t1.dy));
  return Math.acos(dot) * (180 / Math.PI);
}

/**
 * Adaptiver Blend-Abstand:
 *   kleiner Winkel (fast gerade) → kurzer Blend (TRACK_BLEND_M_MIN)
 *   großer Winkel (starke Kurve) → langer Blend (TRACK_BLEND_M_MAX)
 */
function adaptiveBlendM(angleDeg) {
  const t = Math.max(0, Math.min(1, (angleDeg - 3) / (25 - 3)));
  return TRACK_BLEND_M_MIN + t * (TRACK_BLEND_M_MAX - TRACK_BLEND_M_MIN);
}

/**
 * Gesamte Winkelabweichung (rad) auf einem Track-Abschnitt – misst Kurvigkeit.
 * Niedrigerer Wert = gerader Abschnitt.
 */
function angularDeviation(track, cum, fromDist, toDist, stepM = 3) {
  fromDist = Math.max(0, fromDist);
  toDist   = Math.min(cum[cum.length - 1], toDist);
  let total = 0, prev = null;
  for (let d = fromDist; ; d = Math.min(d + stepM, toDist)) {
    const t = tangentAtDist(track, cum, d);
    if (prev && t) {
      const dot = Math.max(-1, Math.min(1, prev.dx * t.dx + prev.dy * t.dy));
      total += Math.acos(dot);
    }
    prev = t;
    if (d >= toDist) break;
  }
  return total;
}

/**
 * Sucht innerhalb von ±searchRadius um distAlongTrack die Position,
 * bei der ein Fenster der Breite halfLengthM*2 am geradsten ist.
 * Gibt die optimale distAlongTrack zurück.
 */
function findStraightestCenter(track, cum, distAlongTrack, halfLengthM) {
  const totalLen    = cum[cum.length - 1];
  const searchRadiusM = halfLengthM;        // Suchfenster ± halfLength
  const stepM       = 2;
  const lo = Math.max(halfLengthM,              distAlongTrack - searchRadiusM);
  const hi = Math.min(totalLen - halfLengthM,   distAlongTrack + searchRadiusM);
  if (lo >= hi) return Math.max(halfLengthM, Math.min(totalLen - halfLengthM, distAlongTrack));
  let bestDev  = Infinity;
  let bestDist = distAlongTrack;
  for (let d = lo; ; d = Math.min(d + stepM, hi)) {
    const dev = angularDeviation(track, cum, d - halfLengthM, d + halfLengthM);
    if (dev < bestDev) { bestDev = dev; bestDist = d; }
    if (d >= hi) break;
  }
  return bestDist;
}

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
    const { halfLengthM, halfWidthM, distAlongTrack } = station;

    // Station-Position und Tangente direkt von der Mittellinie interpolieren.
    const point   = pointAtDist(rawTrack, cum, distAlongTrack);
    const tangent = tangentAtDist(rawTrack, cum, distAlongTrack);
    if (!tangent) continue;

    // Gerade Section = exakt Bahnsteiglänge
    const segStart = Math.max(cursor, distAlongTrack - halfLengthM);
    const segEnd   = Math.min(totalLen, distAlongTrack + halfLengthM);

    // Endpunkte der geraden Section
    const beforePt = moveMeter(point, tangent, segStart - distAlongTrack);
    const afterPt  = moveMeter(point, tangent, segEnd   - distAlongTrack);

    // Adaptiver Blend: Winkel zwischen natürlicher Gleis-Tangente und Bahnsteig-Tangente
    const rawT_entry  = tangentAtDist(rawTrack, cum, Math.max(0,        segStart));
    const rawT_exit   = tangentAtDist(rawTrack, cum, Math.min(totalLen, segEnd));
    const entryBlendM = adaptiveBlendM(tangentAngleDeg(rawT_entry, tangent));
    const exitBlendM  = adaptiveBlendM(tangentAngleDeg(rawT_exit,  tangent));

    const blendEntry = Math.max(cursor,    segStart - entryBlendM);
    const blendExit  = Math.min(totalLen,  segEnd   + exitBlendM);

    // 1. Geschwungener Track bis Einfahrt-Blend-Beginn
    if (blendEntry > cursor) {
      append(extractSection(rawTrack, cum, cursor, blendEntry));
    }

    // 2. Hermite-Einfahrt: natürliche Gleistangente → Bahnsteig-Tangente
    const entryP0   = pointAtDist(rawTrack, cum, blendEntry);
    const entryT0   = tangentAtDist(rawTrack, cum, blendEntry);
    const entryDist = haversineM(entryP0, beforePt);
    append(hermiteSegment(entryP0, entryT0, beforePt, tangent, entryDist));

    // 3. Gerade Section: Puffer + Bahnsteig + Puffer
    append([beforePt, afterPt]);

    // 4. Hermite-Ausfahrt: Bahnsteig-Tangente → natürliche Gleistangente
    const exitP1   = pointAtDist(rawTrack, cum, blendExit);
    const exitT1   = tangentAtDist(rawTrack, cum, blendExit);
    const exitDist = haversineM(afterPt, exitP1);
    append(hermiteSegment(afterPt, tangent, exitP1, exitT1, exitDist));

    // Bahnsteig-Polygon (nur reale Bahnsteiglänge, kein Puffer)
    platformSegments.push(
      buildPlatformPolygon(point, tangent, -halfLengthM, halfLengthM, halfWidthM),
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

function getSubwayRelationsForRef(data, ref) {
  return (data.elements || []).filter(
    (el) =>
      el.type === "relation" &&
      el.tags?.route === "subway" &&
      el.tags?.ref === ref,
  );
}

/**
 * Für jede Station beide Stop-Koordinaten (eine pro Richtungsrelation) mitteln.
 * Relation A gibt die Reihenfolge vor; B liefert nur den Gegengleispunkt.
 */
function mergeStopsFromBothRelations(relA, relB, elements) {
  const stopsA = extractStopNodes(relA, elements);
  const stopsB = extractStopNodes(relB, elements);
  const bByName = new Map(stopsB.map((s) => [s.name, s]));
  return stopsA.map((s) => {
    const b = bByName.get(s.name);
    if (!b) return s;
    return { ...s, lat: (s.lat + b.lat) / 2, lon: (s.lon + b.lon) / 2 };
  });
}

function pickRelationWithMostStops(relations, elements) {
  let best = null;
  let bestCount = -1;
  for (const rel of relations) {
    const n = extractStopNodes(rel, elements).length;
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
    })),
  };
}

function cacheMasterForRef(ref) {
  if (!ref) return;
  const payload = buildMasterStatePayload(ref);
  if (!payload) return;
  _storageSet(`${MASTER_CACHE_KEY_PREFIX}${ref}`, { v: 1, ts: Date.now(), payload });
}

function scheduleCachePersist(ref) {
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
  if (
    !payload ||
    payload.v !== 4 ||
    !Array.isArray(payload.controlPoints) ||
    payload.controlPoints.length < 2 ||
    !Array.isArray(payload.masterStations) ||
    payload.masterStations.length === 0
  ) {
    return false;
  }
  applyEditsFromParsed(payload);
  return true;
}

function tryLoadRouteFromCache(ref) {
  if (loadCachedMasterForRef(ref)) {
    setStatus(`Linie ${ref} aus Cache geladen.`);
    return true;
  }

  if (uploadedJsonData && lastLoadData?.ref === ref) {
    loadFromUploadedData(uploadedJsonData, ref);
    return true;
  }

  const cachedOverpass = loadCachedOverpassDataset();
  if (cachedOverpass) {
    uploadedJsonData = cachedOverpass;
    loadFromUploadedData(uploadedJsonData, ref);
    setStatus(`Linie ${ref} aus Cache geladen.`);
    return true;
  }

  return false;
}

function clearRoute() {
  routeLayer.clearLayers();
  const panel = document.getElementById("station-panel");
  if (panel) panel.hidden = true;
}

// ─── Stationsliste rechts ─────────────────────────────────────────────────────

function updateStationPanel(stations, ref) {
  const panel   = document.getElementById("station-panel");
  const header  = document.getElementById("station-panel-header");
  const list    = document.getElementById("station-list");
  if (!panel || !header || !list) return;

  if (!stations || stations.length === 0) {
    panel.hidden = true;
    return;
  }

  header.textContent = `${ref} · ${stations.length} Stationen`;
  list.innerHTML = "";

  stations.forEach((s, i) => {
    const item = document.createElement("div");
    item.className = "stn-item";
    item.title = s.name;

    const num  = document.createElement("span");
    num.className = "stn-num";
    num.textContent = i + 1;

    const dot  = document.createElement("span");
    dot.className = "stn-dot";

    const name = document.createElement("span");
    name.className = "stn-name";
    name.textContent = s.name;

    item.append(num, dot, name);
    item.addEventListener("click", () => {
      map.flyTo([s.lat, s.lon], 17, { duration: 0.8 });
    });
    list.appendChild(item);
  });

  panel.hidden = false;
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

  updateStationPanel(stations, ref);

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
 * Koordinatensystem: Berliner Referenzsystem in cm, damit alle Linien im selben Stadtraum landen
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
    halfLengthM: s.halfLengthM,
    halfWidthM: s.halfWidthM,
  }));

  const finalGeometry = buildFinalTrack(rawTrack, projections);
  const finalTrack = orientNorthToSouth(finalGeometry.route);
  const finalRouteLengthM =
    finalTrack.length > 1
      ? finalTrack.slice(1).reduce((acc, _, i) => acc + haversineM(finalTrack[i], finalTrack[i + 1]), 0)
      : rawTrackLengthM;

  // ── Koordinaten-Konversion: WGS84 → lokales ENU → UE cm ─────────────────
  //
  // Equirectangular / lokales ENU (Flat-Earth-Näherung, Fehler < 0,05 % bei 18 km).
  // Mercator würde bei 52,5 °N alle Abstände um Faktor ~1,64 strecken, was dazu
  // führt, dass pos_cm und dist_m nicht mehr übereinstimmen und Stationen an der
  // falschen Position entlang der Spline landen.
  //
  // UE-Level-Achsenkonvention (bestätigt durch Nutzertests):
  //   UE X = -(NordDelta in m × 100)   →  positiv = Richtung geogr. Süd
  //   UE Y = -(OstDelta  in m × 100)   →  positiv = Richtung geogr. West
  //   UE Z = Höhe (cm)
  //
  // Import-Script macht pass-through – keine weiteren Transformationen nötig.
  const [originLat, originLon] = finalTrack[0] || ctrlPts[0];
  const _enuScale = mpd(originLat); // { lat: m/deg, lon: m/deg } am Ursprungsbreitengrad

  function toUEcm(lat, lon, zM = 0) {
    const northDeltaM = (lat - originLat) * _enuScale.lat;
    const eastDeltaM  = (lon - originLon) * _enuScale.lon;
    return [
      +(-northDeltaM * 100).toFixed(1),  // UE X = -NorthDelta cm
      +(-eastDeltaM  * 100).toFixed(1),  // UE Y = -EastDelta  cm
      +(zM * 100).toFixed(1),
    ];
  }

  // ── Kontroll-Spline mit Tangenten ─────────────────────────────────────────
  const pts = orientedCtrlPts.map((p) => toUEcm(p[0], p[1]));
  const n = pts.length;
  const splinePoints = pts.map((p, i) => {
    const prev = pts[Math.max(0, i - 1)];
    const next = pts[Math.min(n - 1, i + 1)];
    const tx =
      i === 0 ? next[0] - p[0] : i === n - 1 ? p[0] - prev[0] : 0.5 * (next[0] - prev[0]);
    const ty =
      i === 0 ? next[1] - p[1] : i === n - 1 ? p[1] - prev[1] : 0.5 * (next[1] - prev[1]);
    return {
      location: p,
      arrive_tangent: [+tx.toFixed(1), +ty.toFixed(1), 0],
      leave_tangent: [+tx.toFixed(1), +ty.toFixed(1), 0],
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
      wgs84: [+finalTrack[i][0].toFixed(7), +finalTrack[i][1].toFixed(7)],
      pos_cm: toUEcm(finalTrack[i][0], finalTrack[i][1]),
    });
  }

  // ── Stationen auf finale Web-Route projizieren ───────────────────────────
  // point und tangent kommen direkt von der Mittellinie bei distAlongTrack,
  // NICHT vom projizierten OSM-Stop (der ggf. auf Rail 2 liegt).
  const _finalCum = cumLengths(finalTrack);
  const finalStations = masterStations.map((s) => {
    const proj = projectOntoTrack([s.lat, s.lon], finalTrack);
    const centerPoint   = pointAtDist(finalTrack, _finalCum, proj.distAlongTrack);
    const centerTangent = tangentAtDist(finalTrack, _finalCum, proj.distAlongTrack);
    return {
      ...proj,
      point:   centerPoint,
      tangent: centerTangent,
      name:        s.name,
      halfLengthM: s.halfLengthM,
      halfWidthM:  s.halfWidthM,
    };
  });
  const sorted = [...finalStations].sort((a, b) => a.distAlongTrack - b.distAlongTrack);

  // ── Sections: tunnel / platform auf Basis der finalen Route ──────────────
  const sections = [];
  let cursor = 0;
  for (const s of sorted) {
    const pStart = +(Math.max(0, s.distAlongTrack - s.halfLengthM)).toFixed(2);
    const pEnd = +(Math.min(finalRouteLengthM, s.distAlongTrack + s.halfLengthM)).toFixed(2);

    if (pStart > cursor + 0.1) {
      sections.push({ type: "tunnel", from_m: +cursor.toFixed(2), to_m: pStart });
    }
    sections.push({
      type: "platform",
      station: s.name,
      from_m: pStart,
      to_m: pEnd,
      center_m: +s.distAlongTrack.toFixed(2),
    });
    cursor = pEnd;
  }
  if (cursor < finalRouteLengthM - 0.1) {
    sections.push({ type: "tunnel", from_m: +cursor.toFixed(2), to_m: +finalRouteLengthM.toFixed(2) });
  }

  const platformGeometry = sorted.map((s) => {
    const start = moveMeter(s.point, s.tangent, -s.halfLengthM);
    const end = moveMeter(s.point, s.tangent, s.halfLengthM);
    return {
      station: s.name,
      corners_cm: buildPlatformPolygon(s.point, s.tangent, -s.halfLengthM, s.halfLengthM, s.halfWidthM)
        .map((p) => toUEcm(p[0], p[1])),
      center_line_cm: [toUEcm(start[0], start[1]), toUEcm(end[0], end[1])],
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
    origin_wgs84: { lat: +originLat.toFixed(7), lon: +originLon.toFixed(7) },
    coordinate_system: {
      space: "local_ue_cm",
      x_axis: "south",
      y_axis: "west",
      z_axis: "up",
      projection: "local_enu_equirectangular",
      origin: "first_final_route_point",
    },
    coordinate_note: "X=SouthDelta Y=WestDelta Z=Up in cm. Equirectangular/ENU projection (flat-earth, scale at origin lat). 1 cm = 1 true cm – dist_m*100 matches spline arc length. Import as-is, no transforms needed.",
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
    stations: sorted.map((s) => ({
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
      location_cm: toUEcm(s.point[0], s.point[1]),
    })),
    sections,
    platform_geometry: platformGeometry,
  };

  if (buildOnly) return payload;

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${ref}.json`;
  a.click();
  URL.revokeObjectURL(a.href);

  setStatus(
    `UE5-Export: ${sorted.length} Stationen · ${sections.length} Abschnitte · ${(finalRouteLengthM / 1000).toFixed(1)} km`,
  );
  return payload;
}

function saveJsonFile(filename, payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function saveBlobFile(filename, blob) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

async function exportAllLinesToUnreal() {
  const originalRef = select?.value || lastLoadData?.ref || LINES[0];
  const zip = new JSZip();
  let exportedCount = 0;
  let skippedCount = 0;

  try {
    for (const ref of LINES) {
      setStatus(`Prüfe ${ref} für UE-Export …`);
      if (!tryLoadRouteFromCache(ref)) {
        skippedCount += 1;
        console.warn(`UE-Export übersprungen: ${ref} ist nicht lokal geladen oder im Cache.`);
        continue;
      }

      const payload = exportToUnreal(true);
      if (!payload) {
        skippedCount += 1;
        console.warn(`UE-Export übersprungen: ${ref} hat keinen exportierbaren Payload.`);
        continue;
      }

      zip.file(`${ref}.json`, JSON.stringify(payload, null, 2));
      exportedCount += 1;
    }

    if (exportedCount === 0) {
      throw new Error("Kein lokaler Linien-Export gefunden.");
    }

    const blob = await zip.generateAsync({ type: "blob" });
    saveBlobFile(`ue-lines.zip`, blob);
  } finally {
    if (select && originalRef) {
      select.value = originalRef;
      loadLine(originalRef);
    }
  }

  setStatus(`UE-ZIP exportiert: ${exportedCount} Linien, ${skippedCount} übersprungen`);
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
    })),
    // UE-Importer kann direkt diese Felder nutzen (kein separater UE-Export nötig)
  };
  saveJsonFile(`ubahn-master-${ref}.json`, payload);
}

function applyEditsFromParsed(parsed) {
  // v4: reines Master-Format
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

function loadFromUploadedData(data, ref) {
  const isNewLoad = !lastLoadData || lastLoadData.ref !== ref || lastLoadData.data !== data;

  // Linienwechsel → masterStations neu aus Overpass berechnen
  if (lastLoadData && lastLoadData.ref !== ref) {
    masterStations = null;
    lastRelation = null;
  }

  lastLoadData = { data, ref };

  // ── Track ermitteln ───────────────────────────────────────────────────────
  let rawTrack;
  if (customControlPoints && customControlPoints.length >= 2) {
    rawTrack = catmullRomSpline(customControlPoints);
  } else if (data) {
    const relations = getSubwayRelationsForRef(data, ref);
    if (!relations.length) {
      // Wenn JSON die Linie nicht enthält, aber Master-Cache existiert: daraus laden.
      if (loadCachedMasterForRef(ref)) {
        setStatus(`Linie ${ref} aus Master-Cache geladen (JSON ohne Relation).`);
        return;
      }
      setStatus(`Keine U-Bahn-Relation für ${ref} in der JSON.`, true);
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
    const relations = getSubwayRelationsForRef(data, ref);
    const relation = pickRelationWithMostStops(relations, data.elements || []);
    if (!relation) {
      setStatus("Keine passende Relation.", true);
      clearRoute();
      return;
    }
    lastRelation = relation;

    const relB = relations.find((r) => r !== relation);
    const stopNodes = relB
      ? mergeStopsFromBothRelations(relation, relB, data.elements || [])
      : extractStopNodes(relation, data.elements || []);
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
      if (!dims) missingPlatforms.push(s.name);
      const halfLengthM = dims?.halfLengthM ?? DEFAULT_HALF_LENGTH_M;
      const halfWidthM = dims?.halfWidthM ?? DEFAULT_HALF_WIDTH_M;
      return {
        name: s.name,
        lat: s.lat,
        lon: s.lon,
        halfLengthM,
        halfWidthM,
        // Original-OSM-Werte für Zurücksetzen
        _osmLat: s.lat,
        _osmLon: s.lon,
        _osmHalfLengthM: halfLengthM,
        _osmHalfWidthM: halfWidthM,
      };
    });

    if (missingPlatforms.length) {
      console.warn("Fehlende Plattformmaße:", missingPlatforms.join(", "));
    }
  }

  _renderFromMasterStations(rawTrack, ref, isNewLoad);
}

function loadLine(ref) {
  setStatus("Lade …");
  setDirectionText("");

  // Falls bereits passender Master-State im Speicher ist
  if (masterStations && lastLoadData?.ref === ref) {
    lastLoadData = { data: null, ref };
    rebuildAndDraw();
    return;
  }

  // Cache-first: Master oder zuletzt gecachte Overpass-Daten verwenden
  if (tryLoadRouteFromCache(ref)) {
    return;
  }

  if (uploadedJsonData) {
    loadFromUploadedData(uploadedJsonData, ref);
    return;
  }

  setStatus("⇣ Overpass oder 📂 Master laden.");
  clearRoute();
  setDirectionText("");
  return;
}

function buildOverpassQuery(ref) {
  return `[out:json][timeout:360];
area["name"="Berlin"]["boundary"="administrative"]->.searchArea;
(
  relation["type"="route"]["route"="subway"]["ref"="${ref}"](area.searchArea);
);
out body;
>;
out geom;`;
}

async function importFromOverpass(ref) {
  // Bewusst KEIN Cache-Check – diese Funktion fetcht immer frisch von Overpass,
  // damit der Nutzer auch gecachte Linien neu laden kann.
  try {
    setStatus(`Lade ${ref} direkt von Overpass …`);
    setDirectionText("");

    const response = await fetch(OVERPASS_API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: buildOverpassQuery(ref),
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
    loadLine(ref);
  } catch (error) {
    setStatus(`Overpass-Direktimport fehlgeschlagen: ${error.message}`, true);
  }
}

// ─── UI ───────────────────────────────────────────────────────────────────────

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

if (select?.value) {
  loadLine(select.value);
}

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

setStatus("⇣ Overpass oder 📂 Master laden.");

// ─── Edit-Panel Handler ───────────────────────────────────────────────────────

document.getElementById("btn-edit")?.addEventListener("click", toggleEditMode);
document.getElementById("btn-overpass")?.addEventListener("click", () => importFromOverpass(select?.value || "U8"));

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
  }
  document.getElementById("edit-panel").hidden = true;
  selectedStation = null;
  rebuildAndDraw();
});

document.getElementById("btn-export-ue")?.addEventListener("click", () => exportToUnreal(false));
document.getElementById("btn-export-ue-all")?.addEventListener("click", () => {
  exportAllLinesToUnreal().catch((error) => {
    setStatus(`Alle Linien-Export fehlgeschlagen: ${error.message}`, true);
  });
});
document.getElementById("btn-export-master")?.addEventListener("click", exportMaster);
document.getElementById("btn-spline")?.addEventListener("click", toggleSplineEdit);
document.getElementById("btn-reload")?.addEventListener("click", reloadCurrentFile);

document.getElementById("btn-fit")?.addEventListener("click", () => {
  const bounds = routeLayer.getBounds();
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
