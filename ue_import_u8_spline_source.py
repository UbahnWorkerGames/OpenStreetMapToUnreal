import json
import math
import re
from pathlib import Path

import unreal


UB_SCRIPT_DIR = Path(__file__).resolve().parent
UB_SOURCE_JSON_GLOB = "*.json"

UB_ROUTE_BP_PATH = "/Game/_UbahnWorkerGames/Blueprint/TrainElements/BP_Rail.BP_Rail"
UB_STATION_BP_PATH = "/Game/_UbahnWorkerGames/Blueprint/BahnHofModular/BP_StationTrigger.BP_StationTrigger"

UB_ROUTE_SPLINE_COMPONENT_NAME = "Spline"

UB_FORCE_ZERO_Z = True
UB_SPAWN_STATIONS = True
# The BP_StationTrigger actor has its long axis (and Arrow_Start/End) along local Y.
# Rotate -90° so local Y aligns with the spline tangent. Adjust if BP changes.
UB_STATION_ACTOR_YAW_OFFSET_DEG = -90.0

# Verschiebung aller Stationen entlang der Spline (positiv = Richtung Routenende).
# 0 = kein Offset. 300 = 3 m weiter Richtung Süd/Ende bei der U8.
UB_STATION_DIST_OFFSET_CM: float = 15.0

# Laufzeit-Weltoffset – wird automatisch aus den JSON-Ursprüngen berechnet.
_UB_WORLD_OFFSET_CM = unreal.Vector(0.0, 0.0, 0.0)


def log(level: str, message: str) -> None:
    unreal.log(f"[{level}] {message}")


def fail(message: str) -> None:
    unreal.log_error(message)
    raise RuntimeError(message)


def load_json_object(path_value: Path | str) -> dict:
    path = Path(path_value)
    if not path.is_file():
        fail(f"JSON file not found: {path}")

    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        fail(f"Invalid JSON in {path}: {exc}")

    if not isinstance(data, dict):
        fail(f"Expected a JSON object in {path}")
    return data


def find_source_json_files() -> list[Path]:
    source_files = sorted(path for path in UB_SCRIPT_DIR.glob(UB_SOURCE_JSON_GLOB) if path.is_file())
    if not source_files:
        fail(f"No JSON files found in {UB_SCRIPT_DIR}")
    return source_files


def build_import_labels(source_path: Path) -> tuple[str, str]:
    source_key = source_path.stem
    if not source_key:
        fail(f"JSON file has no usable stem: {source_path}")

    # Actor-Label-Schema: BP_{stem}_Route  /  BP_{stem}_S_{StationName}
    route_label = f"BP_{source_key}_Route"
    station_label_prefix = f"BP_{source_key}_S_"
    return route_label, station_label_prefix


def load_bp_class(asset_path: str):
    asset_class = unreal.EditorAssetLibrary.load_blueprint_class(asset_path)
    if asset_class is None:
        fail(f"Could not load Blueprint class: {asset_path}")
    return asset_class


def find_component_by_name(actor: unreal.Actor, component_name: str):
    for component in actor.get_components_by_class(unreal.ActorComponent):
        if component.get_name() == component_name:
            return component
    fail(f"Component '{component_name}' not found on actor '{actor.get_name()}'")


def find_first_existing_component(actor: unreal.Actor, component_names: list[str]):
    for component_name in component_names:
        for component in actor.get_components_by_class(unreal.ActorComponent):
            if component.get_name() == component_name:
                return component
    fail(
        f"None of the expected components were found on actor '{actor.get_name()}': {component_names}"
    )


def destroy_existing_actor_with_label(label: str) -> None:
    for actor in unreal.EditorLevelLibrary.get_all_level_actors():
        if actor.get_actor_label() == label:
            unreal.EditorLevelLibrary.destroy_actor(actor)


def destroy_existing_actor_with_prefix(prefix: str) -> None:
    for actor in unreal.EditorLevelLibrary.get_all_level_actors():
        if actor.get_actor_label().startswith(prefix):
            unreal.EditorLevelLibrary.destroy_actor(actor)


