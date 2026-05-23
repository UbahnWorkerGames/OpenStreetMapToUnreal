import json
import math
from pathlib import Path

import unreal


UB_SCRIPT_DIR = Path(__file__).resolve().parent
# Direkt Master-Datei nutzen (v4 enthält zusätzlich die UE-Importfelder).
UB_SOURCE_JSON_PATH = UB_SCRIPT_DIR / "ubahn-master-U8.json"

UB_ROUTE_BP_PATH = "/Game/_UbahnWorkerGames/Blueprint/TrainElements/BP_Rail.BP_Rail"
UB_STATION_BP_PATH = "/Game/_UbahnWorkerGames/Blueprint/BahnHofModular/BP_StationTrigger.BP_StationTrigger"

UB_ROUTE_LABEL = "U8_CenterRoute_Source"
UB_STATION_LABEL_PREFIX = "STN"
UB_ROUTE_SPLINE_COMPONENT_NAME = "Spline"

UB_FORCE_ZERO_Z = True
UB_WORLD_OFFSET_CM = unreal.Vector(0.0, 0.0, 0.0)
UB_SPAWN_STATIONS = True
UB_STATION_ACTOR_YAW_OFFSET_DEG = 180.0


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


def get_source_axis_mode(source_data: dict) -> str:
    coordinate_system = source_data.get("coordinate_system")
    if isinstance(coordinate_system, dict):
        x_axis = str(coordinate_system.get("x_axis", "")).lower()
        y_axis = str(coordinate_system.get("y_axis", "")).lower()
        if x_axis == "east" and y_axis == "north":
            return "enu"
        if x_axis == "north" and y_axis == "east":
            return "neu"

    coordinate_note = str(source_data.get("coordinate_note", "")).lower()
    if "x=north" in coordinate_note and "y=east" in coordinate_note:
        return "neu"
    return "enu"


def transform_xyz_to_ue(values: list[float], axis_mode: str, force_zero_z: bool = False) -> unreal.Vector:
    if len(values) != 3:
        fail(f"Expected 3 values for vector, got {len(values)}")

    x_value = float(values[0])
    y_value = float(values[1])
    z_value = 0.0 if (force_zero_z or UB_FORCE_ZERO_Z) else float(values[2])

    if axis_mode == "neu":
        x_value, y_value = y_value, x_value

    return unreal.Vector(
        x_value + UB_WORLD_OFFSET_CM.x,
        y_value + UB_WORLD_OFFSET_CM.y,
        z_value + UB_WORLD_OFFSET_CM.z,
    )


def vector_from_xyz(values: list[float], axis_mode: str = "enu") -> unreal.Vector:
    return transform_xyz_to_ue(values, axis_mode)


def tangent_from_xyz(values: list[float], axis_mode: str = "enu") -> unreal.Vector:
    return transform_xyz_to_ue(values, axis_mode, force_zero_z=True)


def point_is_in_platform_section(distance_m: float, section_rows: list[dict]) -> bool:
    for section in section_rows:
        if section.get("type") != "platform":
            continue
        start_m = float(section["from_m"])
        end_m = float(section["to_m"])
        if start_m <= distance_m <= end_m:
            return True
    return False


def point_tangent_from_route(route_points: list[dict], index: int, axis_mode: str) -> unreal.Vector:
    current = vector_from_xyz(route_points[index]["pos_cm"], axis_mode)
    if index <= 0:
        nxt = vector_from_xyz(route_points[index + 1]["pos_cm"], axis_mode)
        return unreal.Vector(nxt.x - current.x, nxt.y - current.y, nxt.z - current.z)
    if index >= len(route_points) - 1:
        prev = vector_from_xyz(route_points[index - 1]["pos_cm"], axis_mode)
        return unreal.Vector(current.x - prev.x, current.y - prev.y, current.z - prev.z)

    prev = vector_from_xyz(route_points[index - 1]["pos_cm"], axis_mode)
    nxt = vector_from_xyz(route_points[index + 1]["pos_cm"], axis_mode)
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
    section_rows = source_data["sections"]
    axis_mode = get_source_axis_mode(source_data)

    set_editor_property_if_present(spline_component, "override_construction_script", True)
    set_editor_property_if_present(spline_component, "input_spline_points_to_construction_script", False)
    spline_component.clear_spline_points(False)

    transformed_points = [vector_from_xyz(point_data["pos_cm"], axis_mode) for point_data in route_points]

    for point_data, location in zip(route_points, transformed_points):
        spline_component.add_spline_point(location, unreal.SplineCoordinateSpace.LOCAL, False)

    for index, point_data in enumerate(route_points):
        dist_m = float(point_data.get("dist_m", 0.0))
        if point_is_in_platform_section(dist_m, section_rows):
            spline_component.set_spline_point_type(index, unreal.SplinePointType.LINEAR, False)
        else:
            spline_component.set_spline_point_type(index, unreal.SplinePointType.CURVE, False)
            tangent = point_tangent_from_route(route_points, index, axis_mode)
            set_spline_point_tangent(spline_component, index, tangent)

    spline_component.update_spline()


