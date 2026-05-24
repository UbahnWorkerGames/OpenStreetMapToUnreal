U8 UE Import Package

Files in this package:
- ue_import_u8_spline_source.py
- ubahn-master-U8.json
- ue_import_city_street_splines.py
- ue-pcg-area-splines.json

Expected Unreal assets:
- /Game/_UbahnWorkerGames/Blueprint/TrainElements/BP_Rail.BP_Rail
- /Game/_UbahnWorkerGames/Blueprint/BahnHofModular/BP_StationTrigger.BP_StationTrigger

Usage:
1. Copy both files into the target project's TOOLS/Route folder.
2. Run ue_import_u8_spline_source.py inside the Unreal Python environment.
3. The script builds the BP_Rail spline and station actors from the web export.
4. The script now reads the master file directly (v4 with embedded UE fields).
5. The spline uses the exported final web route. Only platform sections are forced linear;
   everything else uses tangents so the curve stays close to the browser result.

City street spline import:
1. Export PCG JSON from the web app.
2. Copy it next to ue_import_city_street_splines.py as ue-pcg-area-splines.json.
3. Run ue_import_city_street_splines.py inside the Unreal Python environment.
4. The script groups rows by SplineKey, sorts by PointIndex, and creates one
   CITY_STREET_* actor with a SplineComponent per street.
5. Existing CITY_STREET_* actors are removed before import so repeated runs
   replace the generated street splines.
