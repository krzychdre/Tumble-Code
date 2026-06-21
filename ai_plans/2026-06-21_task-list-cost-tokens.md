# Show cost & token counts on the cloud web task list

**Date:** 2026-06-21
**Branch:** feature/self-hosted-remote-task-control

## Problem

The server-rendered task list at `/app` ([tasks_list.html](../self-hosted-cloudapi/src/web/templates/tasks_list.html))
shows only a message-count badge and the updated date per task. The user wants each
row to also show that task's **total cost** and **token count**, the same totals the
detail view already surfaces in its header.

## Root cause / location

- Token/cost totals are not computed on the list path. The detail page derives them
  **client-side** in [render.js `getMetrics`](../self-hosted-cloudapi/src/web/static/render.js#L467):
  for every `say == "api_req_started"` message it parses `text` JSON and sums
  `tokensIn`, `tokensOut`, `cost`; for `say == "condense_context"` it adds
  `contextCondense.cost`. (`contextTokens` is list-irrelevant — that's a live header gauge.)
- The list handler [`task_list`](../self-hosted-cloudapi/src/routers/web.py#L92) already loads
  each task's messages (via `_load_task_messages`) to derive a title, so the same loop
  can feed a Python port of that aggregation — no extra DB round-trips.

## Fix

1. **web.py** — add `_compute_metrics(messages) -> dict` mirroring `getMetrics`:
   sum `tokensIn`/`tokensOut`/`cacheWrites`/`cacheReads`/`cost` over `api_req_started`
   say-messages (JSON in `text`), plus `condense_context` cost; also span
   `duration_ms` from first→last message `ts`. Add `_fmt_tokens(n)` compact formatter
   (B/M/k) mirroring `fmt()` in [live.js](../self-hosted-cloudapi/src/web/static/live.js#L54),
   `_fmt_duration(ms)` (`1h 1m` / `2m 5s` / `4s`), and `_metrics_tooltip(m)` building a
   multi-line hover string (in / out / cache / session / cost). In `task_list`, attach
   `tokens`, `cost`, `metrics_title` to each item (None when empty).
2. **tasks_list.html** — in `.task-meta`, add a tokens badge (compact total in+out) and
   a cost badge (`$x.xxxx`), each only rendered when non-zero, before the message-count
   badge. Both carry `title="{{ t.metrics_title }}"` — native tooltips honour the `\n`
   line breaks, giving the in/out/cached/duration/cost breakdown on hover.
3. **app.css** (if needed) — reuse the existing `.badge` style; add a muted modifier
   class only if visual separation is wanted. Prefer reusing existing classes.

## Tests

Extend [test_web_and_share.py](../self-hosted-cloudapi/tests/test_web_and_share.py):
add an `api_req_started` message with known `tokensIn/tokensOut/cost` to a list fixture
and assert the rendered list HTML contains the formatted token + cost badges.

## Scope

Server-side aggregation + template + one test. No change to the detail/live path or the
client `getMetrics` (single source of truth stays in render.js for the live header; the
Python port is list-only and intentionally small).
