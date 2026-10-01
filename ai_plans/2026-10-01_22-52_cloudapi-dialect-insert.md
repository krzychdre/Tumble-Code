# Cloud API: one `dialect_insert` helper, top-level imports, dead theme event (C15)

Status: done on `refactor/cloudapi-dialect-insert`, PR open.

## Touched files

- `self-hosted-cloudapi/src/database.py` (new `dialect_insert(db)`)
- `self-hosted-cloudapi/src/services/telemetry_service.py`, `src/services/share_service.py`
- `self-hosted-cloudapi/src/web/static/theme.js`
- `self-hosted-cloudapi/tests/browser/theme_checks.html`, `tests/test_browser_js.py`, `tests/test_dialect_insert.py` (new)

## Problem

- The choice between `sqlalchemy.dialects.postgresql.insert` and `sqlalchemy.dialects.sqlite.insert` (the ones with
  `on_conflict_do_*`) was written out three times: `telemetry_service.py` `_get_or_create_task` (~97-108),
  `upsert_task_message` (~390-395) and `share_service.py` `share_task` (~75-79).
- `telemetry_service.py` had 23 function-local imports in 9 functions. None of the imported modules
  (`task_tree`, `model_attribution`, `session_quality`, `task_summary`, `models.task`) imports `telemetry_service`,
  so there was no cycle to break.
- `theme.js:64` dispatched `tumble:theme` on every theme change "so the metrics charts can draw again", but nothing
  listens: `git grep tumble:theme` finds only the dispatch, its comment (line 11) and the browser check that counted
  the events. The charts are server-rendered SVG coloured by CSS variables since #617.

## Fix

- `dialect_insert(db)` in `src/database.py` returns the dialect's `insert` for `postgresql` and `sqlite`, None
  otherwise. `_get_or_create_task` and `upsert_task_message` keep their plain-insert fallback on None; the statements
  themselves (index elements, `set_`, the monotonic `where` on partials) are unchanged.
- All function-local imports of `telemetry_service.py` moved to the top (checked by importing
  `src.services.telemetry_service` first in a fresh interpreter, then `src.main`; `ruff --select F` clean).
- The `tumble:theme` dispatch, its comment and the browser check for it are removed (theme_checks.html: 7 checks).

## Tests

- New `tests/test_dialect_insert.py`: Postgres and SQLite get their own insert, any other dialect None, the test
  session is SQLite.
- Whole cloudapi suite: 949 passed, 1 xfailed (incl. the race tests `test_task_row_race.py`, `test_cloud_races.py`
  that exercise both upserts on SQLite, and `test_browser_js.py` in headless Chrome).

## Notes

- `share_service` never had a non-ON-CONFLICT fallback (it used the SQLite insert on any non-Postgres dialect); on
  an unsupported dialect it now fails with a TypeError instead of a compile error. Only Postgres and SQLite are
  supported.
- Other modules in `src/` still have function-local imports; this item covered `telemetry_service.py` only.
