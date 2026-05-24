# OSM to Unreal

Web tool for turning OpenStreetMap area data into Unreal street spline actors.

The project is focused on OSM area selection, street/rail way extraction, and generated Unreal Python for a configurable street Blueprint.

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

1. Set `Street Path BP` to your Unreal Blueprint path.
2. Draw an area with `Bereich`, or search a place/postcode with `Ort`.
3. Select only the OSM layers you need.
4. Click `Overpass laden`.
5. Click `UE Python`.
6. Review the generated code, then copy it into Unreal Python.

## Build Check

```powershell
cd Tool
npm install
npm run build
```

## Unreal Target

The generated Python expects the Blueprint path configured in the tool. Default:

```text
/Game/_UbahnWorkerGames/TEST/BP_CityTest
```

The Blueprint must contain a `SplineComponent` named `StreetSpline` or `Spline`; otherwise the first available `SplineComponent` is used.

See `CITY_STREET_IMPORT.md` for details and copy-paste safety warnings.
