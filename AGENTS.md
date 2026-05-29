# Agent Working Rules

- Before starting a task, check `git status` and identify existing changes.
- If the project is not a git repository yet, initialize one before making changes.
- Do not modify, revert, or discard unrelated user changes.
- Make one git commit after each meaningful step so work can be restored incrementally.
- Do not add silent fallbacks or workarounds that hide errors; stop on failures and fix the root cause.
- Run the relevant tests or build checks after changes when the project provides them.
- If a command fails, report the failure and address it directly before continuing.

## Version Log

- 0.1.34 | 2026-05-29 20:18 +02:00 | Rich hover tooltips on all area features showing all OSM tags (species, height, lanes, address, etc.).
- 0.1.33 | 2026-05-29 19:21 +02:00 | Adds Esri World Imagery satellite layer toggle; export adapts to active layer (OSM or Esri tiles).
- 0.1.32 | 2026-05-29 15:20 +02:00 | Fixes tile Y-axis inversion in map PNG export (was producing degenerate crops).
- 0.1.31 | 2026-05-29 15:14 +02:00 | Replaces staticmap.openstreetmap.de with canvas-based tile rendering for map PNG export (tile server was down).
- 0.1.30 | 2026-05-29 15:11 +02:00 | Includes prop Type in actor labels for Outliner identification; adds Map PNG download button for manual ground plane texturing.
- 0.1.29 | 2026-05-29 16:30 +02:00 | Fixes building/tree label collision by always including OsmId in actor labels; adds prefix cleanup in main(); adds ground plane with static map texture under all elements; adds _unique_label() counter as collision safety net; 10s timeout on map image fetch.
- 0.1.28 | 2026-05-29 15:45 +02:00 | Overpass UX: spinner, cancel button, 95s timeout, auto-retry on 504, percentage progress, async batch processing to prevent browser freeze.
- 0.1.27 | 2026-05-29 15:10 +02:00 | Fixes prop rotation (Rotator yaw→roll parameter swap) and spline collapse via programmatic nudge workaround for UE5 editor bug.
- 0.1.26 | 2026-05-29 14:49 +02:00 | Keeps imported city street splines as editor-overridden local points and disables construction-script input that collapsed BP splines.
- 0.1.25 | 2026-05-29 14:36 +02:00 | Collapses named road exports to one averaged road axis and keeps spline points as construction-script input after import.
- 0.1.24 | 2026-05-29 14:04 +02:00 | Mirrors the area coordinate transform downward by negating north.
- 0.1.23 | 2026-05-29 13:59 +02:00 | Mirrors the area coordinate transform on UE Y by negating east.
- 0.1.22 | 2026-05-29 13:54 +02:00 | Removes the remaining UE Y-axis mirror from the area coordinate transform.
- 0.1.21 | 2026-05-29 13:45 +02:00 | Normalizes exported spline direction once and applies the requested rotated/mirrored area coordinate transform.
- 0.1.20 | 2026-05-29 13:31 +02:00 | Restores area axes to X=east/Y=north and deduplicates generated street splines by geometry instead of road label.
- 0.1.19 | 2026-05-29 13:17 +02:00 | Generates ActorLabel in the web export and rejects missing or Unnamed spline labels in the Unreal importer.
- 0.1.18 | 2026-05-29 13:04 +02:00 | Clips full area road ways to a context margin and deduplicates generated street actors by final Outliner label before spawn.
- 0.1.17 | 2026-05-29 12:49 +02:00 | Loads full Overpass way geometry for area roads and groups directional roads by street name instead of highway subclass.
- 0.1.16 | 2026-05-29 12:35 +02:00 | Normalizes road spline export groups to remove duplicate direction overlays and hardens actor labels against missing street names.
- 0.1.15 | 2026-05-29 12:18 +02:00 | Preserves umlauts in actor labels, merges same-road directional carriageways before export, and maps area coordinates as X=north/Y=east.
- 0.1.14 | 2026-05-29 11:58 +02:00 | Names street actors as BP_<road kind>_<street name>, exports full intersecting road ways, and avoids the collapsing construction-input mode.
- 0.1.13 | 2026-05-29 11:42 +02:00 | Stitches visible spline exports more aggressively and preserves imported spline points for later Blueprint construction reruns.
- 0.1.12 | 2026-05-29 11:27 +02:00 | Applies street actor metadata before final spline writes so payload changes cannot reset generated spline geometry.
- 0.1.11 | 2026-05-29 11:18 +02:00 | Places generated street actors at their first spline point and writes spline points relative to that actor origin.
- 0.1.10 | 2026-05-29 11:07 +02:00 | Restores the pre-0.1.4 spline construction flags so Blueprint construction scripts do not collapse street spline points.
- 0.1.9 | 2026-05-29 10:56 +02:00 | Restores the known-good local spline write path while retaining the fixed area-export world origin.
- 0.1.8 | 2026-05-29 10:47 +02:00 | Writes generated street spline points in world space without component offset hacks and fails if a spline collapses.
- 0.1.7 | 2026-05-29 10:34 +02:00 | Keeps generated spline point values in world space while placing street actors at their first point.
- 0.1.6 | 2026-05-29 10:22 +02:00 | Uses a fixed Berlin area-export origin so separate sector imports align in one Unreal world.
- 0.1.5 | 2026-05-29 10:21 +02:00 | Spawns street spline actors at their first point and stores generated spline points locally.
- 0.1.4 | 2026-05-28 22:10 +02:00 | Replaces only matching Unreal actors and preserves existing exports; passes spline points through construction scripts.
- 0.1.3 | 2026-05-28 21:40 +02:00 | Sets Blueprint payload map when available and broadens traffic sign discovery.
- 0.1.2 | 2026-05-28 21:31 +02:00 | Removed encoded JSON from Unreal actor tags; tag 0 is a plain object type again.
- 0.1.1 | 2026-05-28 21:27 +02:00 | Added visible app versioning and timestamp tracking.
