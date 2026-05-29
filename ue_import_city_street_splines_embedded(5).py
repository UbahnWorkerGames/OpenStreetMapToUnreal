import json
import re

import unreal


STREET_SPLINES = json.loads("[{\"ObjectType\":\"OSM_SPLINE\",\"Name\":\"Rhinstraße\",\"ActorLabel\":\"BP_Hauptstraße_Rhinstraße\",\"SplineKey\":\"major_road_Rhinstrasse_axis\",\"Type\":\"major_road\",\"Shape\":\"line\",\"Street\":\"Rhinstraße\",\"OsmClass\":\"secondary\",\"WidthM\":9,\"bBridge\":false,\"bTunnel\":false,\"OsmLayer\":0,\"bClosed\":false,\"Points\":[[113706.7,-771983,0],[100599.3,-772051.4,0],[74633.4,-773471.5,0],[69025.3,-773368.1,0],[61848.3,-771367.6,0],[52501.9,-773508,0],[5977.9,-773749.9,0],[3251.1,-774744.9,0],[-43352.5,-777663.7,0],[-46490.6,-776029.2,0],[-62925.9,-777533.6,0],[-65697.7,-775043.3,0],[-69726.4,-774572.9,0],[-89545.8,-775584.2,0],[-93604.5,-774443.8,0],[-97720,-775223.8,0],[-125939.7,-773510.8,0],[-130128.1,-772512,0],[-142648.5,-771371.5,0],[-152969.3,-769074,0],[-172331.2,-761994.2,0],[-175708.6,-757982.2,0],[-218238.4,-740554.2,0],[-228824.1,-734134.2,0],[-251439.2,-724597.6,0]]},{\"ObjectType\":\"OSM_SPLINE\",\"Name\":\"Alt-Friedrichsfelde\",\"ActorLabel\":\"BP_Hauptstraße_Alt_Friedrichsfelde\",\"SplineKey\":\"major_road_Alt_Friedrichsfelde_axis\",\"Type\":\"major_road\",\"Shape\":\"line\",\"Street\":\"Alt-Friedrichsfelde\",\"OsmClass\":\"primary\",\"WidthM\":7,\"bBridge\":false,\"bTunnel\":false,\"OsmLayer\":0,\"bClosed\":false,\"Points\":[[114047.3,-938875.2,0],[112053.6,-924829,0],[109314,-887960.4,0],[105064.9,-863815.7,0],[104891.3,-859572.7,0],[105691.7,-842432.6,0],[107564.1,-831655.1,0],[112254.8,-811968.8,0],[114118.6,-807886.3,0],[114956,-803989.8,0],[115922.4,-793861.2,0],[115432.7,-790874.7,0],[114128.6,-789686.2,0],[117149.8,-785731.8,0],[115778.9,-784990.1,0],[115668.7,-776567,0],[111893.9,-771352.3,0],[115822.2,-769772,0],[114606.7,-767082.9,0],[114082.4,-762957.7,0],[110683.2,-750818.3,0],[112182.7,-750124.4,0],[109663.6,-743952.6,0],[112648,-743005.6,0],[109227.2,-736854.5,0],[108887.1,-727843.8,0],[103823.8,-676734.7,0]]},{\"ObjectType\":\"OSM_SPLINE\",\"Name\":\"Tunnel Alt-Friedrichsfelde\",\"ActorLabel\":\"BP_Hauptstraße_Tunnel_Alt_Friedrichsfelde\",\"SplineKey\":\"major_road_Tunnel_Alt_Friedrichsfelde_4689185_4689188_centerline\",\"Type\":\"major_road\",\"Shape\":\"line\",\"Street\":\"Tunnel Alt-Friedrichsfelde\",\"OsmClass\":\"primary\",\"WidthM\":7,\"bBridge\":false,\"bTunnel\":true,\"OsmLayer\":-1,\"bClosed\":false,\"Points\":[[115668.7,-776567,0],[114606.7,-767082.9,0]]},{\"ObjectType\":\"OSM_SPLINE\",\"Name\":\"Am Tierpark\",\"ActorLabel\":\"BP_Hauptstraße_Am_Tierpark\",\"SplineKey\":\"major_road_Am_Tierpark_axis\",\"Type\":\"major_road\",\"Shape\":\"line\",\"Street\":\"Am Tierpark\",\"OsmClass\":\"secondary\",\"WidthM\":7.8,\"bBridge\":false,\"bTunnel\":false,\"OsmLayer\":0,\"bClosed\":false,\"Points\":[[223385.3,-792842.4,0],[217728.6,-792031.3,0],[214475.8,-790478.4,0],[206838.7,-788013.3,0],[202698.1,-787159.7,0],[200437.2,-788561.1,0],[180376.2,-782558.3,0],[175044,-782837.4,0],[166735.1,-778595.7,0],[133457.1,-773648.3,0],[129051.9,-774113.3,0],[126687.7,-771839,0],[117426.2,-772866.4,0],[113706.7,-771983,0]]},{\"ObjectType\":\"OSM_SPLINE\",\"Name\":\"Allee der Kosmonauten\",\"ActorLabel\":\"BP_Hauptstraße_Allee_der_Kosmonauten\",\"SplineKey\":\"major_road_Allee_der_Kosmonauten_axis\",\"Type\":\"major_road\",\"Shape\":\"line\",\"Street\":\"Allee der Kosmonauten\",\"OsmClass\":\"secondary\",\"WidthM\":7,\"bBridge\":false,\"bTunnel\":false,\"OsmLayer\":0,\"bClosed\":false,\"Points\":[[-65732.2,-933310.3,0],[-64836.7,-914523.9,0],[-63254.3,-907483.4,0],[-63024.9,-903799.2,0],[-63703.8,-899304,0],[-61904.2,-871560.7,0],[-62363.7,-849826.7,0],[-60126.2,-839369.6,0],[-64408.5,-792303.7,0],[-65612.6,-787071.4,0],[-66227.1,-774743.6,0]]},{\"ObjectType\":\"OSM_SPLINE\",\"Name\":\"Landsberger Allee\",\"ActorLabel\":\"BP_Hauptstraße_Landsberger_Allee\",\"SplineKey\":\"major_road_Landsberger_Allee_axis\",\"Type\":\"major_road\",\"Shape\":\"line\",\"Street\":\"Landsberger Allee\",\"OsmClass\":\"primary\",\"WidthM\":10.5,\"bBridge\":false,\"bTunnel\":false,\"OsmLayer\":0,\"bClosed\":false,\"Points\":[[-157216.1,-597972.3,0],[-158183.5,-607366,0],[-156666.2,-611406.5,0],[-158788,-628357.5,0],[-158034.3,-641715.9,0],[-160874.1,-653016.3,0],[-163014.8,-681202.5,0],[-166580.4,-710112.1,0],[-168261.3,-737950.4,0],[-175834.4,-792578.6,0],[-179218.9,-802771.3,0],[-182996.2,-810986,0],[-189149.4,-821874.6,0],[-190336.6,-825603.8,0],[-200088.8,-845580.3,0],[-211937.1,-879729.7,0],[-217076.2,-889056.3,0],[-221731.6,-905335.8,0],[-219690.3,-912366,0],[-224446.7,-916138.1,0],[-231669.2,-916524.8,0],[-226924.7,-920294.1,0],[-230724.5,-923619.7,0],[-229987.9,-927486.2,0],[-227645.5,-930335.3,0],[-232328.2,-942257.3,0]]},{\"ObjectType\":\"OSM_SPLINE\",\"Name\":\"Hauptstrasse 4696057\",\"ActorLabel\":\"BP_Hauptstraße_Hauptstrasse_4696057\",\"SplineKey\":\"major_road_Hauptstrasse_4696057_4696057_0\",\"Type\":\"major_road\",\"Shape\":\"line\",\"Street\":\"Hauptstrasse 4696057\",\"OsmClass\":\"primary_link\",\"WidthM\":3.5,\"bBridge\":false,\"bTunnel\":false,\"OsmLayer\":0,\"bClosed\":false,\"Points\":[[-221612.5,-904901.9,0],[-223264.5,-907998.8,0],[-248918.2,-922455.8,0]]},{\"ObjectType\":\"OSM_SPLINE\",\"Name\":\"Frankfurter Allee\",\"ActorLabel\":\"BP_Hauptstraße_Frankfurter_Allee\",\"SplineKey\":\"major_road_Frankfurter_Allee_axis\",\"Type\":\"major_road\",\"Shape\":\"line\",\"Street\":\"Frankfurter Allee\",\"OsmClass\":\"primary\",\"WidthM\":14,\"bBridge\":true,\"bTunnel\":false,\"OsmLayer\":1,\"bClosed\":false,\"Points\":[[103063.4,-676067.7,0],[99333.9,-649737.9,0],[95327.8,-631642.8,0],[91977,-602458.2,0]]},{\"ObjectType\":\"OSM_SPLINE\",\"Name\":\"Gensinger Straße\",\"ActorLabel\":\"BP_Hauptstraße_Gensinger_Straße\",\"SplineKey\":\"major_road_Gensinger_Strasse_axis\",\"Type\":\"major_road\",\"Shape\":\"line\",\"Street\":\"Gensinger Straße\",\"OsmClass\":\"primary_link\",\"WidthM\":3.5,\"bBridge\":false,\"bTunnel\":false,\"OsmLayer\":0,\"bClosed\":false,\"Points\":[[117076.7,-850497.8,0],[118145,-853043.6,0],[108815.7,-849952.6,0],[117705.3,-860155.9,0],[115851.8,-862361.4,0],[113198,-863230.4,0],[105847,-863756.4,0]]},{\"ObjectType\":\"OSM_SPLINE\",\"Name\":\"Hauptstrasse 18888129\",\"ActorLabel\":\"BP_Hauptstraße_Hauptstrasse_18888129\",\"SplineKey\":\"major_road_Hauptstrasse_18888129_18888129_0\",\"Type\":\"major_road\",\"Shape\":\"line\",\"Street\":\"Hauptstrasse 18888129\",\"OsmClass\":\"primary_link\",\"WidthM\":3.5,\"bBridge\":false,\"bTunnel\":false,\"OsmLayer\":0,\"bClosed\":false,\"Points\":[[-51396.4,-903426,0],[-51417.6,-904845.7,0]]},{\"ObjectType\":\"OSM_SPLINE\",\"Name\":\"Märkische Allee\",\"ActorLabel\":\"BP_Hauptstraße_Märkische_Allee\",\"SplineKey\":\"major_road_Maerkische_Allee_axis\",\"Type\":\"major_road\",\"Shape\":\"line\",\"Street\":\"Märkische Allee\",\"OsmClass\":\"primary\",\"WidthM\":10.5,\"bBridge\":false,\"bTunnel\":false,\"OsmLayer\":0,\"bClosed\":false,\"Points\":[[-9649.2,-929719.2,0],[-12081,-925689.9,0],[-15479,-922893.4,0],[-18670.6,-922225.5,0],[-25947.6,-915127.4,0],[-29553.2,-914635,0],[-33273.5,-910799.7,0],[-40899,-907091.9,0],[-43614.1,-907675.7,0],[-61644.6,-900730.7,0],[-82480.3,-897100,0],[-90828.2,-893901.5,0],[-95547.1,-894771.3,0],[-105805.2,-892464.2,0],[-112862.9,-893571,0],[-125328.5,-891757.7,0],[-140248.7,-892179.7,0],[-143872.2,-893940.1,0],[-149006.3,-894307.3,0],[-152886.3,-893905.3,0],[-161180.2,-895520.4,0],[-164303,-895366.1,0],[-177607.2,-898378.9,0],[-182021.6,-897767.2,0],[-193453.6,-901077,0],[-206024.4,-906441.6,0],[-213608.6,-907587.7,0],[-223549.5,-913134.6,0],[-235418.4,-916302,0],[-242863.5,-921315.8,0],[-248918.2,-922455.8,0]]},{\"ObjectType\":\"OSM_SPLINE\",\"Name\":\"Hauptstrasse 192028822\",\"ActorLabel\":\"BP_Hauptstraße_Hauptstrasse_192028822\",\"SplineKey\":\"major_road_Hauptstrasse_192028822_192028822_0\",\"Type\":\"major_road\",\"Shape\":\"line\",\"Street\":\"Hauptstrasse 192028822\",\"OsmClass\":\"primary_link\",\"WidthM\":3.5,\"bBridge\":false,\"bTunnel\":false,\"OsmLayer\":0,\"bClosed\":false,\"Points\":[[-51396.4,-903426,0],[-52310.4,-904560.5,0]]},{\"ObjectType\":\"OSM_SPLINE\",\"Name\":\"Hauptstrasse 192028823\",\"ActorLabel\":\"BP_Hauptstraße_Hauptstrasse_192028823\",\"SplineKey\":\"major_road_Hauptstrasse_192028823_192028823_0\",\"Type\":\"major_road\",\"Shape\":\"line\",\"Street\":\"Hauptstrasse 192028823\",\"OsmClass\":\"secondary_link\",\"WidthM\":14,\"bBridge\":false,\"bTunnel\":false,\"OsmLayer\":0,\"bClosed\":false,\"Points\":[[-63709.5,-915949.8,0],[-66092.9,-915879.3,0]]},{\"ObjectType\":\"OSM_SPLINE\",\"Name\":\"Hauptstrasse 192028824\",\"ActorLabel\":\"BP_Hauptstraße_Hauptstrasse_192028824\",\"SplineKey\":\"major_road_Hauptstrasse_192028824_192028824_0\",\"Type\":\"major_road\",\"Shape\":\"line\",\"Street\":\"Hauptstrasse 192028824\",\"OsmClass\":\"primary_link\",\"WidthM\":7,\"bBridge\":false,\"bTunnel\":false,\"OsmLayer\":0,\"bClosed\":false,\"Points\":[[-54988.7,-911393.8,0],[-56085.2,-912950.4,0],[-58500.9,-914832.1,0],[-63709.5,-915949.8,0]]},{\"ObjectType\":\"OSM_SPLINE\",\"Name\":\"Hauptstrasse 192028825\",\"ActorLabel\":\"BP_Hauptstraße_Hauptstrasse_192028825\",\"SplineKey\":\"major_road_Hauptstrasse_192028825_192028825_0\",\"Type\":\"major_road\",\"Shape\":\"line\",\"Street\":\"Hauptstrasse 192028825\",\"OsmClass\":\"primary_link\",\"WidthM\":7,\"bBridge\":false,\"bTunnel\":false,\"OsmLayer\":0,\"bClosed\":false,\"Points\":[[-51417.6,-904845.7,0],[-54749.4,-913070.3,0],[-56409.2,-914710.9,0],[-58887.2,-916101.5,0]]},{\"ObjectType\":\"OSM_SPLINE\",\"Name\":\"Hauptstrasse 192498002\",\"ActorLabel\":\"BP_Hauptstraße_Hauptstrasse_192498002\",\"SplineKey\":\"major_road_Hauptstrasse_192498002_192498002_0\",\"Type\":\"major_road\",\"Shape\":\"line\",\"Street\":\"Hauptstrasse 192498002\",\"OsmClass\":\"primary_link\",\"WidthM\":7,\"bBridge\":false,\"bTunnel\":false,\"OsmLayer\":0,\"bClosed\":false,\"Points\":[[-52310.4,-904560.5,0],[-54988.7,-911393.8,0]]},{\"ObjectType\":\"OSM_SPLINE\",\"Name\":\"Hauptstrasse 192498004\",\"ActorLabel\":\"BP_Hauptstraße_Hauptstrasse_192498004\",\"SplineKey\":\"major_road_Hauptstrasse_192498004_192498004_0\",\"Type\":\"major_road\",\"Shape\":\"line\",\"Street\":\"Hauptstrasse 192498004\",\"OsmClass\":\"primary_link\",\"WidthM\":10.5,\"bBridge\":false,\"bTunnel\":false,\"OsmLayer\":0,\"bClosed\":false,\"Points\":[[-58887.2,-916101.5,0],[-62103.2,-916503.2,0],[-63709.5,-915949.8,0]]},{\"ObjectType\":\"OSM_SPLINE\",\"Name\":\"Nördliche Rhinstraßenbrücke\",\"ActorLabel\":\"BP_Hauptstraße_Nördliche_Rhinstraßenbrücke\",\"SplineKey\":\"major_road_Noerdliche_Rhinstrassenbruecke_222182356_222182357_centerline\",\"Type\":\"major_road\",\"Shape\":\"line\",\"Street\":\"Nördliche Rhinstraßenbrücke\",\"OsmClass\":\"secondary\",\"WidthM\":10.5,\"bBridge\":true,\"bTunnel\":false,\"OsmLayer\":1,\"bClosed\":false,\"Points\":[[-125580.1,-772734.8,0],[-126300.3,-772722.3,0]]},{\"ObjectType\":\"OSM_SPLINE\",\"Name\":\"Hauptstrasse 230102147\",\"ActorLabel\":\"BP_Hauptstraße_Hauptstrasse_230102147\",\"SplineKey\":\"major_road_Hauptstrasse_230102147_230102147_0\",\"Type\":\"major_road\",\"Shape\":\"line\",\"Street\":\"Hauptstrasse 230102147\",\"OsmClass\":\"primary_link\",\"WidthM\":3.5,\"bBridge\":false,\"bTunnel\":false,\"OsmLayer\":0,\"bClosed\":false,\"Points\":[[-77055.7,-898403.3,0],[-77602.3,-897384.5,0],[-80980.8,-896530.4,0],[-82351.2,-895677.6,0]]},{\"ObjectType\":\"OSM_SPLINE\",\"Name\":\"Hauptstrasse 907075587\",\"ActorLabel\":\"BP_Hauptstraße_Hauptstrasse_907075587\",\"SplineKey\":\"major_road_Hauptstrasse_907075587_907075587_0\",\"Type\":\"major_road\",\"Shape\":\"line\",\"Street\":\"Hauptstrasse 907075587\",\"OsmClass\":\"primary_link\",\"WidthM\":3.5,\"bBridge\":false,\"bTunnel\":false,\"OsmLayer\":0,\"bClosed\":false,\"Points\":[[112012.4,-923990.8,0],[111133,-928949.1,0]]},{\"ObjectType\":\"OSM_SPLINE\",\"Name\":\"Hauptstrasse 1094030672\",\"ActorLabel\":\"BP_Hauptstraße_Hauptstrasse_1094030672\",\"SplineKey\":\"major_road_Hauptstrasse_1094030672_1094030672_0\",\"Type\":\"major_road\",\"Shape\":\"line\",\"Street\":\"Hauptstrasse 1094030672\",\"OsmClass\":\"primary_link\",\"WidthM\":7,\"bBridge\":false,\"bTunnel\":false,\"OsmLayer\":0,\"bClosed\":false,\"Points\":[[-220498.2,-911945.8,0],[-221043.7,-910513.2,0]]},{\"ObjectType\":\"OSM_SPLINE\",\"Name\":\"Südliche Rhinstraßenbrücke\",\"ActorLabel\":\"BP_Hauptstraße_Südliche_Rhinstraßenbrücke\",\"SplineKey\":\"major_road_Suedliche_Rhinstrassenbruecke_11663312_574670425_1185655784_stitched\",\"Type\":\"major_road\",\"Shape\":\"line\",\"Street\":\"Südliche Rhinstraßenbrücke\",\"OsmClass\":\"secondary\",\"WidthM\":7,\"bBridge\":true,\"bTunnel\":false,\"OsmLayer\":2,\"bClosed\":false,\"Points\":[[66478.1,-772407.7,0],[61944,-773585.3,0],[52501.9,-773508,0]]},{\"ObjectType\":\"OSM_SPLINE\",\"Name\":\"Gensinger Brücke\",\"ActorLabel\":\"BP_Hauptstraße_Gensinger_Brücke\",\"SplineKey\":\"major_road_Gensinger_Bruecke_51218885_1456100298_stitched\",\"Type\":\"major_road\",\"Shape\":\"line\",\"Street\":\"Gensinger Brücke\",\"OsmClass\":\"primary_link\",\"WidthM\":7,\"bBridge\":true,\"bTunnel\":false,\"OsmLayer\":1,\"bClosed\":false,\"Points\":[[113198,-863230.4,0],[106629,-863697.1,0]]},{\"ObjectType\":\"OSM_SPLINE\",\"Name\":\"B 1;B 5\",\"ActorLabel\":\"BP_Hauptstraße_B_1_B_5\",\"SplineKey\":\"major_road_B_1_B_5_axis\",\"Type\":\"major_road\",\"Shape\":\"line\",\"Street\":\"B 1;B 5\",\"OsmClass\":\"primary\",\"WidthM\":14,\"bBridge\":false,\"bTunnel\":false,\"OsmLayer\":0,\"bClosed\":false,\"Points\":[[111820.4,-811835.4,0],[109394.2,-819910.9,0],[109361.9,-829032.3,0],[107564.1,-831655.1,0],[106954,-842737.4,0],[108243.1,-847507.4,0],[107057.6,-853139.1,0],[108856.5,-880592,0],[111347.8,-899736.3,0]]}]")
BUILDINGS = json.loads("[]")
TREES = json.loads("[]")
PROPS = json.loads("[]")
BP_PATHS = json.loads("{\"tunnel\":\"/Game/_UbahnWorkerGames/TEST/BP_CityTest.BP_CityTest\",\"subway\":\"/Game/_UbahnWorkerGames/TEST/BP_CityTest.BP_CityTest\",\"tram\":\"/Game/_UbahnWorkerGames/TEST/BP_CityTest.BP_CityTest\",\"train\":\"/Game/_UbahnWorkerGames/TEST/BP_CityTest.BP_CityTest\",\"bus\":\"/Game/_UbahnWorkerGames/TEST/BP_CityTest.BP_CityTest\",\"street\":\"/Game/_UbahnWorkerGames/TEST/BP_CityTest.BP_CityTest\",\"building\":\"/Game/_UbahnWorkerGames/TEST/BP_BuildingCube.BP_BuildingCube\",\"tree\":\"/Game/_UbahnWorkerGames/TEST/BP_BuildingCube.BP_BuildingCube\",\"prop\":\"/Game/_UbahnWorkerGames/TEST/BP_BuildingCube.BP_BuildingCube\"}")
ACTOR_LABEL_PREFIX = "CITY_STREET"
BUILDING_ACTOR_LABEL_PREFIX = "OSM_BUILDING"
TREE_ACTOR_LABEL_PREFIX = "OSM_TREE"
PROP_ACTOR_LABEL_PREFIX = "OSM_PROP"
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


