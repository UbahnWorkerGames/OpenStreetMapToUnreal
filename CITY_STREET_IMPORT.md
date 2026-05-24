# City Street Spline Import

This document describes the OSM street spline import workflow for Unreal. Generated street data can become very large and should not be committed.

## What Belongs In This Repository

Keep source and documentation here:

- `README.md`
- `Tool/index.html`
- `Tool/main.js`
- `Tool/package.json`
- `Tool/package-lock.json`
- `Tool/vite.config.js`
- `CITY_STREET_IMPORT.md`

Do not commit local/generated runtime output:

- `Tool/node_modules/`
- `Tool/dist/`
- downloaded `ue_import_city_street_splines_embedded.py`
- downloaded `ue-pcg-area-splines.json`
- huge raw Overpass response files
- Unreal `Saved/`, `Intermediate/`, `DerivedDataCache/`, local build output

## Unreal Blueprint Requirement

Set `Street Path BP` in the web tool to the spline Blueprint you want to spawn. Default:

```text
/Game/_UbahnWorkerGames/TEST/BP_CityTest
```

The Blueprint must contain one `SplineComponent`. The generated Python importer looks for these names first:

```text
StreetSpline
Spline
```

The value is saved in the browser's local storage. If neither component name exists, the importer uses the first `SplineComponent` it finds. If the Blueprint has no `SplineComponent`, the import fails loudly.

Set `Building Cube BP` to a Blueprint that contains a `100 x 100 x 100 cm` cube. The generated Python rotates and scales that actor to the exported building footprint width, depth, yaw, and height.

## Coordinate Origin

Area exports use one fixed Berlin WGS84 origin:

```text
lat 52.520008
lon 13.404954
```

Exported Unreal coordinates are centimeters from that origin with `X=East`, `Y=North`, and `Z=Up`. Because the origin is fixed, separate exports from different Berlin areas can be imported into the same level and will keep their real distance from each other.

## Actor Tags Written By The Importer

Every spawned city street actor gets these tags:

```text
CityStreet
Strasse Name:<street name or spline key>
Typ:<area category>
Breite:<width in meters>
SplineKey:<export key>
OsmClass:<OSM highway or railway class>
```

Optional tags:

```text
Bridge
Tunnel
```

`Breite` comes from OSM `width` when present, otherwise from `lanes * 3.5`, otherwise from a category default.

Every spawned building actor gets these tags:

```text
OSMBuilding
Building:<name or generated key>
Typ:<OSM building value>
WidthCm:<width>
DepthCm:<depth>
HeightCm:<height>
YawDeg:<rotation around Z>
OriginLat:<fixed export origin latitude>
OriginLon:<fixed export origin longitude>
CenterLat:<building center latitude>
CenterLon:<building center longitude>
```

## Web Tool Workflow

1. Start the web tool:

   ```powershell
   cd Tool
   npm install
   npm run dev
   ```

2. Set `Street Path BP` and `Building Cube BP` to your Unreal Blueprint paths.
3. Draw a map area with `Bereich`, or search an area with `Ort`.
4. Select only the layers you need.
5. Click `Overpass laden`.
6. Click `UE Python`.
7. Review and copy the Python code from the modal.

The web tool allows areas up to roughly `50 x 50 km` (`2500 km²`). Large `Stadtstrasse` and `Service` exports can still produce many segments and take a while.

## Unreal Execution

In Unreal, open the Python console or use `Tools > Execute Python Script`.

Paste the copied Python code from the modal into the Python console and run it. The tool source in `Tool/main.js` is the source-controlled version of the generated import logic.

## Copy-Paste Safety Warning

The `UE Python` modal generates executable Python code. Treat it like any other script:

- read the code before running it
- make sure it targets the expected Blueprint path
- run it only in the intended Unreal project
- save or commit your level before running large imports
- do not paste and execute Python code from unknown sources

By default, the generated script keeps existing actors. If an actor with the same generated label already exists, it is updated in place; otherwise a new actor is spawned. Set `DELETE_BEFORE_IMPORT = True` in the generated script only when you intentionally want to replace all generated actors with these prefixes:

```text
CITY_STREET_
OSM_BUILDING_
```

The generated actor labels matter because they are used to update existing imported actors:

## Expected Result

After running the Python code, the level should contain actors named like:

```text
CITY_STREET_<spline_key>
OSM_BUILDING_<building_key>
```

Street actors should contain filled splines. Building actors should be scaled cubes with the tags listed above.

## Failure Policy

The importer should fail loudly when required data or Blueprint setup is missing. Do not add silent fallback data. Fix the missing Blueprint component, source data, or export settings instead.
