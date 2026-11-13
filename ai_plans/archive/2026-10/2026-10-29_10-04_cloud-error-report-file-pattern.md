# Cloud: error-report signature in linear time and off the event loop (2026-10-29)

**Status:** implemented on `fix/cloud-error-report-file-pattern` (security audit 2026-10-28, section 4, remainder).
**Touched:** `self-hosted-cloudapi/src/services/problem_catalogue.py`, `src/services/error_report_service.py`,
`tests/test_problem_catalogue.py`, `tests/test_event_loop_offload.py`, `.changeset/cloud-error-report-file-names.md`.

## Symptom

`POST /api/error-reports` with `summary: ""` and `errorMessage: "a-" * 4000` (the schema allows 8 000 characters)
spent about 0.25 s of the single uvicorn worker's event loop in `problem_signature`; 16 000 characters of headline
(possible through the problems pages' samples) about 1 s. Sixty reports a minute, the default limit, block the loop
for a quarter of every minute.

## What was happening

- `_FILE = \b[\w\-]+\.[A-Za-z][A-Za-z0-9]{0,4}\b` (`problem_catalogue.py:738` before the fix): every dash makes a word
  boundary, and from each one `[\w\-]+` ran to the end of the run looking for a dot. A run of n words was scanned
  n times: quadratic. `_HEX` and `_PATH` were already linear (e4eef0883).
- `record_error_report` (`error_report_service.py:78`) built the row, signature included, on the event loop.

## Fix

- `_FILE` now matches the whole run of name characters and the extension only optionally:
  `\b[\w\-]+(\.[A-Za-z][A-Za-z0-9]{0,4}\b)?`, and `_blank_file` replaces the match with `<path>` only when the
  extension group matched. A dot can only follow at the end of a run, so every later start inside the same run
  fails the same way; consuming the run at its first start gives the same result in one pass. Over 300 000 random
  strings the old and the new substitution give identical output.
- `record_error_report` builds the row with `anyio.to_thread.run_sync(report_row, ...)`, as the other services do.

Timings (`problem_signature("tool_error", None, "a-" * (n // 2))`): 8 000 characters 289 ms before, 1.8 ms after;
16 000 characters 1 056 ms before, 3.4 ms after.

## Tests

- `test_a_long_headline_is_normalized_in_linear_time[dashed-words]`: `"a-" * 4000` and ten times that in under 1 s.
- `test_hex_ids_paths_and_file_names_are_still_blanked_as_before`: a dashed file name is blanked, a dashed word without
  an extension stays.
- `test_an_error_report_row_is_built_off_the_loop` (spy pattern of `test_event_loop_offload.py`).
- Mutations: the old `_FILE` turns the timing case red; `_blank_file` always returning `<path>` turns four cases red;
  calling `report_row` inline turns the offload test red.

## Not fixed

Nothing of section 4 stays open. The problems pages reuse a report's stored signature; occurrences built from older
telemetry error events (`problems/collect.py`, `telemetry_occurrence`) still compute theirs on the loop, but with
`_URL`, `_UUID`, `_HEX`, `_PATH` and `_FILE` all linear that costs time in proportion to the text.