def destroy_existing_actor_with_label(label):
    for actor in unreal.EditorLevelLibrary.get_all_level_actors():
        if actor.get_actor_label() == label:
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
    sanitized = re.sub(r"[^w]+", "_", str(value), flags=re.UNICODE).strip("_")
    return sanitized or "Unnamed"


def label_part(value, fallback):
    sanitized = sanitize_label_part(value)
    if sanitized == "Unnamed":
        sanitized = sanitize_label_part(fallback)
    return sanitized


def road_kind_label(row):
    row_type = str(row.get("Type", "street"))
    osm_class = str(row.get("OsmClass", ""))
    if row_type == "major_road":
        return "Hauptstraße"
    if row_type == "city_road":
        return "Stadtstraße"
    if row_type == "service":
        return "Service"
    if row_type == "motorway":
        return "Autobahn"
    if row_type == "cycleway":
        return "Radweg"
    if row_type == "footway":
        return "Fußweg"
    if row_type == "rail_tram":
        return "Tram"
    if row_type == "rail_train":
        return "Bahn"
    if row_type == "rail_subway":
        return "U-Bahn"
    if row_type == "bus":
        return "Bus"
    return sanitize_label_part(osm_class or row_type or "Straße")


def actor_label_for_spline(row):
    label = row.get("ActorLabel")
    if not isinstance(label, str) or not label.strip() or "Unnamed" in label:
        fail(f"Invalid ActorLabel in spline row: {row}")
    return label.strip()


