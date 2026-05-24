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

Set `Street Path BP` in the web tool to the Blueprint you want to spawn. Default:

```text
/Game/_UbahnWorkerGames/TEST/BP_CityTest
```

The Blueprint must contain one `SplineComponent`. The generated Python importer looks for these names first:

```text
StreetSpline
Spline
```

The value is saved in the browser's local storage. If neither component name exists, the importer uses the first `SplineComponent` it finds. If the Blueprint has no `SplineComponent`, the import fails loudly.

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

## Web Tool Workflow

1. Start the web tool:

   ```powershell
   cd Tool
   npm install
   npm run dev
   ```

2. Set `Street Path BP` to your Unreal Blueprint path.
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

The generated script deletes existing actors whose labels start with:

```text
CITY_STREET_
```

Then it recreates one actor per exported street spline using the configured Blueprint and writes the spline points into the Blueprint's `SplineComponent`. That is intentional for repeatable imports, but it means actor labels matter.

## Expected Result

After running the Python code, the level should contain actors named like:

```text
CITY_STREET_<spline_key>
```

Each actor should contain the filled street spline and the tags listed above.

## Failure Policy

The importer should fail loudly when required data or Blueprint setup is missing. Do not add silent fallback data. Fix the missing Blueprint component, source data, or export settings instead.
