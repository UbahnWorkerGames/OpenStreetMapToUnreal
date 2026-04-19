U8 UE Import Package

Files in this package:
- ue_import_u8_spline_source.py
- *.json

Expected Unreal assets:
- /Game/_UbahnWorkerGames/Blueprint/TrainElements/BP_Rail.BP_Rail
- /Game/_UbahnWorkerGames/Blueprint/BahnHofModular/BP_StationTrigger.BP_StationTrigger

Usage:
1. Keep the Python script and the JSON export files in the same folder.
2. Run ue_import_u8_spline_source.py inside the Unreal Python environment.
3. The script builds the BP_Rail spline and station actors from every JSON file in that folder.
4. Each JSON file is imported separately using its filename stem for actor labels.
5. The spline uses the exported final web route as an exact polyline.
6. Route and stations use the exported cm coordinates directly.
7. The export must use `X=East`, `Y=South`, `Z=Up` in absolute Web Mercator cm.