def create_route_actor(route_bp_class, source_data: dict) -> tuple[unreal.Actor, object]:
    actor = spawn_actor(
        route_bp_class,
        UB_WORLD_OFFSET_CM,
        unreal.Rotator(0.0, 0.0, 0.0),
        UB_ROUTE_LABEL,
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


def build_station_location(station_data: dict, axis_mode: str) -> unreal.Vector:
    location_cm = station_data.get("location_cm")
    if not isinstance(location_cm, list) or len(location_cm) != 3:
        fail(f"Station '{station_data.get('name', '<unknown>')}' is missing a valid 'location_cm'")
    return vector_from_xyz(location_cm, axis_mode)


def create_station_actors(station_bp_class, spline_component, source_data: dict) -> list[unreal.Actor]:
    destroy_existing_actor_with_prefix(f"{UB_STATION_LABEL_PREFIX}_")

    actors = []
    stations = source_data["stations"]
    sections = source_data["sections"]
    axis_mode = get_source_axis_mode(source_data)

    for station_data in stations:
        for required_key in ("name", "dist_m", "platform_start_m", "platform_end_m"):
            if required_key not in station_data:
                fail(f"Station row is missing '{required_key}': {station_data}")

        platform_section = find_platform_section_for_station(station_data, sections)
        center_distance_cm = float(platform_section["center_m"]) * 100.0
        tangent = spline_component.get_tangent_at_distance_along_spline(
            center_distance_cm,
            unreal.SplineCoordinateSpace.WORLD,
        )
        location = build_station_location(station_data, axis_mode)
        station_name = str(station_data["name"])
        actor = spawn_actor(
            station_bp_class,
            location,
            build_rotation_from_tangent(tangent),
            f"{UB_STATION_LABEL_PREFIX}_{station_name}",
        )
        axis_rotation = build_station_axis_rotation_from_arrows(actor)
        apply_actor_rotation(actor, axis_rotation)
        arrow_midpoint = get_station_arrow_midpoint(actor)
        location_delta = unreal.Vector(
            location.x - arrow_midpoint.x,
            location.y - arrow_midpoint.y,
            location.z - arrow_midpoint.z,
        )
        apply_actor_location(
            actor,
            unreal.Vector(
                actor.get_actor_location().x + location_delta.x,
                actor.get_actor_location().y + location_delta.y,
                actor.get_actor_location().z + location_delta.z,
            ),
        )
        actor.set_actor_scale3d(unreal.Vector(1.0, 1.0, 1.0))
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


def main() -> None:
    log("INFO", f"Loading U8 spline source data from {UB_SOURCE_JSON_PATH}")

    source_data = load_json_object(UB_SOURCE_JSON_PATH)
    validate_source_data(source_data)

    route_bp_class = load_bp_class(UB_ROUTE_BP_PATH)
    station_bp_class = load_bp_class(UB_STATION_BP_PATH) if UB_SPAWN_STATIONS else None

    _, spline_component = create_route_actor(route_bp_class, source_data)

    if UB_SPAWN_STATIONS:
        create_station_actors(station_bp_class, spline_component, source_data)

    log("INFO", "U8 spline source import finished")


if __name__ == "__main__":
    main()
