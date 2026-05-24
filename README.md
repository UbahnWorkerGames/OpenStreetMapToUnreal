# OSM to Unreal

Web tool for turning OpenStreetMap area data into Unreal street spline actors.

The project is focused on OSM area selection, street/rail way extraction, and generated Unreal Python for `BP_CityTest`.

## What Is Here

- `Tool/` contains the browser tool.
- `CITY_STREET_IMPORT.md` documents the Unreal import workflow and safety notes.
- `.gitignore` excludes local install/build output and generated exports.

## What Is Not Committed

- generated Unreal Python snippets
- generated PCG/DataTable JSON
- raw Overpass responses
- `Tool/node_modules/`
- `Tool/dist/`
- Unreal local folders such as `Saved/`, `Intermediate/`, `DerivedDataCache/`

## Run The Tool

```powershell
cd Tool
npm install
npm run dev
```

Then:

1. Draw an area with `Bereich`, or search a place/postcode with `Ort`.
2. Select only the OSM layers you need.
3. Click `Overpass laden`.
4. Click `UE Python`.
5. Review the generated code, then copy it into Unreal Python.

## Build Check

```powershell
cd Tool
npm install
npm run build
```

## Unreal Target

The generated Python expects this Blueprint:

```text
/Game/_UbahnWorkerGames/TEST/BP_CityTest
```

The Blueprint must contain a `SplineComponent` named `StreetSpline` or `Spline`; otherwise the first available `SplineComponent` is used.

See `CITY_STREET_IMPORT.md` for details and copy-paste safety warnings.
