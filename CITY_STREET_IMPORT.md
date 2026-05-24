# City Street Spline Import

This document describes the OSM city street spline import workflow for Unreal. It is intentionally separate from the legacy rail route import because the generated street data can become very large and should not be committed.

## What Belongs In This Repository

Keep source and documentation here:

- `README.md`
- `ue_import_u8_spline_source.py`
- `Tool/index.html`
- `Tool/main.js`
- `Tool/package.json`
- `Tool/package-lock.json`
- `Tool/vite.config.js`
- line source files such as `U8.json`
- curated generated DataTable examples in `generated/` when they are meant to be versioned
- documentation images such as `uemap-web-editor.png`

Do not commit local/generated runtime output:

- `Tool/node_modules/`
- `Tool/dist/`
- downloaded `ue_import_city_street_splines_embedded.py`
- downloaded `ue-pcg-area-splines.json`
- huge raw Overpass response files
- Unreal `Saved/`, `Intermediate/`, `DerivedDataCache/`, local build output

## Unreal Blueprint Requirement

Create or keep this Blueprint in the Unreal project:

```text
/Game/_UbahnWorkerGames/TEST/BP_CityTest
```

The Blueprint must contain one `SplineComponent`. The generated Python importer looks for these names first:

```text
StreetSpline
Spline
```

If neither name exists, it uses the first `SplineComponent` it finds. If the Blueprint has no `SplineComponent`, the import fails loudly.

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

2. Draw a map area with `Bereich`.
3. Select only the layers you need.
4. Click `OSM Bereich`.
5. Click `UE Python`.
6. Copy the Python code from the modal.

Large areas are allowed for lighter layers, but `Stadtstrasse` and `Service` should stay small because they produce many segments.

## Unreal Execution

In Unreal, open the Python console or use `Tools > Execute Python Script`.

For the modal workflow, paste the copied Python code into the Python console and run it.

## Copy-Paste Safety Warning

The `UE Python` modal generates executable Python code. Treat it like any other script:

- read the code before running it
- make sure it targets the expected Blueprint path
- run it only in the intended Unreal project
- save or commit your level before running large imports
- do not paste and execute Python code from unknown sources

The generated script deletes existing actors whose labels start with `CITY_STREET_` before recreating them. That is intentional for repeatable imports, but it means actor labels matter.

The script deletes existing actors whose labels start with:

```text
CITY_STREET_
```

Then it spawns one `BP_CityTest` actor per exported street spline and writes the spline points into the Blueprint's `SplineComponent`.

## Expected Result

After running the Python code, the level should contain actors named like:

```text
CITY_STREET_<spline_key>
```

Each actor should contain the filled street spline and the tags listed above.

## Failure Policy

The importer should fail loudly when required data or Blueprint setup is missing. Do not add silent fallback data. Fix the missing Blueprint component, source data, or export settings instead.