def actor_has_tags(actor: unreal.Actor, required_tags: list[str]) -> bool:
    actor_tag_names = {str(tag) for tag in actor.tags}
    return all(tag in actor_tag_names for tag in required_tags)


def destroy_existing_actors_with_tags(required_tags: list[str]) -> None:
    for actor in unreal.EditorLevelLibrary.get_all_level_actors():
        if actor_has_tags(actor, required_tags):
            unreal.EditorLevelLibrary.destroy_actor(actor)


def spawn_actor(actor_class, location: unreal.Vector, rotation: unreal.Rotator, label: str):
    destroy_existing_actor_with_label(label)
    actor = unreal.EditorLevelLibrary.spawn_actor_from_class(actor_class, location, rotation)
    if actor is None:
        fail(f"Failed to spawn actor '{label}'")
    actor.set_actor_label(label)
    return actor


def set_actor_tags(actor: unreal.Actor, tags: list[str]) -> None:
    actor.tags = [unreal.Name(tag) for tag in tags]


def set_editor_property_if_present(obj, property_name: str, value) -> bool:
    try:
        obj.set_editor_property(property_name, value)
        return True
    except Exception:
        return False


def validate_source_data(source_data: dict) -> None:
    if "spline" not in source_data:
        fail("Source JSON is missing 'spline'")
    if "route" not in source_data:
        fail("Source JSON is missing 'route'")
    if "stations" not in source_data:
        fail("Source JSON is missing 'stations'")
    if "sections" not in source_data:
        fail("Source JSON is missing 'sections'")

    coordinate_system = source_data.get("coordinate_system")
    if coordinate_system is not None and not isinstance(coordinate_system, dict):
        fail("'coordinate_system' must be an object when present")

    spline_data = source_data["spline"]
    if not isinstance(spline_data, dict):
        fail("'spline' must be an object")
    if spline_data.get("type") not in {"catmull_rom_control_points", "final_route"}:
        fail("Unsupported spline source type")

    control_points = spline_data.get("control_points")
    if not isinstance(control_points, list) or len(control_points) < 2:
        fail("'spline.control_points' must contain at least 2 points")

    for index, point in enumerate(control_points):
        if not isinstance(point, dict):
            fail(f"spline.control_points[{index}] must be an object")
        for key in ("location", "arrive_tangent", "leave_tangent"):
            value = point.get(key)
            if not isinstance(value, list) or len(value) != 3:
                fail(f"spline.control_points[{index}].{key} must be a 3-element array")

    for key in ("stations", "sections"):
        value = source_data[key]
        if not isinstance(value, list):
            fail(f"'{key}' must be an array")

    route_data = source_data["route"]
    if not isinstance(route_data, dict):
        fail("'route' must be an object")
    if route_data.get("type") != "final_web_route":
        fail("Only 'final_web_route' route sources are supported")

    route_points = route_data.get("points")
    if not isinstance(route_points, list) or len(route_points) < 2:
        fail("'route.points' must contain at least 2 points")

    for index, point in enumerate(route_points):
        if not isinstance(point, dict):
            fail(f"route.points[{index}] must be an object")
        position = point.get("pos_cm")
        if not isinstance(position, list) or len(position) != 3:
            fail(f"route.points[{index}].pos_cm must be a 3-element array")
        if "dist_m" in point and not isinstance(point["dist_m"], (int, float)):
            fail(f"route.points[{index}].dist_m must be numeric when present")

def normalize_degrees(value: float) -> float:
    normalized = (value + 180.0) % 360.0 - 180.0
    if normalized == -180.0:
        return 180.0
    return normalized


def route_point_to_ue_vector(route_point: dict, source_data: dict) -> unreal.Vector:
    position_cm = route_point.get("pos_cm")
    if not isinstance(position_cm, list) or len(position_cm) != 3:
        fail("Route point is missing 'pos_cm'")
    return vector_from_xyz(position_cm)


