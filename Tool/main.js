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
};

const AREA_LAYER_LABELS = {
  motorway: "Autobahn",
  major_road: "Hauptstrasse",
  city_road: "Stadtstrasse",
  service: "Service",
  rail_tram: "Tram",
  rail_train: "Zug",
  rail_subway: "Subway",
};

const AREA_SIMPLIFY_TOLERANCE_M = 3;
const AREA_LARGE_REQUEST_KM2 = 25;
const AREA_MAX_REQUEST_KM2 = 100;
const AREA_EXPENSIVE_LAYERS = new Set(["city_road", "service"]);
const DEFAULT_STREET_BP_PATH = "/Game/_UbahnWorkerGames/TEST/BP_CityTest.BP_CityTest";
const STREET_BP_PATH_STORAGE_KEY = "osm-to-unreal.streetBpPath";

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
let areaDraftRect = null;
let areaFeatures = [];
let areaCache = null;
let latestAreaPythonScript = "";

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
    default:
      return 5;
  }
}

function buildAreaFeatures(data) {
  const features = [];
  const seen = new Set();
  for (const el of data.elements || []) {
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

function renderAreaFeatures() {
  areaProcessedLayer.clearLayers();
  const counts = new Map(Object.keys(AREA_LAYER_LABELS).map((key) => [key, 0]));
  let visibleCount = 0;
  for (const feature of areaFeatures) {
    counts.set(feature.category, (counts.get(feature.category) || 0) + 1);
    if (!areaLayerVisibility.get(feature.category)) continue;
    visibleCount += 1;
    const style = AREA_STYLE[feature.category];
    const line = L.polyline(feature.controlGeometry, {
      color: style.color,
      weight: style.weight,
      opacity: 0.9,
      lineCap: "round",
      lineJoin: "round",
    }).addTo(areaProcessedLayer);
    const roadType = feature.tags.highway || feature.tags.railway || "";
    line.bindTooltip(`${AREA_LAYER_LABELS[feature.category]}: ${feature.name} (${roadType})`, { sticky: true });
  }

  const summary = [...counts.entries()]
    .filter(([key, count]) => count > 0 && areaLayerVisibility.get(key))
    .map(([key, count]) => `${AREA_LAYER_LABELS[key]} ${count}`)
    .join(" · ");
  setStatus(`Bereich geladen: ${visibleCount}/${areaFeatures.length} Splines sichtbar${summary ? ` · ${summary}` : ""}`);
}

function setAreaSelectMode(active) {
  areaSelectMode = active;
  document.getElementById("btn-area-select")?.classList.toggle("active", active);
  map.getContainer().style.cursor = active ? "crosshair" : "";
}

function beginAreaSelection(event) {
  if (!areaSelectMode) return;
  areaDragStart = event.latlng;
  if (areaDraftRect) areaDraftRect.remove();
  areaDraftRect = L.rectangle([areaDragStart, areaDragStart], {
    color: "#16a34a",
    weight: 1,
    dashArray: "4 4",
  }).addTo(map);
}

function updateAreaSelection(event) {
  if (!areaSelectMode || !areaDragStart || !areaDraftRect) return;
  areaDraftRect.setBounds(L.latLngBounds(areaDragStart, event.latlng));
}

function finishAreaSelection(event) {
  if (!areaSelectMode || !areaDragStart) return;
  const bounds = L.latLngBounds(areaDragStart, event.latlng);
  areaDragStart = null;
  if (areaDraftRect) {
    areaDraftRect.remove();
    areaDraftRect = null;
  }
  if (!bounds.isValid()) return;
  areaSelectionBounds = bounds;
  if (areaSelectionRect) areaSelectionRect.remove();
  areaSelectionRect = L.rectangle(bounds, {
    color: "#16a34a",
    weight: 2,
    fillOpacity: 0.04,
  }).addTo(map);
  setAreaSelectMode(false);
  setStatus(`Bereich gewaehlt (${areaBoundsSizeKm2(bounds).toFixed(2)} km²).`);
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
    (feature) => areaLayerVisibility.get(feature.category) && Array.isArray(feature.controlGeometry) && feature.controlGeometry.length >= 2,
  );
  if (!selected.length) return null;

  const [lat0, lon0] = selected[0].controlGeometry[0];
  const metersPerDegreeLat = 111320;
  const metersPerDegreeLon = 111320 * Math.cos((lat0 * Math.PI) / 180);
  const toPointCm = ([lat, lon]) => ({
    X: +(((lon - lon0) * metersPerDegreeLon * 100).toFixed(1)),
    Y: +(((lat - lat0) * metersPerDegreeLat * 100).toFixed(1)),
    Z: 0,
  });

  const rows = [];
  for (const feature of selected) {
    const points = feature.controlGeometry.map(toPointCm);
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
  const rows = buildAreaPcgRows();
  if (!rows) return null;
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

function buildCompactAreaUnrealPythonScript(splines, streetBpPath) {
  const jsonLiteral = JSON.stringify(JSON.stringify(splines));
  const bpPathLiteral = JSON.stringify(streetBpPath);
  return `import json
import re

import unreal


STREET_SPLINES = json.loads(${jsonLiteral})
STREET_BP_PATH = ${bpPathLiteral}
ACTOR_LABEL_PREFIX = "CITY_STREET"
SPLINE_COMPONENT_NAMES = ["StreetSpline", "Spline"]
WORLD_OFFSET_CM = unreal.Vector(0.0, 0.0, 0.0)
FORCE_ZERO_Z = True
LINEAR_SPLINES = True


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
    fail(f"No SplineComponent found on actor '{actor.get_actor_label()}'. Add one to the configured street Blueprint.")


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


def main():
    actor_class = load_bp_class(STREET_BP_PATH)
    destroy_existing_actor_with_prefix(f"{ACTOR_LABEL_PREFIX}_")
    point_count = 0
    for index, source_row in enumerate(STREET_SPLINES):
        row = require_spline(source_row, index)
        point_count += len(row["Points"])
        create_street_spline_actor(actor_class, row)
    unreal.log(f"[INFO] Imported {len(STREET_SPLINES)} city street splines from {point_count} points")


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
    const payload = buildAreaPythonSplineData();
    if (!payload) {
      setStatus("Keine sichtbaren Bereichsdaten fuer Unreal-Python-Export vorhanden.", true);
      return;
    }
    const streetBpPath = getStreetBpPathForExport();
    setStoredStreetBpPath(streetBpPath);
    const code = buildCompactAreaUnrealPythonScript(payload, streetBpPath);
    showPythonCodeModal(code);
    const pointCount = payload.reduce((sum, spline) => sum + spline.Points.length, 0);
    setStatus(`UE-Python-Code: ${payload.length} Splines / ${pointCount} Punkte eingebettet`);
  } catch (error) {
    setStatus(`UE-Python-Export fehlgeschlagen: ${error.message}`, true);
  }
}

function exportAreaPcgJson() {
  try {
    const payload = buildAreaPcgRows();
    if (!payload) {
      setStatus("Keine sichtbaren Bereichsdaten fuer PCG-Export vorhanden.", true);
      return;
    }
    downloadTextFile("ue-pcg-area-splines.json", JSON.stringify(payload, null, 2), "application/json");
    setStatus(`PCG-Export: ${payload.length} DataTable-Zeilen`);
  } catch (error) {
    setStatus(`PCG-Export fehlgeschlagen: ${error.message}`, true);
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

async function selectPostalCodeArea() {
  const value = document.getElementById("postal-code-input")?.value?.trim();
  if (!value) {
    setStatus("PLZ oder Ort eingeben.", true);
    return;
  }
  try {
    setStatus(`Suche ${value} ...`);
    const url = new URL(NOMINATIM_API_URL);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("limit", "1");
    url.searchParams.set("q", value);
    const response = await fetch(url.toString(), { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`Nominatim HTTP ${response.status}`);
    const results = await response.json();
    const bounds = boundsFromNominatimResult(results?.[0]);
    if (!bounds) throw new Error("Kein gueltiges Suchergebnis");
    areaSelectionBounds = bounds;
    if (areaSelectionRect) areaSelectionRect.remove();
    areaSelectionRect = L.rectangle(bounds, { color: "#16a34a", weight: 2, fillOpacity: 0.04 }).addTo(map);
    map.fitBounds(bounds, { padding: [48, 48], maxZoom: 14 });
    setStatus(`Bereich gewaehlt (${areaBoundsSizeKm2(bounds).toFixed(2)} km²).`);
  } catch (error) {
    setStatus(`Ortssuche fehlgeschlagen: ${error.message}`, true);
  }
}

document.getElementById("btn-area-select")?.addEventListener("click", () => setAreaSelectMode(!areaSelectMode));
document.getElementById("btn-area-load")?.addEventListener("click", () => importAreaFromOverpass());
document.getElementById("btn-export-area-python")?.addEventListener("click", exportAreaUnrealPython);
document.getElementById("btn-export-pcg")?.addEventListener("click", exportAreaPcgJson);
document.getElementById("btn-postal-code")?.addEventListener("click", selectPostalCodeArea);
document.getElementById("postal-code-input")?.addEventListener("keydown", (event) => {
  if (event.key === "Enter") selectPostalCodeArea();
});
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
    if (areaFeatures.length) renderAreaFeatures();
  });
});

initStreetBpPathInput();

map.on("mousedown", beginAreaSelection);
map.on("mousemove", updateAreaSelection);
map.on("mouseup", finishAreaSelection);

setStatus("Bereich ziehen oder Ort suchen, dann Overpass laden.");
