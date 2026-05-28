# Agent Working Rules

- Before starting a task, check `git status` and identify existing changes.
- If the project is not a git repository yet, initialize one before making changes.
- Do not modify, revert, or discard unrelated user changes.
- Make one git commit after each meaningful step so work can be restored incrementally.
- Do not add silent fallbacks or workarounds that hide errors; stop on failures and fix the root cause.
- Run the relevant tests or build checks after changes when the project provides them.
- If a command fails, report the failure and address it directly before continuing.

## Version Log

- 0.1.2 | 2026-05-28 21:31 +02:00 | Removed encoded JSON from Unreal actor tags; tag 0 is a plain object type again.
- 0.1.1 | 2026-05-28 21:27 +02:00 | Added visible app versioning and timestamp tracking.
