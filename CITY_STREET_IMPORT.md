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

For buildings, the Actor transform is the primary placement data:

```text
Location.X = east offset in cm from Berlin origin
Location.Y = north offset in cm from Berlin origin
Location.Z = half building height in cm
Rotation.Yaw = footprint rotation in degrees
Scale.X/Y/Z = width/depth/height divided by 100 cm cube size
```

For traffic signs, the Actor transform is the primary placement data:

```text
Location.X = east offset in cm from Berlin origin
Location.Y = north offset in cm from Berlin origin
Location.Z = 0
```

For street, rail, sport, and water splines, the Actor transform is now also meaningful:

```text
Actor Location = first spline point in Berlin-origin cm
Spline point [0] = local 0/0/0
Other spline points = local offsets from the actor location
```

This keeps large Berlin coordinate values out of the SplineComponent's local point array and prevents Blueprint spline components from collapsing points onto each other when they rebuild.

## Actor Tags Written By The Importer

Every spawned city street actor gets raw value tags in this fixed order:

```text
[0] street_spline
[1] <export spline key>
[2] <street name or spline key>
[3] <area category: road, rail, sports_field, water, ...>
[4] <OSM highway or railway class>
[5] <width in meters>
[6] <OSM layer>
[7] <closed true/false>
[8] <bridge true/false>
[9] <tunnel true/false>
```

`Breite` comes from OSM `width` when present, otherwise from `lanes * 3.5`, otherwise from a category default.

Every spawned building actor gets raw value tags in this fixed order:

```text
[0] building
[1] <export building key>
[2] <OSM id>
[3] <name or generated key>
[4] <OSM building value>
[5] <X cm from Berlin origin>
[6] <Y cm from Berlin origin>
[7] <Z cm>
[8] <width cm>
[9] <depth cm>
[10] <height cm>
[11] <yaw degrees>
[12] <building center latitude>
[13] <building center longitude>
```

Every spawned traffic sign actor gets raw value tags in this fixed order:

```text
[0] <traffic_sign or traffic_signal>
[1] <export point key>
[2] <OSM id>
[3] <name, ref, traffic_sign value, or signal direction>
[4] <OSM traffic_sign value or highway=traffic_signals>
[5] <OSM direction value or traffic_signals:direction>
[6] <X cm from Berlin origin>
[7] <Y cm from Berlin origin>
[8] <Z cm>
[9] <point latitude>
[10] <point longitude>
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
OSM_SIGN_
OSM_SIGNAL_
```

The generated actor labels matter because they are used to update existing imported actors:

## Expected Result

After running the Python code, the level should contain actors named like:

```text
CITY_STREET_<spline_key>
OSM_BUILDING_<building_key>
OSM_SIGN_<sign_key>
OSM_SIGNAL_<signal_key>
```

Street actors should contain filled splines. Building actors should be scaled cubes with the tags listed above. Traffic sign and signal actors are empty marker actors with raw OSM values and Berlin-origin coordinates in their tags.

## Failure Policy

The importer should fail loudly when required data or Blueprint setup is missing. Do not add silent fallback data. Fix the missing Blueprint component, source data, or export settings instead.