def transform_xyz_to_ue(values: list[float], force_zero_z: bool = False) -> unreal.Vector:
    if len(values) != 3:
        fail(f"Expected 3 values for vector, got {len(values)}")

    # The export tool (main.js / toUEcm) already bakes the correct UE axis convention:
    #   X = -NorthDelta = SouthDelta  (UE forward = geographic South in this rotated level)
    #   Y = -EastDelta  = WestDelta   (UE right   = geographic West)
    # No further transforms required here — pass values through unchanged.
    x_value = float(values[0])
    y_value = float(values[1])
    z_value = 0.0 if (force_zero_z or UB_FORCE_ZERO_Z) else float(values[2])

    return unreal.Vector(
        x_value + _UB_WORLD_OFFSET_CM.x,
        y_value + _UB_WORLD_OFFSET_CM.y,
        z_value + _UB_WORLD_OFFSET_CM.z,
    )


def vector_from_xyz(values: list[float]) -> unreal.Vector:
    return transform_xyz_to_ue(values)


def tangent_from_xyz(values: list[float]) -> unreal.Vector:
    return transform_xyz_to_ue(values, force_zero_z=True)


def point_is_in_platform_section(distance_m: float, section_rows: list[dict]) -> bool:
    for section in section_rows:
        if section.get("type") != "platform":
            continue
        start_m = float(section["from_m"])
        end_m = float(section["to_m"])
        if start_m <= distance_m <= end_m:
            return True
    return False


def point_tangent_from_route(route_points: list[dict], index: int, source_data: dict) -> unreal.Vector:
    current = route_point_to_ue_vector(route_points[index], source_data)
    if index <= 0:
        nxt = route_point_to_ue_vector(route_points[index + 1], source_data)
        return unreal.Vector(nxt.x - current.x, nxt.y - current.y, nxt.z - current.z)
    if index >= len(route_points) - 1:
        prev = route_point_to_ue_vector(route_points[index - 1], source_data)
        return unreal.Vector(current.x - prev.x, current.y - prev.y, current.z - prev.z)

    prev = route_point_to_ue_vector(route_points[index - 1], source_data)
    nxt = route_point_to_ue_vector(route_points[index + 1], source_data)
    return unreal.Vector((nxt.x - prev.x) * 0.5, (nxt.y - prev.y) * 0.5, (nxt.z - prev.z) * 0.5)


def set_spline_point_tangent(spline_component, index: int, tangent: unreal.Vector) -> None:
    if hasattr(spline_component, "set_tangent_at_spline_point"):
        spline_component.set_tangent_at_spline_point(index, tangent, unreal.SplineCoordinateSpace.LOCAL, False)
        return
    if hasattr(spline_component, "set_arrive_tangent_at_spline_point"):
        spline_component.set_arrive_tangent_at_spline_point(
            index, tangent, unreal.SplineCoordinateSpace.LOCAL, False
        )
    if hasattr(spline_component, "set_leave_tangent_at_spline_point"):
        spline_component.set_leave_tangent_at_spline_point(
            index, tangent, unreal.SplineCoordinateSpace.LOCAL, False
        )


def configure_spline_component_from_source(spline_component, source_data: dict) -> None:
    route_points = source_data["route"]["points"]
    route_vectors = [route_point_to_ue_vector(point_data, source_data) for point_data in route_points]

    set_editor_property_if_present(spline_component, "override_construction_script", True)
    set_editor_property_if_present(spline_component, "input_spline_points_to_construction_script", False)
    spline_component.clear_spline_points(False)

    for location in route_vectors:
        spline_component.add_spline_point(location, unreal.SplineCoordinateSpace.LOCAL, False)

    for index in range(len(route_vectors)):
        prev_point = route_vectors[max(0, index - 1)]
        next_point = route_vectors[min(len(route_vectors) - 1, index + 1)]
        arrive_tangent = unreal.Vector(
            (route_vectors[index].x - prev_point.x) * 0.5,
            (route_vectors[index].y - prev_point.y) * 0.5,
            (route_vectors[index].z - prev_point.z) * 0.5,
        )
        leave_tangent = unreal.Vector(
            (next_point.x - route_vectors[index].x) * 0.5,
            (next_point.y - route_vectors[index].y) * 0.5,
            (next_point.z - route_vectors[index].z) * 0.5,
        )
        spline_component.set_spline_point_type(index, unreal.SplinePointType.CURVE, False)
        if hasattr(spline_component, "set_tangents_at_spline_point"):
            spline_component.set_tangents_at_spline_point(
                index,
                arrive_tangent,
                leave_tangent,
                unreal.SplineCoordinateSpace.LOCAL,
                False,
            )
        else:
            set_spline_point_tangent(spline_component, index, leave_tangent)

    spline_component.update_spline()


