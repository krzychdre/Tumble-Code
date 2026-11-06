# Cloud API: dataset audit bounded by tasks too (security audit 2026-11-06, A-8)

**Status:** done on `perf/sec-cloud-queries`
**Touched:** `self-hosted-cloudapi/src/routers/web_dataset.py`, `src/web/templates/dataset_audit.html`, `tests/test_dataset_export.py`.

## Problem

`GET /app/dataset/audit` stopped only after `AUDIT_SAMPLE_LIMIT` samples. A corpus whose tasks yield few clean samples
made it reconstruct every task of the period (`load_task`, two queries plus a thread-pool parse each), holding a DB
session for as long as that took, on a plain GET.

## Fix

`AUDIT_TASK_LIMIT = 500`: the route slices the task id list it already loads and marks the page truncated when there
were more. The page says "stopped early: the audit reads at most N tasks and M samples".

## Tests

`test_the_audit_stops_at_its_task_limit` (limit patched to 0: "0 samples from 0 tasks (stopped early"); without the
slice it reads the fixture task.

## Notes

Server-only; api image rebuild owed.
