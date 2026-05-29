# Agent Working Rules

- Before starting a task, check `git status` and identify existing changes.
- If the project is not a git repository yet, initialize one before making changes.
- Do not modify, revert, or discard unrelated user changes.
- Make one git commit after each meaningful step so work can be restored incrementally.
- Do not add silent fallbacks or workarounds that hide errors; stop on failures and fix the root cause.
- Run the relevant tests or build checks after changes when the project provides them.
- If a command fails, report the failure and address it directly before continuing.

## Version Log

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
