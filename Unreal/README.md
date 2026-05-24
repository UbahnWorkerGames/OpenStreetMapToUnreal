# Unreal Import Script

`import_osm_street_splines.py` is the reusable source importer for Unreal projects.

It supports both JSON shapes produced by the web tool:

- `PCG JSON`: flat DataTable rows with `SplineKey`, `PointIndex`, `X`, `Y`, `Z`
- compact spline rows with `Points`

Default setup:

1. Export `PCG JSON` from the web tool.
2. Copy it next to this script as:

   ```text
   ue-pcg-area-splines.json
   ```

3. In Unreal, run:

   ```text
   Tools > Execute Python Script...
   ```

4. Pick `import_osm_street_splines.py`.

Before running, check these constants at the top of the script:

```python
SOURCE_JSON_PATH
STREET_BP_PATH
SPLINE_COMPONENT_NAMES
ACTOR_LABEL_PREFIX
```

Safety note: this script deletes existing actors whose labels start with `CITY_STREET_` before recreating them.