def create_route_actor(route_bp_class, source_data: dict, route_label: str) -> tuple[unreal.Actor, object]:
    route_ref = str(source_data.get("ref", "Route"))
    destroy_existing_actors_with_tags([route_ref, "CenterRoute", "SourceImport"])
    actor = spawn_actor(
        route_bp_class,
        unreal.Vector(0.0, 0.0, 0.0),
        unreal.Rotator(0.0, 0.0, 0.0),
        route_label,
    )
    spline_component = find_component_by_name(actor, UB_ROUTE_SPLINE_COMPONENT_NAME)
    configure_spline_component_from_source(spline_component, source_data)
    set_actor_tags(actor, [str(source_data.get("ref", "Route")), "CenterRoute", "SourceImport"])
    log("INFO", f"Configured center route spline with {len(source_data['route']['points'])} final route points")
    return actor, spline_component


def build_rotation_from_tangent(tangent: unreal.Vector) -> unreal.Rotator:
    if abs(tangent.x) < 0.001 and abs(tangent.y) < 0.001:
        fail("Cannot build station rotation from zero tangent")

    rotation = unreal.Rotator()
    rotation.pitch = 0.0
    rotation.yaw = math.degrees(math.atan2(tangent.y, tangent.x)) + UB_STATION_ACTOR_YAW_OFFSET_DEG
    rotation.roll = 0.0
    return rotation


def build_station_axis_rotation_from_arrows(station_actor: unreal.Actor) -> unreal.Rotator:
    start_component = find_first_existing_component(
        station_actor,
        ["Arrow_Start", "TrainStopPoint", "A", "Start"],
    )
    end_component = find_first_existing_component(
        station_actor,
        ["Arrow_End", "TrainStopPointReverse", "B", "End"],
    )

    start_location = start_component.get_world_location()
    end_location = end_component.get_world_location()
    delta = unreal.Vector(end_location.x - start_location.x, end_location.y - start_location.y, 0.0)
    if abs(delta.x) < 0.001 and abs(delta.y) < 0.001:
        fail(f"Station arrow axis collapsed for actor '{station_actor.get_name()}'")

    rotation = unreal.Rotator()
    rotation.pitch = 0.0
    rotation.yaw = math.degrees(math.atan2(delta.y, delta.x)) + UB_STATION_ACTOR_YAW_OFFSET_DEG
    rotation.roll = 0.0
    return rotation


def get_station_arrow_midpoint(station_actor: unreal.Actor) -> unreal.Vector:
    start_component = find_first_existing_component(
        station_actor,
        ["Arrow_Start", "TrainStopPoint", "A", "Start"],
    )
    end_component = find_first_existing_component(
        station_actor,
        ["Arrow_End", "TrainStopPointReverse", "B", "End"],
    )
    start_location = start_component.get_world_location()
    end_location = end_component.get_world_location()
    return unreal.Vector(
        (start_location.x + end_location.x) * 0.5,
        (start_location.y + end_location.y) * 0.5,
        (start_location.z + end_location.z) * 0.5,
    )


def apply_actor_rotation(actor: unreal.Actor, rotation: unreal.Rotator) -> None:
    if not hasattr(actor, "set_actor_rotation"):
        fail(f"Actor '{actor.get_name()}' has no 'set_actor_rotation' method")
    actor.set_actor_rotation(rotation, False)


def apply_actor_location(actor: unreal.Actor, location: unreal.Vector) -> None:
    if not hasattr(actor, "set_actor_location"):
        fail(f"Actor '{actor.get_name()}' has no 'set_actor_location' method")
    actor.set_actor_location(location, False, False)


def find_platform_section_for_station(station_data: dict, section_rows: list[dict]) -> dict:
    station_name = station_data["name"]
    matched_rows = [
        section
        for section in section_rows
        if section.get("type") == "platform" and section.get("station") == station_name
    ]
    if len(matched_rows) != 1:
        fail(f"Expected exactly one platform section for station '{station_name}', found {len(matched_rows)}")
    return matched_rows[0]


