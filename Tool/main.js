const OVERPASS_API_URL = "https://overpass-api.de/api/interpreter";
const NOMINATIM_API_URL = "https://nominatim.openstreetmap.org/search";

const AREA_STYLE = {
  motorway: { color: "#dc2626", weight: 4 },
  major_road: { color: "#f59e0b", weight: 3.5 },
  city_road: { color: "#475569", weight: 2.5 },
  service: { color: "#94a3b8", weight: 2 },
  rail_tram: { color: "#16a34a", weight: 3 },
  rail_train: { color: "#7c3aed", weight: 3 },
  rail_subway: { color: "#2563eb", weight: 3 },
  building: { color: "#64748b", weight: 1.2 },
  traffic_sign: { color: "#e11d48", weight: 1.2 },
  traffic_signal: { color: "#f97316", weight: 1.2 },
  sports_field: { color: "#22c55e", weight: 1.8 },
  water: { color: "#0ea5e9", weight: 1.8 },
};

const AREA_LAYER_LABELS = {
  motorway: "Autobahn",
  major_road: "Hauptstrasse",
  city_road: "Stadtstrasse",
  service: "Service",
  rail_tram: "Tram",
  rail_train: "Zug",
  rail_subway: "Subway",
  building: "Gebaeude",
  traffic_sign: "Verkehrsschild",
  traffic_signal: "Ampel",
  sports_field: "Sportplatz",
  water: "Wasser",
};

const AREA_SIMPLIFY_TOLERANCE_M = 3;
const AREA_LARGE_REQUEST_KM2 = 2500;
const AREA_MAX_REQUEST_KM2 = 2500;
const AREA_EXPENSIVE_LAYERS = new Set(["city_road", "service"]);
const AREA_MIN_DRAG_PIXELS = 4;
const POSTAL_SEARCH_DEBOUNCE_MS = 800;
const DEFAULT_STREET_BP_PATH = "/Game/_UbahnWorkerGames/TEST/BP_CityTest.BP_CityTest";
const DEFAULT_BUILDING_BP_PATH = "/Game/_UbahnWorkerGames/TEST/BP_BuildingCube.BP_BuildingCube";
const STREET_BP_PATH_STORAGE_KEY = "osm-to-unreal.streetBpPath";
const BUILDING_BP_PATH_STORAGE_KEY = "osm-to-unreal.buildingBpPath";
const DEFAULT_BUILDING_HEIGHT_CM = 300;
const BERLIN_EXPORT_ORIGIN_WGS84 = { lat: 52.520008, lon: 13.404954 };

const map = L.map("map", { zoomControl: true, minZoom: 2, maxZoom: 19 }).setView([52.52, 13.405], 12);

L.tileLayer("https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}.png", {
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · ' +
    '<a href="https://carto.com/attributions">CARTO</a>',
}).addTo(map);

L.tileLayer("https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}.png", {
  attribution: "",
  pane: "shadowPane",
}).addTo(map);

const areaLayerVisibility = new Map(
  Object.keys(AREA_LAYER_LABELS).map((key) => [key, key === "major_road"]),
);

const areaProcessedLayer = L.layerGroup().addTo(map);
let areaSelectionBounds = null;
let areaSelectionRect = null;
let areaSelectMode = false;
let areaDragStart = null;
let areaDragStartPoint = null;
let areaDraftRect = null;
let areaFeatures = [];
let areaCache = null;
let latestAreaPythonScript = "";
let postalSearchTimer = null;
let lastPostalSearchValue = "";

function getStoredStreetBpPath() {
  const stored = window.localStorage.getItem(STREET_BP_PATH_STORAGE_KEY);
  return stored?.trim() || DEFAULT_STREET_BP_PATH;
}

function setStoredStreetBpPath(value) {
  const normalized = String(value || "").trim();
  window.localStorage.setItem(STREET_BP_PATH_STORAGE_KEY, normalized || DEFAULT_STREET_BP_PATH);
}

function getStreetBpPathForExport() {
  const input = document.getElementById("street-bp-path-input");
  return input?.value?.trim() || getStoredStreetBpPath();
}

function initStreetBpPathInput() {
  const input = document.getElementById("street-bp-path-input");
  if (!input) return;
  input.value = getStoredStreetBpPath();
  input.addEventListener("change", () => setStoredStreetBpPath(input.value));
  input.addEventListener("blur", () => setStoredStreetBpPath(input.value));
}

function getStoredBuildingBpPath() {
  const stored = window.localStorage.getItem(BUILDING_BP_PATH_STORAGE_KEY);
  return stored?.trim() || DEFAULT_BUILDING_BP_PATH;
}

function setStoredBuildingBpPath(value) {
  const normalized = String(value || "").trim();
  window.localStorage.setItem(BUILDING_BP_PATH_STORAGE_KEY, normalized || DEFAULT_BUILDING_BP_PATH);
}

function getBuildingBpPathForExport() {
  const input = document.getElementById("building-bp-path-input");
  return input?.value?.trim() || getStoredBuildingBpPath();
}

function initBuildingBpPathInput() {
  const input = document.getElementById("building-bp-path-input");
  if (!input) return;
  input.value = getStoredBuildingBpPath();
  input.addEventListener("change", () => setStoredBuildingBpPath(input.value));
  input.addEventListener("blur", () => setStoredBuildingBpPath(input.value));
}

