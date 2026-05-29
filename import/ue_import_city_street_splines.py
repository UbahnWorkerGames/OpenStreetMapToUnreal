import json
import re
from pathlib import Path

import unreal


UB_SCRIPT_DIR = Path(__file__).resolve().parent
UB_SOURCE_JSON_PATH = UB_SCRIPT_DIR / "ue-pcg-area-splines.json"

UB_ACTOR_LABEL_PREFIX = "CITY_STREET"
UB_SPLINE_COMPONENT_NAME = "StreetSpline"
UB_WORLD_OFFSET_CM = unreal.Vector(0.0, 0.0, 0.0)
UB_FORCE_ZERO_Z = True
UB_LINEAR_SPLINES = True


def log(level: str, message: str) -> None:
    unreal.log(f"[{level}] {message}")


def fail(message: str) -> None:
    unreal.log_error(message)
    raise RuntimeError(message)


def load_json_array(path_value: Path | str) -> list[dict]:
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


def destroy_existing_actor_with_prefix(prefix: str) -> None:
    for actor in unreal.EditorLevelLibrary.get_all_level_actors():
        if actor.get_actor_label().startswith(prefix):
            unreal.EditorLevelLibrary.destroy_actor(actor)


def set_editor_property_if_present(obj, property_name: str, value) -> bool:
    try:
        obj.set_editor_property(property_name, value)
        return True
    except Exception:
        return False


def require_key(row: dict, key: str, row_index: int):
    if key not in row:
        fail(f"Row {row_index} is missing required key '{key}': {row}")
    return row[key]


def require_string(row: dict, key: str, row_index: int) -> str:
    value = require_key(row, key, row_index)
    if not isinstance(value, str) or not value:
        fail(f"Row {row_index} key '{key}' must be a non-empty string")
    return value


def require_int(row: dict, key: str, row_index: int) -> int:
    value = require_key(row, key, row_index)
    if isinstance(value, bool) or not isinstance(value, int):
        fail(f"Row {row_index} key '{key}' must be an integer")
    return value


def require_bool(row: dict, key: str, row_index: int) -> bool:
    value = require_key(row, key, row_index)
    if not isinstance(value, bool):
        fail(f"Row {row_index} key '{key}' must be a bool")
    return value


def require_number(row: dict, key: str, row_index: int) -> float:
    value = require_key(row, key, row_index)
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        fail(f"Row {row_index} key '{key}' must be numeric")
    return float(value)


def validate_row(row: dict, row_index: int) -> dict:
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


def group_rows(rows: list[dict]) -> dict[str, list[dict]]:
    groups = {}
    for row_index, row in enumerate(rows):
        validated = validate_row(row, row_index)
        groups.setdefault(validated["SplineKey"], []).append(validated)
    if not groups:
        fail("No street spline rows found")
    return groups


def validate_group(spline_key: str, rows: list[dict]) -> list[dict]:
    point_counts = {row["PointCount"] for row in rows}
    if len(point_counts) != 1:
        fail(f"Spline '{spline_key}' has inconsistent PointCount values: {sorted(point_counts)}")

    point_count = point_counts.pop()
    if point_count != len(rows):
        fail(f"Spline '{spline_key}' declares PointCount={point_count}, but has {len(rows)} rows")

    if point_count < 2:
        fail(f"Spline '{spline_key}' needs at least 2 points")

    sorted_rows = sorted(rows, key=lambda row: row["PointIndex"])
    expected_indices = list(range(point_count))
    actual_indices = [row["PointIndex"] for row in sorted_rows]
    if actual_indices != expected_indices:
        fail(f"Spline '{spline_key}' has invalid PointIndex sequence: {actual_indices}")

    return sorted_rows


def sanitize_label_part(value: str) -> str:
    sanitized = re.sub(r"[^A-Za-z0-9_]+", "_", value).strip("_")
    return sanitized or "Unnamed"


def point_to_vector(row: dict) -> unreal.Vector:
    return unreal.Vector(
        row["X"] + UB_WORLD_OFFSET_CM.x,
        row["Y"] + UB_WORLD_OFFSET_CM.y,
        (0.0 if UB_FORCE_ZERO_Z else row["Z"]) + UB_WORLD_OFFSET_CM.z,
    )