def spline_geometry_signature(row):
    points = row.get("Points")
    if not isinstance(points, list) or len(points) < 2:
        return ""
    rounded = []
    for point in points:
        if isinstance(point, list) and len(point) >= 2:
            rounded.append(f"{float(point[0]):.1f},{float(point[1]):.1f}")
    forward = "|".join(rounded)
    backward = "|".join(reversed(rounded))
    return forward if forward < backward else backward


def dedupe_spline_rows(rows):
    by_geometry = {}
    duplicates = 0
    for row in rows:
        signature = spline_geometry_signature(row)
        existing = by_geometry.get(signature)
        if existing is None:
            by_geometry[signature] = row
            continue
        duplicates += 1
    if duplicates:
        unreal.log(f"[INFO] Removed {duplicates} duplicate street spline row(s) by geometry before spawn")
    return list(by_geometry.values())


def uniquify_actor_labels(rows):
    counts = {}
    result = []
    for row in rows:
        base_label = actor_label_for_spline(row)
        count = counts.get(base_label, 0) + 1
        counts[base_label] = count
        if count > 1:
            row = dict(row)
            row["ActorLabel"] = f"{base_label}_{count:02d}"
        result.append(row)
    return result


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
    world = point_to_vector(point)
    return unreal.Vector(world.x - origin.x, world.y - origin.y, world.z - origin.z)