function setStatus(message, isError = false) {
  const el = document.getElementById("status");
  if (!el) return;
  el.textContent = message;
  el.style.color = isError ? "#b91c1c" : "";
}

function getSelectedAreaCategories() {
  return [...areaLayerVisibility.entries()]
    .filter(([, visible]) => visible)
    .map(([category]) => category);
}

function haversineM(a, b) {
  const r = 6371000;
  const toRad = (v) => (v * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLon = toRad(b[1] - a[1]);
  const lat1 = toRad(a[0]);
  const lat2 = toRad(b[0]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.min(1, Math.sqrt(h)));
}

function areaBoundsSizeKm2(bounds) {
  if (!bounds?.isValid?.()) return 0;
  const southWest = [bounds.getSouth(), bounds.getWest()];
  const southEast = [bounds.getSouth(), bounds.getEast()];
  const northWest = [bounds.getNorth(), bounds.getWest()];
  return (haversineM(southWest, southEast) * haversineM(southWest, northWest)) / 1_000_000;
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

function normalizeAreaKey(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

function classifyAreaWay(tags = {}) {
  const highway = tags.highway;
  if (highway) {
    if (["motorway", "motorway_link", "trunk", "trunk_link"].includes(highway)) return "motorway";
    if (["primary", "primary_link", "secondary", "secondary_link"].includes(highway)) return "major_road";
    if (["tertiary", "tertiary_link", "unclassified", "residential", "living_street", "road"].includes(highway)) return "city_road";
    if (highway === "service") return "service";
  }

  const railway = tags.railway;
  if (railway === "tram") return "rail_tram";
  if (railway === "subway") return "rail_subway";
  if (railway === "rail" || railway === "light_rail") return "rail_train";
  if (tags.building && tags.building !== "no") return "building";
  if (tags.leisure === "pitch" || tags.leisure === "sports_centre" || tags.sport) return "sports_field";
  if (tags.natural === "water" || tags.water || tags.waterway === "riverbank" || tags.landuse === "reservoir") return "water";
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
    case "building":
      return 'way["building"]';
    case "traffic_sign":
      return 'node["traffic_sign"]';
    case "traffic_signal":
      return 'node["highway"="traffic_signals"]';
    case "sports_field":
      return ['way["leisure"~"^(pitch|sports_centre|stadium|track)$"]', 'way["sport"]'];
    case "water":
      return ['way["natural"="water"]', 'way["water"]', 'way["waterway"="riverbank"]', 'way["landuse"="reservoir"]'];
    default:
      return null;
  }
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
    .flat()
    .filter(Boolean)
    .map((filter) => `  ${filter}(${bbox});`)
    .join("\n");
  if (!clauses) throw new Error("Keine OSM-Layer ausgewaehlt.");
  return `[out:json][timeout:120];
(
${clauses}
);
out geom(${bbox});`;
}

function normalizeOverpassGeometry(geometry) {
  if (!Array.isArray(geometry)) return [];
  return geometry
    .filter((point) => point && Number.isFinite(point.lat) && Number.isFinite(point.lon))
    .map((point) => [point.lat, point.lon]);
}

function perpendicularDistanceM(point, a, b) {
  const lat0 = a[0];
  const mpdLon = 111320 * Math.cos((lat0 * Math.PI) / 180);
  const toXY = ([lat, lon]) => ({
    x: (lon - a[1]) * mpdLon,
    y: (lat - a[0]) * 111320,
  });
  const p = toXY(point);
  const pA = toXY(a);
  const pB = toXY(b);
  const dx = pB.x - pA.x;
  const dy = pB.y - pA.y;
  const length2 = dx * dx + dy * dy;
  if (!length2) return Math.hypot(p.x - pA.x, p.y - pA.y);
  const t = Math.max(0, Math.min(1, ((p.x - pA.x) * dx + (p.y - pA.y) * dy) / length2));
  const proj = { x: pA.x + t * dx, y: pA.y + t * dy };
  return Math.hypot(p.x - proj.x, p.y - proj.y);
}

function simplifyPolyline(poly, toleranceM) {
  if (!Array.isArray(poly) || poly.length <= 2) return poly || [];
  let maxDist = 0;
  let index = 0;
  for (let i = 1; i < poly.length - 1; i++) {
    const dist = perpendicularDistanceM(poly[i], poly[0], poly[poly.length - 1]);
    if (dist > maxDist) {
      maxDist = dist;
      index = i;
    }
  }
  if (maxDist <= toleranceM) return [poly[0], poly[poly.length - 1]];
  const left = simplifyPolyline(poly.slice(0, index + 1), toleranceM);
  const right = simplifyPolyline(poly.slice(index), toleranceM);
  return [...left.slice(0, -1), ...right];
}

function areaGroupName(tags, category, id) {
  return tags?.name || tags?.ref || `${AREA_LAYER_LABELS[category]} ${id}`;
}

function trafficSignName(tags = {}, id) {
  return tags.name || tags.ref || tags.traffic_sign || `Verkehrsschild ${id}`;
}

function trafficSignalName(tags = {}, id) {
  return tags.name || tags.ref || tags["traffic_signals:direction"] || `Ampel ${id}`;
}

function isClosedPolyline(poly, toleranceM = 2) {
  return Array.isArray(poly) && poly.length >= 4 && haversineM(poly[0], poly[poly.length - 1]) <= toleranceM;
}

function areaFeatureExportClass(feature) {
  return feature.tags.highway || feature.tags.railway || "";
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
    case "sports_field":
    case "water":
      return 1;
    default:
      return 5;
  }
}

function buildAreaFeatures(data) {
  const features = [];
  const seen = new Set();
  for (const el of data.elements || []) {
    if (el.type === "node" && Number.isFinite(el.lat) && Number.isFinite(el.lon) && el.tags?.traffic_sign) {
      const category = "traffic_sign";
      const name = trafficSignName(el.tags || {}, el.id);
      const key = normalizeAreaKey(`${category}_${name}_${el.id}`);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      features.push({
        id: el.id,
        key,
        category,
        shape: "point",
        closed: false,
        name,
        tags: el.tags || {},
        point: [el.lat, el.lon],
        controlGeometry: [[el.lat, el.lon]],
      });
      continue;
    }

    if (el.type === "node" && Number.isFinite(el.lat) && Number.isFinite(el.lon) && el.tags?.highway === "traffic_signals") {
      const category = "traffic_signal";
      const name = trafficSignalName(el.tags || {}, el.id);
      const key = normalizeAreaKey(`${category}_${name}_${el.id}`);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      features.push({
        id: el.id,
        key,
        category,
        shape: "point",
        closed: false,
        name,
        tags: el.tags || {},
        point: [el.lat, el.lon],
        controlGeometry: [[el.lat, el.lon]],
      });
      continue;
    }

    if (el.type !== "way" || !Array.isArray(el.geometry) || el.geometry.length < 2) continue;
    const category = classifyAreaWay(el.tags || {});
    if (!category) continue;

    const rawGeometry = normalizeOverpassGeometry(el.geometry);
    if (rawGeometry.length < 2) continue;
    const controlGeometry = simplifyPolyline(rawGeometry, AREA_SIMPLIFY_TOLERANCE_M);
    if (controlGeometry.length < 2) continue;

    const name = areaGroupName(el.tags || {}, category, el.id);
    const key = normalizeAreaKey(`${category}_${name}_${el.id}`);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    features.push({
      id: el.id,
      key,
      category,
      shape: isClosedPolyline(controlGeometry) ? "closed" : "line",
      closed: isClosedPolyline(controlGeometry),
      name,
      tags: el.tags || {},
      controlGeometry,
    });
  }
  return features;
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

function buildCoordinateTransform(selected) {
  if (!selected.some((feature) => Array.isArray(feature.controlGeometry) && feature.controlGeometry.length >= 1)) return null;
  const lat0 = BERLIN_EXPORT_ORIGIN_WGS84.lat;
  const lon0 = BERLIN_EXPORT_ORIGIN_WGS84.lon;
  const metersPerDegreeLat = 111320;
  const metersPerDegreeLon = 111320 * Math.cos((lat0 * Math.PI) / 180);
  return {
    originWgs84: { lat: lat0, lon: lon0 },
    metersPerDegree: { lat: metersPerDegreeLat, lon: metersPerDegreeLon },
    toPointCm([lat, lon]) {
      return {
        X: +(((lon - lon0) * metersPerDegreeLon * 100).toFixed(1)),
        Y: +(((lat0 - lat) * metersPerDegreeLat * 100).toFixed(1)),
        Z: 0,
      };
    },
    widthCm(west, east) {
      return +(((east - west) * metersPerDegreeLon * 100).toFixed(1));
    },
    depthCm(south, north) {
      return +(((north - south) * metersPerDegreeLat * 100).toFixed(1));
    },
  };
}

function normalizeDegrees(degrees) {
  let normalized = degrees;
  while (normalized <= -180) normalized += 360;
  while (normalized > 180) normalized -= 360;
  return +normalized.toFixed(3);
}

function buildingFootprintMetrics(feature, transform) {
  const points = feature.controlGeometry.map((point) => transform.toPointCm(point));
  const openPoints = points.length > 1 && points[0].X === points.at(-1).X && points[0].Y === points.at(-1).Y ? points.slice(0, -1) : points;
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
        CenterWgs84: {
          lat: +(((bounds.south + bounds.north) * 0.5).toFixed(7)),
          lon: +(((bounds.west + bounds.east) * 0.5).toFixed(7)),
        },
        BoundsWgs84: {
          south: +bounds.south.toFixed(7),
          north: +bounds.north.toFixed(7),
          west: +bounds.west.toFixed(7),
          east: +bounds.east.toFixed(7),
        },
        FootprintCm: metrics.footprintCm,
        WidthCm: metrics.widthCm,
        DepthCm: metrics.depthCm,
        HeightCm: Math.max(100, heightCm),
        YawDeg: metrics.yawDeg,
        X: metrics.center.X,
        Y: metrics.center.Y,
        Z: heightCm * 0.5,
      };
    })
    .filter(Boolean);
}

