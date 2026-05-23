U8 UE Import Package

Files in this package:
- ue_import_u8_spline_source.py
- ubahn-master-U8.json

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