def row_to_local_vector(row: dict, origin: unreal.Vector) -> unreal.Vector:
    world = point_to_vector(row)
    return unreal.Vector(world.x - origin.x, world.y - origin.y, world.z - origin.z)


def spawn_empty_actor(label: str, location: unreal.Vector) -> unreal.Actor:
    actor = unreal.EditorLevelLibrary.spawn_actor_from_class(
        unreal.Actor,
        location,
        unreal.Rotator(0.0, 0.0, 0.0),
    )
    if actor is None:
        fail(f"Failed to spawn actor '{label}'")
    actor.set_actor_label(label)
    return actor


def add_spline_component(actor: unreal.Actor):
    if not hasattr(actor, "add_component_by_class"):
        fail(
            "This Unreal Python build does not expose Actor.add_component_by_class. "
            "Create a BP with a SplineComponent and adapt the script to spawn that BP."
        )

    component = actor.add_component_by_class(
        unreal.SplineComponent,
        False,
        unreal.Transform(),
        False,
    )
    if component is None:
        fail(f"Failed to add SplineComponent to actor '{actor.get_actor_label()}'")

    component.set_editor_property("component_tags", [unreal.Name("CityStreetSpline")])
    component.rename(UB_SPLINE_COMPONENT_NAME)
    return component


def configure_spline_component(spline_component, rows: list[dict], actor_location: unreal.Vector) -> None:
    set_editor_property_if_present(spline_component, "override_construction_script", True)
    set_editor_property_if_present(spline_component, "input_spline_points_to_construction_script", False)

    spline_component.clear_spline_points(False)
    for row in rows:
        spline_component.add_spline_point(row_to_local_vector(row, actor_location), unreal.SplineCoordinateSpace.LOCAL, False)

    for index in range(len(rows)):
        point_type = unreal.SplinePointType.LINEAR if UB_LINEAR_SPLINES else unreal.SplinePointType.CURVE
        spline_component.set_spline_point_type(index, point_type, False)

    if hasattr(spline_component, "set_closed_loop"):
        spline_component.set_closed_loop(bool(rows[0]["bClosed"]), False)
    elif bool(rows[0]["bClosed"]):
        fail("SplineComponent does not expose set_closed_loop, but the source spline is closed")

    spline_component.update_spline()


def set_actor_tags(actor: unreal.Actor, rows: list[dict]) -> None:
    first = rows[0]
    tags = [
        "CityStreet",
        first["SplineKey"],
        first["Type"],
        first["Shape"],
        first["OsmClass"],
    ]
    if first["Street"]:
        tags.append(first["Street"])
    if first["bBridge"]:
        tags.append("Bridge")
    if first["bTunnel"]:
        tags.append("Tunnel")
    actor.tags = [unreal.Name(str(tag)) for tag in tags if str(tag)]


def create_street_spline_actor(spline_key: str, rows: list[dict]) -> unreal.Actor:
    sorted_rows = validate_group(spline_key, rows)
    label = f"{UB_ACTOR_LABEL_PREFIX}_{sanitize_label_part(spline_key)}"
    actor_location = point_to_vector(sorted_rows[0])
    actor = spawn_empty_actor(label, actor_location)
    spline_component = add_spline_component(actor)
    configure_spline_component(spline_component, sorted_rows, actor_location)
    set_actor_tags(actor, sorted_rows)
    return actor


def main() -> None:
    log("INFO", f"Loading city street spline rows from {UB_SOURCE_JSON_PATH}")
    rows = load_json_array(UB_SOURCE_JSON_PATH)
    groups = group_rows(rows)

    destroy_existing_actor_with_prefix(f"{UB_ACTOR_LABEL_PREFIX}_")

    created = 0
    for spline_key, group in groups.items():
        create_street_spline_actor(spline_key, group)
        created += 1

    log("INFO", f"Imported {created} city street splines from {len(rows)} point rows")


if __name__ == "__main__":
    main()