def build_station_location(station_data: dict) -> unreal.Vector:
    location_cm = station_data.get("location_cm")
    if not isinstance(location_cm, list) or len(location_cm) != 3:
        fail(f"Station '{station_data.get('name', '<unknown>')}' is missing a valid 'location_cm'")
    return vector_from_xyz(location_cm)


def create_station_actors(
    station_bp_class,
    spline_component,
    source_data: dict,
    station_label_prefix: str,
) -> list[unreal.Actor]:
    destroy_existing_actor_with_prefix(station_label_prefix)
    destroy_existing_actors_with_tags([str(source_data.get("ref", "Route")), "StationZone"])

    actors = []
    stations = source_data["stations"]
    sections = source_data["sections"]

    for station_data in stations:
        for required_key in ("name", "dist_m", "platform_start_m", "platform_end_m"):
            if required_key not in station_data:
                fail(f"Station row is missing '{required_key}': {station_data}")

        platform_section = find_platform_section_for_station(station_data, sections)
        center_distance_cm = float(platform_section["center_m"]) * 100.0 + UB_STATION_DIST_OFFSET_CM

        # Exact world position + tangent at the platform centre on the spline.
        location = spline_component.get_location_at_distance_along_spline(
            center_distance_cm,
            unreal.SplineCoordinateSpace.WORLD,
        )
        tangent = spline_component.get_tangent_at_distance_along_spline(
            center_distance_cm,
            unreal.SplineCoordinateSpace.WORLD,
        )
        station_name = str(station_data["name"])

        # Spawn with tangent-aligned rotation (local Y along track, see YAW_OFFSET_DEG).
        actor = spawn_actor(
            station_bp_class,
            location,
            build_rotation_from_tangent(tangent),
            f"{station_label_prefix}{station_name}",
        )
        actor.set_actor_scale3d(unreal.Vector(1.0, 1.0, 1.0))

        # Position correction: move actor so that the midpoint of Arrow_Start/Arrow_End
        # lands exactly at `location` (spline centre).  The BP pivot is not necessarily
        # at the geometric centre, so this compensates for that offset.
        try:
            midpoint = get_station_arrow_midpoint(actor)
            delta = unreal.Vector(
                location.x - midpoint.x,
                location.y - midpoint.y,
                location.z - midpoint.z,
            )
            cur = actor.get_actor_location()
            apply_actor_location(actor, unreal.Vector(
                cur.x + delta.x,
                cur.y + delta.y,
                cur.z + delta.z,
            ))
        except Exception as exc:
            log("WARNING", f"Arrow midpoint correction skipped for '{station_name}': {exc}")
        set_actor_tags(
            actor,
            [
                station_name,
                station_data["name"],
                "StationZone",
                str(source_data.get("ref", "Route")),
            ],
        )

        platform_length_cm = (float(station_data["platform_end_m"]) - float(station_data["platform_start_m"])) * 100.0
        set_editor_property_if_present(actor, "UB_PlatformLengthUU", platform_length_cm)
        set_editor_property_if_present(actor, "UB_PlatformCenterUU", center_distance_cm)
        actors.append(actor)

    log("INFO", f"Spawned {len(actors)} station actors")
    return actors


def slugify_station_name(name: str) -> str:
    """Wandelt Stationsname in stabilen ASCII-Key um (für JSON-Output)."""
    result = name
    for umlaut, replacement in (("ä","ae"),("ö","oe"),("ü","ue"),("ß","ss"),
                                 ("Ä","Ae"),("Ö","Oe"),("Ü","Ue")):
        result = result.replace(umlaut, replacement)
    result = re.sub(r"[^a-zA-Z0-9]+", "_", result)
    return result.lower().strip("_")


