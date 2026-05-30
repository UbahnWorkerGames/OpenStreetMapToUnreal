"""
UE Transit Line Importer
Erzeugt fertige Line-BP aus BP_CityTest-Template + UEMap-Export-JSON.

Verwendung in UE:
  py "C:/Users/stefa/Documents/GitHub/UEMap/ue_import_transit_line.py" "C:/Users/stefa/Downloads/transit-line-subway-U2.json"

Ohne Pfad: sucht im Downloads-Ordner nach dem neuesten transit-line-*.json
"""
import json
import os
import re
import sys
import glob
import unreal

# ════════════════  KONFIG  ════════════════
TEMPLATE_BP_PATH  = "/Game/_UbahnWorkerGames/TEST/BP_CityTest"
OUTPUT_BASE_PATH  = "/Game/_UbahnWorkerGames/Transit"
DEFAULT_DOWNLOADS = os.path.expanduser("~/Downloads")
SPLINE_COMP_NAMES = ["StreetSpline", "Spline"]


def log(msg):
    unreal.log_warning(f"[TRANSIT] {msg}")


def fail(msg):
    unreal.log_error(f"[TRANSIT] {msg}")
    raise RuntimeError(msg)


# ════════════════  JSON LADEN  ════════════════

def find_latest_transit_json(directory):
    """Findet das neueste transit-line-*.json im Ordner"""
    pattern = os.path.join(directory, "transit-line-*.json")
    files = glob.glob(pattern)
    if not files:
        return None
    return max(files, key=os.path.getmtime)


def load_line_json(path=None):
    if path and os.path.isfile(path):
        log(f"Lade: {path}")
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)

    # Fallback: neuestes File im Downloads-Ordner
    latest = find_latest_transit_json(DEFAULT_DOWNLOADS)
    if latest:
        log(f"Lade (auto): {latest}")
        with open(latest, "r", encoding="utf-8") as f:
            return json.load(f)

    fail("Keine JSON-Datei gefunden. Pfad angeben oder transit-line-*.json in Downloads ablegen.")


# ════════════════  STATION-IMPORT  ════════════════

def fill_struct_template(template, values):
    """Ersetzt Felder nach Position (0=Key, 1=NameVal, 2=Dist, 3=WorldPos, 4=PlatformHalf, 5=Level)"""
    entries = re.findall(r'([\w]+?)=("[^"]*"|\([^)]*\)|[-\d.]+)', template)
    parts = []
    last_end = 0
    for idx, m in enumerate(re.finditer(r'([\w]+?)=("[^"]*"|\([^)]*\)|[-\d.]+)', template)):
        parts.append(template[last_end:m.start()])
        if idx in values:
            parts.append(f"{m.group(1)}={values[idx]}")
        else:
            parts.append(m.group(0))
        last_end = m.end()
    parts.append(template[last_end:])
    return "".join(parts)


def set_stations_data(cdo, stations):
    """Befüllt StationsData (Array<S_TransitStation>) via import_text"""
    arr = cdo.get_editor_property("StationsData")
    if arr is None:
        fail("StationsData-Variable nicht im BP gefunden.")

    arr.resize(len(stations))

    for i, st in enumerate(stations):
        name   = str(st.get("name", ""))
        key    = str(st.get("key", name))
        dist_m = float(st.get("dist_m", 0))
        pos    = st.get("location_cm", [0, 0, 0])
        half   = float(st.get("half_length_m", 20))
        level  = int(st.get("level", 0) or 0)

        template = arr[i].export_text()
        text = fill_struct_template(template, {
            0: f'"{key}"',                              # Key
            1: f'"{name}"',                             # NameVal
            2: str(dist_m),                             # DistAlongSpline
            3: f"(X={pos[0]}.0,Y={pos[1]}.0,Z={pos[2]}.0)",  # WorldPos
            4: str(half),                               # PlatformHalfLen
            5: str(level),                              # Level
        })
        elem = arr[i]
        elem.import_text(text)
        arr[i] = elem

    cdo.set_editor_property("StationsData", arr)
    log(f"  StationsData: {len(stations)} Stationen")


# ════════════════  SPLINE  ════════════════

def find_spline_component(actor_or_cdo):
    components = actor_or_cdo.get_components_by_class(unreal.SplineComponent)
    for name in SPLINE_COMP_NAMES:
        for comp in components:
            if comp.get_name() == name:
                return comp
    if components:
        return components[0]
    return None


def set_spline_points(cdo, route_points):
    spline = find_spline_component(cdo)
    if not spline:
        fail("Kein SplineComponent im BP gefunden.")

    spline.clear_spline_points(True)
    for pt in route_points:
        pos = pt.get("pos_cm", [0, 0, 0])
        vec = unreal.Vector(float(pos[0]), float(pos[1]), float(pos[2]))
        spline.add_spline_point(vec, unreal.SplineCoordinateSpace.LOCAL, True)

    log(f"  Spline: {len(route_points)} Punkte")


# ════════════════  HAUPTLOGIK  ════════════════

def main():
    # Pfad aus argv oder auto-find
    file_path = sys.argv[1] if len(sys.argv) > 1 else None
    data = load_line_json(file_path)

    ref         = data.get("ref", "?")
    route_mode  = data.get("route_mode", "subway")
    stations    = data.get("stations", [])
    route_pts   = data.get("route", {}).get("points", [])
    route_len_m = data.get("route", {}).get("total_length_m", 0)

    if not stations:
        fail("Keine Stationsdaten im Export.")
    if len(route_pts) < 2:
        fail("Zu wenige Route-Punkte.")

    log(f"Importiere {route_mode} {ref}: {len(stations)} Stationen, {route_len_m:.0f}m, {len(route_pts)} Spline-Punkte")

    # Output-Pfad
    output_path = f"{OUTPUT_BASE_PATH}/{route_mode.upper()}/{ref}/BP_{ref}"
    log(f"Ziel: {output_path}")

    # Überschreiben falls existiert
    if unreal.EditorAssetLibrary.does_asset_exist(output_path):
        log("  Existiert bereits → wird überschrieben")
        unreal.EditorAssetLibrary.delete_asset(output_path)

    # Template duplizieren
    unreal.EditorAssetLibrary.duplicate_asset(TEMPLATE_BP_PATH, output_path)
    log("  Template dupliziert")

    # BP laden → CDO setzen
    new_bp = unreal.load_asset(output_path)
    if not new_bp:
        fail(f"Konnte dupliziertes BP nicht laden: {output_path}")
    cdo = unreal.get_default_object(new_bp.generated_class())

    # Spline
    set_spline_points(cdo, route_pts)
    # Stations
    set_stations_data(cdo, stations)

    # Speichern
    unreal.EditorAssetLibrary.save_loaded_asset(new_bp)
    log(f"✓ Fertig: {output_path}")
    log("  → BP ins Level ziehen, fertig.")


if __name__ == "__main__":
    main()
