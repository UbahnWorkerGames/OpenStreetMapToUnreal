import json
import re
from pathlib import Path

import unreal


SCRIPT_DIR = Path(__file__).resolve().parent if "__file__" in globals() else Path.cwd()

# Put an exported PCG JSON next to this script, or change this path.
SOURCE_JSON_PATH = SCRIPT_DIR / "ue-pcg-area-splines.json"

STREET_BP_PATH = "/Game/_UbahnWorkerGames/TEST/BP_CityTest.BP_CityTest"
ACTOR_LABEL_PREFIX = "CITY_STREET"
SPLINE_COMPONENT_NAMES = ["StreetSpline", "Spline"]
WORLD_OFFSET_CM = unreal.Vector(0.0, 0.0, 0.0)
FORCE_ZERO_Z = True
LINEAR_SPLINES = True


def fail(message):
    unreal.log_error(message)
    raise RuntimeError(message)


def load_json_array(path_value):
    path = Path(path_value)
    if not path.is_file():
        fail(f"JSON file not found: {path}")
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        fail(f"Invalid JSON in {path}: {exc}")
    if not isinstance(data, list):
        fail(f"Expected a JSON array in {path}")
    return data


def load_bp_class(asset_path):
    asset_class = unreal.EditorAssetLibrary.load_blueprint_class(asset_path)
    if asset_class is None:
        fail(f"Could not load Blueprint class: {asset_path}")
    return asset_class


def destroy_existing_actor_with_prefix(prefix):
    for actor in unreal.EditorLevelLibrary.get_all_level_actors():
        if actor.get_actor_label().startswith(prefix):
            unreal.EditorLevelLibrary.destroy_actor(actor)


def sanitize_label_part(value):
    sanitized = re.sub(r"[^A-Za-z0-9_]+", "_", str(value)).strip("_")
    return sanitized or "Unnamed"


def require_number(value, context):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        fail(f"{context} must be numeric, got {value!r}")
    return float(value)


def require_int(value, context):
    if isinstance(value, bool) or not isinstance(value, int):
        fail(f"{context} must be an integer, got {value!r}")
    return value


def require_string(value, context):
    if not isinstance(value, str) or not value:
        fail(f"{context} must be a non-empty string")
    return value


def compact_splines_from_flat_rows(rows):
    grouped = {}
    for row_index, row in enumerate(rows):
        if not isinstance(row, dict):
            fail(f"Row {row_index} must be an object")

        spline_key = require_string(row.get("SplineKey"), f"Row {row_index}.SplineKey")
        point_index = require_int(row.get("PointIndex"), f"Row {row_index}.PointIndex")
        point_count = require_int(row.get("PointCount"), f"Row {row_index}.PointCount")
        x = require_number(row.get("X"), f"Row {row_index}.X")
        y = require_number(row.get("Y"), f"Row {row_index}.Y")
        z = require_number(row.get("Z"), f"Row {row_index}.Z")

        if spline_key not in grouped:
            grouped[spline_key] = {
                "SplineKey": spline_key,
                "Type": str(row.get("Type", "")),
                "Shape": str(row.get("Shape", "")),
                "Street": str(row.get("Street", "")),
                "OsmClass": str(row.get("OsmClass", "")),
                "WidthM": float(row.get("WidthM", 0.0) or 0.0),
                "bBridge": bool(row.get("bBridge", False)),
                "bTunnel": bool(row.get("bTunnel", False)),
                "OsmLayer": int(row.get("OsmLayer", 0) or 0),
                "bClosed": bool(row.get("bClosed", False)),
                "PointCount": point_count,
                "Points": [None] * point_count,
            }

        target = grouped[spline_key]
        if target["PointCount"] != point_count:
            fail(f"Spline '{spline_key}' has inconsistent PointCount values")
        if point_index < 0 or point_index >= point_count:
            fail(f"Spline '{spline_key}' has invalid PointIndex {point_index}")
        if target["Points"][point_index] is not None:
            fail(f"Spline '{spline_key}' has duplicate PointIndex {point_index}")
        target["Points"][point_index] = [x, y, z]

    splines = []
    for spline_key, row in grouped.items():
        if any(point is None for point in row["Points"]):
            fail(f"Spline '{spline_key}' has missing point rows")
        del row["PointCount"]
        splines.append(row)
    return splines


def normalize_source_rows(rows):
    if not rows:
        fail("Source JSON has no rows")
    first = rows[0]
    if isinstance(first, dict) and isinstance(first.get("Points"), list):
        return rows
    if isinstance(first, dict) and "PointIndex" in first and "X" in first:
        return compact_splines_from_flat_rows(rows)
    fail("Unsupported JSON format. Expected compact splines with Points or flat PCG point rows.")


def point_to_vector(point):
    if not isinstance(point, list) or len(point) != 3:
        fail(f"Invalid point: {point}")
    x = require_number(point[0], "Point.X")
    y = require_number(point[1], "Point.Y")
    z = require_number(point[2], "Point.Z")
    return unreal.Vector(
        x + WORLD_OFFSET_CM.x,
        y + WORLD_OFFSET_CM.y,
        (0.0 if FORCE_ZERO_Z else z) + WORLD_OFFSET_CM.z,
    )


def require_spline(row, index):
    if not isinstance(row, dict):
        fail(f"Spline {index} must be an object")
    key = require_string(row.get("SplineKey"), f"Spline {index}.SplineKey")
    points = row.get("Points")
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
        f"Breite:{float(row.get('WidthM', 0.0) or 0.0):.2f}",
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
    rows = load_json_array(SOURCE_JSON_PATH)
    splines = normalize_source_rows(rows)
    actor_class = load_bp_class(STREET_BP_PATH)

    destroy_existing_actor_with_prefix(f"{ACTOR_LABEL_PREFIX}_")

    point_count = 0
    for index, source_row in enumerate(splines):
        row = require_spline(source_row, index)
        point_count += len(row["Points"])
        create_street_spline_actor(actor_class, row)

    unreal.log(f"[INFO] Imported {len(splines)} city street splines from {point_count} points")


if __name__ == "__main__":
    main()