def _nudge_spline_point(spline_component, index):
    """Work around a UE5 editor bug where spline geometry written via Python
    does not register for PCG / rendering until a point is touched manually.
    Displaces the point by 1 cm and restores it, forcing UE to invalidate."""
    try:
        location = spline_world_location_at_point(spline_component, index)
        nudged = unreal.Vector(location.x + 1.0, location.y, location.z)
        if hasattr(spline_component, "set_location_at_spline_point"):
            spline_component.set_location_at_spline_point(
                index, nudged, unreal.SplineCoordinateSpace.WORLD, True
            )
            spline_component.set_location_at_spline_point(
                index, location, unreal.SplineCoordinateSpace.WORLD, True
            )
        elif hasattr(spline_component, "set_location_at_spline_input_key"):
            spline_component.set_location_at_spline_input_key(
                float(index), nudged, unreal.SplineCoordinateSpace.WORLD, True
            )
            spline_component.set_location_at_spline_input_key(
                float(index), location, unreal.SplineCoordinateSpace.WORLD, True
            )
    except Exception:
        pass  # best-effort


def _force_spline_invalidation(spline_component, num_points):
    """Nudge every Nth point to force UE5 to register the full spline geometry.
    After writing all points, UE may still show a collapsed spline until a
    manual edit occurs.  Touching points programmatically works around this."""
    step = max(1, num_points // 10)  # every 10th point at minimum
    for index in range(0, num_points, step):
        _nudge_spline_point(spline_component, index)
    # Always nudge the last point too
    if num_points > 0:
        _nudge_spline_point(spline_component, num_points - 1)


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


def call_method_if_present(obj, method_name):
    method = getattr(obj, method_name, None)
    if method is None:
        return False
    try:
        method()
        return True
    except Exception:
        return False


def set_tags(actor, tags):
    actor.tags = [unreal.Name(str(tag)) for tag in tags if str(tag)]


def payload_value(value):
    if value is None:
        return ""
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    return str(value)


def set_payload_if_present(actor, row, object_type):
    payload = {str(key): payload_value(value) for key, value in dict(row).items()}
    payload["ObjectType"] = object_type
    if not set_editor_property_if_present(actor, "payload", payload):
        return False
    return True


def write_spline_points(spline_component, row):
    call_method_if_present(spline_component, "modify")
    spline_component.clear_spline_points(False)
    for point in row["Points"]:
        spline_component.add_spline_point(point_to_vector(point), unreal.SplineCoordinateSpace.WORLD, True)
    for index in range(len(row["Points"])):
        point_type = unreal.SplinePointType.LINEAR if LINEAR_SPLINES else unreal.SplinePointType.CURVE
        spline_component.set_spline_point_type(index, point_type, True)
    if hasattr(spline_component, "set_closed_loop"):
        spline_component.set_closed_loop(bool(row.get("bClosed", False)), True)
    elif bool(row.get("bClosed", False)):
        fail("SplineComponent does not expose set_closed_loop, but the source spline is closed")
    spline_component.update_spline()
    set_editor_property_if_present(spline_component, "override_construction_script", True)
    set_editor_property_if_present(spline_component, "input_spline_points_to_construction_script", False)
    call_method_if_present(spline_component, "post_edit_change")


def configure_spline_component(spline_component, row):
    set_editor_property_if_present(spline_component, "override_construction_script", True)
    set_editor_property_if_present(spline_component, "input_spline_points_to_construction_script", False)
    write_spline_points(spline_component, row)


def spline_world_location_at_point(spline_component, index):
    if hasattr(spline_component, "get_location_at_spline_point"):
        return spline_component.get_location_at_spline_point(index, unreal.SplineCoordinateSpace.WORLD)
    if hasattr(spline_component, "get_location_at_spline_input_key"):
        return spline_component.get_location_at_spline_input_key(float(index), unreal.SplineCoordinateSpace.WORLD)
    fail("SplineComponent does not expose a world-location getter for validation")


def vector_distance(a, b):
    dx = a.x - b.x
    dy = a.y - b.y
    dz = a.z - b.z
    return (dx * dx + dy * dy + dz * dz) ** 0.5


def validate_spline_not_collapsed(spline_component, row):
    expected_start = point_to_vector(row["Points"][0])
    expected_end = point_to_vector(row["Points"][-1])
    expected_span = vector_distance(expected_start, expected_end)
    actual_start = spline_world_location_at_point(spline_component, 0)
    actual_end = spline_world_location_at_point(spline_component, len(row["Points"]) - 1)
    actual_span = vector_distance(actual_start, actual_end)
    if expected_span > 100.0 and actual_span < expected_span * 0.25:
        fail(
            f"Spline '{row.get('SplineKey')}' collapsed after configuration: "
            f"expected end-to-end span {expected_span:.1f} cm, got {actual_span:.1f} cm"
        )


def set_actor_tags(actor, row):
    tags = [
        "OSM_SPLINE",
        "CityStreet",
        row.get("Street", "") or row.get("SplineKey", ""),
        row.get("Type", ""),
        f"{float(row.get('WidthM', 0.0)):.2f}",
        row.get("SplineKey", ""),
        row.get("OsmClass", ""),
    ]
    if row.get("bBridge"):
        tags.append("Bridge")
    if row.get("bTunnel"):
        tags.append("Tunnel")
    set_tags(actor, tags)
    set_payload_if_present(actor, row, "OSM_SPLINE")


def create_street_spline_actor(actor_class, row):
    label = actor_label_for_spline(row)
    destroy_existing_actor_with_label(label)
    actor = unreal.EditorLevelLibrary.spawn_actor_from_class(
        actor_class,
        WORLD_OFFSET_CM,
        unreal.Rotator(0.0, 0.0, 0.0),
    )
    if actor is None:
        fail(f"Failed to spawn actor '{label}'")
    actor.set_actor_label(label)
    set_actor_tags(actor, row)
    spline_component = find_spline_component(actor)
    configure_spline_component(spline_component, row)
    validate_spline_not_collapsed(spline_component, row)
    return actor


def create_building_actor(actor_class, row):
    label = f"{BUILDING_ACTOR_LABEL_PREFIX}_{sanitize_label_part(row.get('BuildingKey', row.get('Name', 'Building')))}"
    destroy_existing_actor_with_label(label)
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
    tags = [
        "OSM_BUILDING",
        "building",
        row.get("BuildingKey", ""),
        row.get("OsmId", ""),
        row.get("Name", ""),
        row.get("Type", ""),
        row.get("Address", ""),
    ]
    set_tags(actor, tags)
    set_payload_if_present(actor, row, "OSM_BUILDING")
    return actor


def create_tree_actor(actor_class, row):
    label = f"{TREE_ACTOR_LABEL_PREFIX}_{sanitize_label_part(row.get('TreeKey', row.get('Name', 'Tree')))}"
    destroy_existing_actor_with_label(label)
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
    tags = [
        "OSM_TREE",
        "tree",
        row.get("TreeKey", ""),
        row.get("OsmId", ""),
        row.get("Type", ""),
        row.get("HeightCm", ""),
        row.get("CrownDiameterCm", ""),
        row.get("Species", ""),
        row.get("LeafType", ""),
    ]
    set_tags(actor, tags)
    set_payload_if_present(actor, row, "OSM_TREE")
    return actor


def create_prop_actor(actor_class, row):
    label_name = row.get("DisplayName") or row.get("Name") or row.get("Type") or row.get("PropKey", "Prop")
    label = f"{PROP_ACTOR_LABEL_PREFIX}_{sanitize_label_part(label_name)}_{sanitize_label_part(row.get('OsmId', ''))}"
    destroy_existing_actor_with_label(label)
    location = unreal.Vector(
        float(row["X"]) + WORLD_OFFSET_CM.x,
        float(row["Y"]) + WORLD_OFFSET_CM.y,
        float(row.get("Z", 0.0)) + WORLD_OFFSET_CM.z,
    )
    yaw = float(row.get("Direction") or 0.0)
    actor = unreal.EditorLevelLibrary.spawn_actor_from_class(actor_class, location, unreal.Rotator(0.0, yaw, 0.0))
    if actor is None:
        fail(f"Failed to spawn actor '{label}'")
    actor.set_actor_label(label)
    height_scale = max(0.1, float(row.get("HeightCm", CUBE_BASE_CM)) / CUBE_BASE_CM)
    actor.set_actor_scale3d(unreal.Vector(0.25, 0.25, height_scale))
    tags = [
        "OSM_PROP",
        "prop",
        row.get("Category", ""),
        row.get("DisplayName", ""),
        row.get("PropKey", ""),
        row.get("OsmId", ""),
        row.get("Type", ""),
        row.get("Ref", ""),
        row.get("Address", ""),
    ]
    set_tags(actor, tags)
    set_payload_if_present(actor, row, "OSM_PROP")
    return actor


def main():
    bp_class_cache = {}
    point_count = 0
    rows = [require_spline(source_row, index) for index, source_row in enumerate(STREET_SPLINES)]
    rows = dedupe_spline_rows(rows)
    rows = uniquify_actor_labels(rows)
    for row in rows:
        point_count += len(row["Points"])
        actor_class = bp_class_for_row(row, bp_class_cache)
        create_street_spline_actor(actor_class, row)
    building_actor_class = load_bp_class(BP_PATHS["building"]) if BUILDINGS else None
    for row in BUILDINGS:
        create_building_actor(building_actor_class, row)
    tree_actor_class = load_bp_class(BP_PATHS["tree"]) if TREES else None
    for row in TREES:
        create_tree_actor(tree_actor_class, row)
    prop_actor_class = load_bp_class(BP_PATHS["prop"]) if PROPS else None
    for row in PROPS:
        create_prop_actor(prop_actor_class, row)
    unreal.log(f"[INFO] Imported {len(rows)} city street splines from {point_count} points, {len(BUILDINGS)} buildings, {len(TREES)} trees and {len(PROPS)} props")


main()