def compute_world_offset(source_data: dict, ref_lat: float, ref_lon: float) -> unreal.Vector:
    """Weltoffset dieses JSON relativ zu ref_lat/ref_lon (ENU, gleiche Vorzeichenkonvention)."""
    origin = source_data.get("origin_wgs84", {})
    json_lat = float(origin.get("lat", ref_lat))
    json_lon = float(origin.get("lon", ref_lon))
    lat_scale = 111320.0
    lon_scale = 111320.0 * math.cos(math.radians(ref_lat))
    north_delta_m = (json_lat - ref_lat) * lat_scale
    east_delta_m  = (json_lon - ref_lon) * lon_scale
    return unreal.Vector(-north_delta_m * 100.0, -east_delta_m * 100.0, 0.0)


def write_generated_jsons(source_path: Path, source_data: dict, route_label: str) -> None:
    """Schreibt Unreal-DataTable-kompatibles JSON in generated/."""
    out_dir = UB_SCRIPT_DIR / "generated"
    out_dir.mkdir(exist_ok=True)
    stem = source_path.stem

    stations_out = [
        {
            "Name":   slugify_station_name(s["name"]),
            "key":    slugify_station_name(s["name"]),
            "name":   s["name"],
            "dist_m": s["dist_m"],
        }
        for s in source_data["stations"]
    ]

    sections_out = []
    for section_index, sec in enumerate(source_data["sections"]):
        row: dict = {
            "Name":           f"{sec['type']}_{section_index:03d}",
            "UB_SectionType": sec["type"],
            "UB_StationKey":  "",
            "UB_FromM":       sec["from_m"],
            "UB_ToM":         sec["to_m"],
            "UB_CenterM":     float(sec["center_m"]) if "center_m" in sec else 0.0,
        }
        if sec["type"] == "platform":
            row["UB_StationKey"] = slugify_station_name(sec["station"])
            row["Name"] = f"platform_{slugify_station_name(sec['station'])}"
        sections_out.append(row)

    (out_dir / f"{stem}_stations.json").write_text(
        json.dumps(stations_out, separators=(",", ":"), ensure_ascii=False), encoding="utf-8"
    )
    (out_dir / f"{stem}_sections.json").write_text(
        json.dumps(sections_out, separators=(",", ":"), ensure_ascii=False), encoding="utf-8"
    )
    log("INFO", f"Generated JSONs written to {out_dir}")


def main() -> None:
    global _UB_WORLD_OFFSET_CM

    route_bp_class = load_bp_class(UB_ROUTE_BP_PATH)
    station_bp_class = load_bp_class(UB_STATION_BP_PATH) if UB_SPAWN_STATIONS else None

    source_files = find_source_json_files()
    log("INFO", f"Found {len(source_files)} JSON files in {UB_SCRIPT_DIR}")

    # Alle JSONs laden, erste Datei als gemeinsamer Weltorigin (offset 0,0,0).
    # Alle weiteren Linien werden relativ dazu platziert → U7+U8 liegen korrekt zueinander.
    all_data: list[tuple[Path, dict]] = []
    for source_path in source_files:
        source_data = load_json_object(source_path)
        validate_source_data(source_data)
        all_data.append((source_path, source_data))

    if not all_data:
        fail("Keine validen JSON-Dateien gefunden.")

    ref_origin = all_data[0][1].get("origin_wgs84", {})
    ref_lat = float(ref_origin.get("lat", 52.52))
    ref_lon = float(ref_origin.get("lon", 13.41))
    log("INFO", f"Weltorigin: lat={ref_lat} lon={ref_lon} ({all_data[0][0].name})")

    for source_path, source_data in all_data:
        route_label, station_label_prefix = build_import_labels(source_path)
        log("INFO", f"Importiere {source_path.name}")

        _UB_WORLD_OFFSET_CM = compute_world_offset(source_data, ref_lat, ref_lon)
        log("INFO", f"  Weltoffset: X={_UB_WORLD_OFFSET_CM.x:.0f} Y={_UB_WORLD_OFFSET_CM.y:.0f} cm")

        _, spline_component = create_route_actor(route_bp_class, source_data, route_label)

        if UB_SPAWN_STATIONS:
            create_station_actors(station_bp_class, spline_component, source_data, station_label_prefix)

        write_generated_jsons(source_path, source_data, route_label)

    log("INFO", "Import abgeschlossen")


if __name__ == "__main__":
    main()