function buildTrafficSignData(selected, transform) {
  return selected
    .filter((feature) => (feature.category === "traffic_sign" || feature.category === "traffic_signal") && Array.isArray(feature.point))
    .map((feature) => {
      const point = transform.toPointCm(feature.point);
      return {
        Kind: feature.category,
        SignKey: feature.key,
        OsmId: feature.id,
        Name: feature.name || feature.key,
        Type: feature.tags.traffic_sign || feature.tags.highway || "",
        Direction: feature.tags.direction || feature.tags["traffic_signals:direction"] || "",
        CenterWgs84: {
          lat: +feature.point[0].toFixed(7),
          lon: +feature.point[1].toFixed(7),
        },
        X: point.X,
        Y: point.Y,
        Z: 0,
      };
    });
}

function renderAreaFeatures() {
  areaProcessedLayer.clearLayers();
  const counts = new Map(Object.keys(AREA_LAYER_LABELS).map((key) => [key, 0]));
  let visibleCount = 0;
  let visibleBuildings = 0;
  let visibleSplines = 0;
  let visibleSigns = 0;
  let visibleSignals = 0;
  for (const feature of areaFeatures) {
    counts.set(feature.category, (counts.get(feature.category) || 0) + 1);
    if (!areaLayerVisibility.get(feature.category)) continue;
    visibleCount += 1;
    if (feature.category === "building") visibleBuildings += 1;
    else if (feature.category === "traffic_sign") visibleSigns += 1;
    else if (feature.category === "traffic_signal") visibleSignals += 1;
    else visibleSplines += 1;
    const style = AREA_STYLE[feature.category];
    const lineOptions = {
      color: style.color,
      weight: style.weight,
      opacity: 0.9,
      lineCap: "round",
      lineJoin: "round",
    };
    if (feature.category === "building") {
      const heightM = buildingHeightCm(feature.tags) / 100;
      const polygon = L.polygon(feature.controlGeometry, {
        ...lineOptions,
        fillColor: style.color,
        fillOpacity: 0.38,
      }).addTo(areaProcessedLayer);
      polygon.bindTooltip(`${AREA_LAYER_LABELS[feature.category]}: ${feature.name} (${heightM.toFixed(1)} m)`, { sticky: true });
    } else if (feature.category === "traffic_sign" || feature.category === "traffic_signal") {
      const marker = L.circleMarker(feature.point, {
        radius: 4,
        color: style.color,
        weight: 2,
        fillColor: style.color,
        fillOpacity: 0.85,
      }).addTo(areaProcessedLayer);
      marker.bindTooltip(`${AREA_LAYER_LABELS[feature.category]}: ${feature.name}`, { sticky: true });
    } else {
      const line = L.polyline(feature.controlGeometry, lineOptions).addTo(areaProcessedLayer);
      const roadType = feature.tags.highway || feature.tags.railway || "";
      line.bindTooltip(`${AREA_LAYER_LABELS[feature.category]}: ${feature.name} (${roadType})`, { sticky: true });
    }
  }

  const summary = [...counts.entries()]
    .filter(([key, count]) => count > 0 && areaLayerVisibility.get(key))
    .map(([key, count]) => `${AREA_LAYER_LABELS[key]} ${count}`)
    .join(" · ");
  setStatus(`Bereich geladen: ${visibleSplines} Splines / ${visibleBuildings} Gebaeude / ${visibleSigns} Schilder / ${visibleSignals} Ampeln sichtbar (${visibleCount}/${areaFeatures.length})${summary ? ` · ${summary}` : ""}`);
}

function setSelectedAreaBounds(bounds, shouldFitMap = false) {
  if (!bounds?.isValid?.()) return false;
  areaSelectionBounds = bounds;
  if (areaSelectionRect) areaSelectionRect.remove();
  areaSelectionRect = L.rectangle(bounds, {
    color: "#16a34a",
    weight: 2,
    fillOpacity: 0.04,
  }).addTo(map);
  if (shouldFitMap) map.fitBounds(bounds, { padding: [48, 48], maxZoom: 14 });
  const areaKm2 = areaBoundsSizeKm2(bounds);
  const suffix = areaKm2 > AREA_MAX_REQUEST_KM2
    ? ` Zu gross fuer Overpass, bitte kleiner als ${AREA_MAX_REQUEST_KM2} km² waehlen.`
    : "";
  setStatus(`Bereich gewaehlt (${areaKm2.toFixed(2)} km²).${suffix}`, areaKm2 > AREA_MAX_REQUEST_KM2);
  return true;
}

function clearAreaDraft() {
  document.removeEventListener("pointermove", updateAreaSelection);
  document.removeEventListener("pointerup", finishAreaSelection);
  document.removeEventListener("pointercancel", cancelAreaSelection);
  areaDragStart = null;
  areaDragStartPoint = null;
  if (areaDraftRect) {
    areaDraftRect.remove();
    areaDraftRect = null;
  }
}

function setAreaSelectMode(active) {
  areaSelectMode = active;
  document.getElementById("btn-area-select")?.classList.toggle("active", active);
  map.getContainer().style.cursor = active ? "crosshair" : "";
  if (active) {
    map.dragging.disable();
    map.doubleClickZoom.disable();
  } else {
    clearAreaDraft();
    map.dragging.enable();
    map.doubleClickZoom.enable();
  }
}

function beginAreaSelection(event) {
  if (!areaSelectMode || event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  areaDragStart = map.mouseEventToLatLng(event);
  areaDragStartPoint = map.mouseEventToContainerPoint(event);
  if (areaDraftRect) areaDraftRect.remove();
  areaDraftRect = L.rectangle([areaDragStart, areaDragStart], {
    color: "#16a34a",
    weight: 1,
    dashArray: "4 4",
  }).addTo(map);
  document.addEventListener("pointermove", updateAreaSelection, { passive: false });
  document.addEventListener("pointerup", finishAreaSelection, { passive: false });
  document.addEventListener("pointercancel", cancelAreaSelection, { passive: false });
}

function updateAreaSelection(event) {
  if (!areaSelectMode || !areaDragStart || !areaDraftRect) return;
  event.preventDefault();
  areaDraftRect.setBounds(L.latLngBounds(areaDragStart, map.mouseEventToLatLng(event)));
}

function finishAreaSelection(event) {
  if (!areaSelectMode || !areaDragStart) return;
  event.preventDefault();
  const currentLatLng = map.mouseEventToLatLng(event);
  const currentPoint = map.mouseEventToContainerPoint(event);
  const dragDistance = areaDragStartPoint ? areaDragStartPoint.distanceTo(currentPoint) : 0;
  const bounds = L.latLngBounds(areaDragStart, currentLatLng);
  clearAreaDraft();
  if (dragDistance < AREA_MIN_DRAG_PIXELS || !bounds.isValid()) {
    setStatus("Bereich ziehen, nicht nur klicken.", true);
    return;
  }
  setSelectedAreaBounds(bounds);
  setAreaSelectMode(false);
}

function cancelAreaSelection() {
  clearAreaDraft();
}

async function importAreaFromOverpass(bounds = areaSelectionBounds) {
  if (!bounds?.isValid?.()) {
    setStatus("Erst einen Bereich auf der Karte ziehen.", true);
    return false;
  }

  try {
    const selectedCategories = getSelectedAreaCategories();
    if (!selectedCategories.length) {
      setStatus("Mindestens einen OSM-Layer anhaken.", true);
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
      setStatus(`Bereich ${areaKm2.toFixed(1)} km² ist fuer ${expensiveLabels} zu gross. Layer abwaehlen oder kleiner ziehen.`, true);
      return false;
    }

    const cacheKey = areaBoundsCacheKey(bounds, selectedCategories);
    if (areaCache?.key === cacheKey && Array.isArray(areaCache.features)) {
      areaFeatures = areaCache.features;
      renderAreaFeatures();
      return true;
    }

    const layerLabels = selectedCategories.map((category) => AREA_LAYER_LABELS[category]).join(", ");
    setStatus(`Lade OSM-Daten (${areaKm2.toFixed(2)} km², ${layerLabels}) ...`);
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

    areaFeatures = buildAreaFeatures(data);
    areaCache = { key: cacheKey, bounds, features: areaFeatures };
    if (!areaFeatures.length) {
      areaProcessedLayer.clearLayers();
      setStatus("Keine passenden OSM-Ways im Bereich gefunden.", true);
      return false;
    }
    renderAreaFeatures();
    return true;
  } catch (error) {
    setStatus(`Bereichsimport fehlgeschlagen: ${error.message}`, true);
    return false;
  }
}

function buildAreaPcgRows() {
  const selected = areaFeatures.filter(
    (feature) =>
      feature.category !== "building" &&
      feature.category !== "traffic_sign" &&
      feature.category !== "traffic_signal" &&
      areaLayerVisibility.get(feature.category) &&
      Array.isArray(feature.controlGeometry) &&
      feature.controlGeometry.length >= 2,
  );
  if (!selected.length) return null;

  const transform = buildCoordinateTransform(selected);
  if (!transform) return null;

  const rows = [];
  for (const feature of selected) {
    const points = feature.controlGeometry.map(transform.toPointCm);
    const widthM = +areaFeatureWidthM(feature).toFixed(2);
    points.forEach((point, pointIndex) => {
      rows.push({
        Name: `${feature.key}_${String(pointIndex).padStart(4, "0")}`,
        SplineKey: feature.key,
        PointIndex: pointIndex,
        PointCount: points.length,
        Type: feature.category,
        Shape: feature.shape,
        Street: feature.name || "",
        OsmClass: areaFeatureExportClass(feature),
        WidthM: widthM,
        bBridge: areaTagBool(feature.tags.bridge),
        bTunnel: areaTagBool(feature.tags.tunnel),
        OsmLayer: areaTagInt(feature.tags.layer),
        bClosed: feature.closed,
        X: point.X,
        Y: point.Y,
        Z: point.Z,
      });
    });
  }
  return rows;
}

function buildAreaPythonSplineData() {
  const rows = buildAreaPcgRows() || [];
  const grouped = new Map();
  for (const row of rows) {
    if (!grouped.has(row.SplineKey)) {
      grouped.set(row.SplineKey, {
        SplineKey: row.SplineKey,
        Type: row.Type,
        Shape: row.Shape,
        Street: row.Street,
        OsmClass: row.OsmClass,
        WidthM: row.WidthM,
        bBridge: row.bBridge,
        bTunnel: row.bTunnel,
        OsmLayer: row.OsmLayer,
        bClosed: row.bClosed,
        Points: [],
      });
    }
    grouped.get(row.SplineKey).Points[row.PointIndex] = [row.X, row.Y, row.Z];
  }
  return [...grouped.values()];
}

function buildAreaPythonPayload() {
  const selected = areaFeatures.filter(
    (feature) => areaLayerVisibility.get(feature.category) && Array.isArray(feature.controlGeometry) && feature.controlGeometry.length >= 1,
  );
  if (!selected.length) return null;
  const transform = buildCoordinateTransform(selected);
  if (!transform) return null;
  return {
    origin_wgs84: transform.originWgs84,
    coordinate_system: {
      unit: "cm",
      axes: "X=East, Y=South, Z=Up",
      origin: "Berlin fixed WGS84 origin",
      meters_per_degree: transform.metersPerDegree,
    },
    splines: buildAreaPythonSplineData(),
    buildings: buildBuildingData(selected, transform),
    traffic_signs: buildTrafficSignData(selected, transform),
  };
}

function buildCompactAreaUnrealPythonScript(payload, streetBpPath, buildingBpPath) {
  const splines = payload.splines || [];
  const buildings = payload.buildings || [];
  const trafficSigns = payload.traffic_signs || [];
  const exportMeta = {
    origin_wgs84: payload.origin_wgs84,
    coordinate_system: payload.coordinate_system,
  };
  const jsonLiteral = JSON.stringify(JSON.stringify(splines));
  const buildingJsonLiteral = JSON.stringify(JSON.stringify(buildings));
  const trafficSignJsonLiteral = JSON.stringify(JSON.stringify(trafficSigns));
  const metaJsonLiteral = JSON.stringify(JSON.stringify(exportMeta));
  const bpPathLiteral = JSON.stringify(streetBpPath);
  const buildingBpPathLiteral = JSON.stringify(buildingBpPath);
  return `import json
import re

import unreal


STREET_SPLINES = json.loads(${jsonLiteral})
BUILDINGS = json.loads(${buildingJsonLiteral})
TRAFFIC_SIGNS = json.loads(${trafficSignJsonLiteral})
EXPORT_META = json.loads(${metaJsonLiteral})
STREET_BP_PATH = ${bpPathLiteral}
BUILDING_BP_PATH = ${buildingBpPathLiteral}
ACTOR_LABEL_PREFIX = "CITY_STREET"
BUILDING_ACTOR_LABEL_PREFIX = "OSM_BUILDING"
TRAFFIC_SIGN_ACTOR_LABEL_PREFIX = "OSM_SIGN"
TRAFFIC_SIGNAL_ACTOR_LABEL_PREFIX = "OSM_SIGNAL"
SPLINE_COMPONENT_NAMES = ["StreetSpline", "Spline"]
WORLD_OFFSET_CM = unreal.Vector(0.0, 0.0, 0.0)
FORCE_ZERO_Z = True
LINEAR_SPLINES = True
CUBE_BASE_CM = 100.0
UPDATE_EXISTING_ACTORS = True
DELETE_BEFORE_IMPORT = False


def fail(message):
    unreal.log_error(message)
    raise RuntimeError(message)


def destroy_existing_actor_with_prefix(prefix):
    for actor in unreal.EditorLevelLibrary.get_all_level_actors():
        if actor.get_actor_label().startswith(prefix):
            unreal.EditorLevelLibrary.destroy_actor(actor)


def find_actor_by_label(label):
    for actor in unreal.EditorLevelLibrary.get_all_level_actors():
        if actor.get_actor_label() == label:
            return actor
    return None


def load_bp_class(asset_path):
    asset_class = unreal.EditorAssetLibrary.load_blueprint_class(asset_path)
    if asset_class is None:
        fail(f"Could not load Blueprint class: {asset_path}")
    return asset_class


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


def point_to_local_vector(point, origin):
    absolute = point_to_vector(point)
    return unreal.Vector(
        absolute.x - origin.x,
        absolute.y - origin.y,
        absolute.z - origin.z,
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
    fail(f"No SplineComponent found on actor '{actor.get_actor_label()}'. Add one to the configured street Blueprint.")


def set_editor_property_if_present(obj, property_name, value):
    try:
        obj.set_editor_property(property_name, value)
        return True
    except Exception:
        return False


def configure_spline_component(spline_component, row, actor_origin):
    set_editor_property_if_present(spline_component, "override_construction_script", True)
    set_editor_property_if_present(spline_component, "input_spline_points_to_construction_script", False)
    spline_component.clear_spline_points(False)
    for point in row["Points"]:
        spline_component.add_spline_point(point_to_local_vector(point, actor_origin), unreal.SplineCoordinateSpace.LOCAL, False)
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
        "street_spline",
        str(row.get("SplineKey", "")),
        str(row.get("Street", "") or row.get("SplineKey", "")),
        str(row.get("Type", "")),
        str(row.get("OsmClass", "")),
        f"{float(row.get('WidthM', 0.0)):.2f}",
        str(int(row.get("OsmLayer", 0))),
        str(bool(row.get("bClosed", False))).lower(),
        str(bool(row.get("bBridge", False))).lower(),
        str(bool(row.get("bTunnel", False))).lower(),
    ]
    actor.tags = [unreal.Name(str(tag)) for tag in tags if str(tag)]


def create_street_spline_actor(actor_class, row):
    label = f"{ACTOR_LABEL_PREFIX}_{sanitize_label_part(row['SplineKey'])}"
    actor_origin = point_to_vector(row["Points"][0])
    actor = find_actor_by_label(label) if UPDATE_EXISTING_ACTORS else None
    if actor is None:
        actor = unreal.EditorLevelLibrary.spawn_actor_from_class(
            actor_class,
            actor_origin,
            unreal.Rotator(0.0, 0.0, 0.0),
        )
        if actor is None:
            fail(f"Failed to spawn actor '{label}'")
        actor.set_actor_label(label)
    else:
        actor.set_actor_location(actor_origin, False, False)
        actor.set_actor_rotation(unreal.Rotator(0.0, 0.0, 0.0), False)
    actor.set_actor_scale3d(unreal.Vector(1.0, 1.0, 1.0))
    spline_component = find_spline_component(actor)
    configure_spline_component(spline_component, row, actor_origin)
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
    actor = find_actor_by_label(label) if UPDATE_EXISTING_ACTORS else None
    if actor is None:
        actor = unreal.EditorLevelLibrary.spawn_actor_from_class(actor_class, location, rotation)
        if actor is None:
            fail(f"Failed to spawn actor '{label}'")
        actor.set_actor_label(label)
    else:
        actor.set_actor_location(location, False, False)
        actor.set_actor_rotation(rotation, False)
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
        unreal.Name(f"{float(row.get('X', 0.0)):.1f}"),
        unreal.Name(f"{float(row.get('Y', 0.0)):.1f}"),
        unreal.Name(f"{float(row.get('Z', 0.0)):.1f}"),
        unreal.Name(f"{float(row.get('WidthCm', 0.0)):.1f}"),
        unreal.Name(f"{float(row.get('DepthCm', 0.0)):.1f}"),
        unreal.Name(f"{float(row.get('HeightCm', 0.0)):.1f}"),
        unreal.Name(f"{float(row.get('YawDeg', 0.0)):.3f}"),
        unreal.Name(f"{float(row.get('CenterWgs84', {}).get('lat', 0.0)):.7f}"),
        unreal.Name(f"{float(row.get('CenterWgs84', {}).get('lon', 0.0)):.7f}"),
    ]
    return actor


def create_traffic_sign_actor(row):
    prefix = TRAFFIC_SIGNAL_ACTOR_LABEL_PREFIX if row.get("Kind") == "traffic_signal" else TRAFFIC_SIGN_ACTOR_LABEL_PREFIX
    label = f"{prefix}_{sanitize_label_part(row.get('SignKey', row.get('Name', 'Sign')))}"
    location = unreal.Vector(
        float(row["X"]) + WORLD_OFFSET_CM.x,
        float(row["Y"]) + WORLD_OFFSET_CM.y,
        float(row.get("Z", 0.0)) + WORLD_OFFSET_CM.z,
    )
    actor = find_actor_by_label(label) if UPDATE_EXISTING_ACTORS else None
    if actor is None:
        actor = unreal.EditorLevelLibrary.spawn_actor_from_class(
            unreal.Actor,
            location,
            unreal.Rotator(0.0, 0.0, 0.0),
        )
        if actor is None:
            fail(f"Failed to spawn actor '{label}'")
        actor.set_actor_label(label)
    else:
        actor.set_actor_location(location, False, False)
    actor.tags = [
        unreal.Name(str(row.get("Kind", "traffic_sign"))),
        unreal.Name(str(row.get("SignKey", ""))),
        unreal.Name(str(row.get("OsmId", ""))),
        unreal.Name(str(row.get("Name", ""))),
        unreal.Name(str(row.get("Type", ""))),
        unreal.Name(str(row.get("Direction", ""))),
        unreal.Name(f"{float(row.get('X', 0.0)):.1f}"),
        unreal.Name(f"{float(row.get('Y', 0.0)):.1f}"),
        unreal.Name(f"{float(row.get('Z', 0.0)):.1f}"),
        unreal.Name(f"{float(row.get('CenterWgs84', {}).get('lat', 0.0)):.7f}"),
        unreal.Name(f"{float(row.get('CenterWgs84', {}).get('lon', 0.0)):.7f}"),
    ]
    return actor


def main():
    actor_class = load_bp_class(STREET_BP_PATH) if STREET_SPLINES else None
    building_actor_class = load_bp_class(BUILDING_BP_PATH) if BUILDINGS else None
    unreal.log(f"[INFO] Area import origin WGS84: {EXPORT_META.get('origin_wgs84')}")
    if DELETE_BEFORE_IMPORT:
        destroy_existing_actor_with_prefix(f"{ACTOR_LABEL_PREFIX}_")
        destroy_existing_actor_with_prefix(f"{BUILDING_ACTOR_LABEL_PREFIX}_")
        destroy_existing_actor_with_prefix(f"{TRAFFIC_SIGN_ACTOR_LABEL_PREFIX}_")
        destroy_existing_actor_with_prefix(f"{TRAFFIC_SIGNAL_ACTOR_LABEL_PREFIX}_")
    point_count = 0
    for index, source_row in enumerate(STREET_SPLINES):
        row = require_spline(source_row, index)
        point_count += len(row["Points"])
        create_street_spline_actor(actor_class, row)
    for row in BUILDINGS:
        create_building_actor(building_actor_class, row)
    for row in TRAFFIC_SIGNS:
        create_traffic_sign_actor(row)
    unreal.log(f"[INFO] Imported {len(STREET_SPLINES)} street splines from {point_count} points, {len(BUILDINGS)} buildings and {len(TRAFFIC_SIGNS)} traffic signs")


main()
`;
}

function downloadTextFile(filename, content, type = "text/plain") {
  const blob = new Blob([content], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
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
    const payload = buildAreaPythonPayload();
    if (!payload) {
      setStatus("Keine sichtbaren Bereichsdaten fuer Unreal-Python-Export vorhanden.", true);
      return;
    }
    const streetBpPath = getStreetBpPathForExport();
    const buildingBpPath = getBuildingBpPathForExport();
    setStoredStreetBpPath(streetBpPath);
    setStoredBuildingBpPath(buildingBpPath);
    const code = buildCompactAreaUnrealPythonScript(payload, streetBpPath, buildingBpPath);
    showPythonCodeModal(code);
    const pointCount = payload.splines.reduce((sum, spline) => sum + spline.Points.length, 0);
    const signalCount = payload.traffic_signs.filter((item) => item.Kind === "traffic_signal").length;
    const signCount = payload.traffic_signs.length - signalCount;
    setStatus(`UE-Python-Code: ${payload.splines.length} Splines / ${pointCount} Punkte / ${payload.buildings.length} Gebaeude / ${signCount} Schilder / ${signalCount} Ampeln eingebettet`);
  } catch (error) {
    setStatus(`UE-Python-Export fehlgeschlagen: ${error.message}`, true);
  }
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

async function selectPostalCodeArea({ isAutomatic = false } = {}) {
  if (!isAutomatic && postalSearchTimer) {
    clearTimeout(postalSearchTimer);
    postalSearchTimer = null;
  }
  const value = document.getElementById("postal-code-input")?.value?.trim();
  if (!value) {
    if (isAutomatic) return;
    setStatus("PLZ oder Ort eingeben.", true);
    return;
  }
  if (isAutomatic && value.length < 3) return;
  if (isAutomatic && value === lastPostalSearchValue) return;
  lastPostalSearchValue = value;
  try {
    setStatus(`Suche ${value} ...`);
    const url = new URL(NOMINATIM_API_URL);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("limit", "1");
    url.searchParams.set("q", value);
    const response = await fetch(url.toString(), { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`Nominatim HTTP ${response.status}`);
    const results = await response.json();
    if (isAutomatic && document.getElementById("postal-code-input")?.value?.trim() !== value) return;
    const bounds = boundsFromNominatimResult(results?.[0]);
    if (!bounds) throw new Error("Kein Treffer mit gueltigem Bereich");
    setSelectedAreaBounds(bounds, true);
  } catch (error) {
    setStatus(`Ortssuche fehlgeschlagen: ${error.message}`, true);
  }
}

function schedulePostalCodeAreaSearch() {
  if (postalSearchTimer) clearTimeout(postalSearchTimer);
  const value = document.getElementById("postal-code-input")?.value?.trim() || "";
  if (value.length < 3) return;
  postalSearchTimer = window.setTimeout(() => {
    postalSearchTimer = null;
    selectPostalCodeArea({ isAutomatic: true });
  }, POSTAL_SEARCH_DEBOUNCE_MS);
}

document.getElementById("btn-area-select")?.addEventListener("click", () => setAreaSelectMode(!areaSelectMode));
document.getElementById("btn-area-load")?.addEventListener("click", () => importAreaFromOverpass());
document.getElementById("btn-export-area-python")?.addEventListener("click", exportAreaUnrealPython);
document.getElementById("btn-postal-code")?.addEventListener("click", () => selectPostalCodeArea());
document.getElementById("postal-code-input")?.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    selectPostalCodeArea();
  }
});
document.getElementById("postal-code-input")?.addEventListener("input", schedulePostalCodeAreaSearch);
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

document.querySelectorAll("[data-area-layer]").forEach((input) => {
  areaLayerVisibility.set(input.dataset.areaLayer, input.checked);
  input.addEventListener("change", () => {
    areaLayerVisibility.set(input.dataset.areaLayer, input.checked);
    if (!areaFeatures.length) return;
    renderAreaFeatures();
    if (input.checked && !areaFeatures.some((feature) => feature.category === input.dataset.areaLayer)) {
      setStatus(`${AREA_LAYER_LABELS[input.dataset.areaLayer]} ist in den geladenen Daten nicht enthalten. Mit aktivem Layer nochmal Overpass laden.`, true);
    }
  });
});

initStreetBpPathInput();
initBuildingBpPathInput();

map.getContainer().addEventListener("pointerdown", beginAreaSelection);

setStatus("Bereich ziehen oder Ort suchen, dann Overpass laden.");

