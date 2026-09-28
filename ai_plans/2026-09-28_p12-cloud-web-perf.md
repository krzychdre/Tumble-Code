# P12: cloud web panel transfer and query costs

Roadmap item: `ai_plans/2026-09-27_simplification-roadmap.md`, section 4, **P12**.

> Problem: "Cloud web: no gzip, 290 KB Chart.js for three charts, per-level
> ancestor queries (N+1), settings page runs a full size scan on every GET."
> Fix: "`GZipMiddleware`; versioned vendor scripts with long cache; recursive
> CTE; size scan on demand."

Branch: `perf/p12-cloud-web` (off main @ f615cc4f4). Everything is in
`self-hosted-cloudapi/`; paths below are relative to it.

## 1. Claims verified on main @ f615cc4f4

| Claim                  | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No gzip                | `src/main.py` :119-131 adds CORS, CSRF, WebAccess, RequestLogging, SlowAPI and nothing that compresses. The live container (`curl` with and without `Accept-Encoding: gzip`): `chart.umd.min.js` 290193 B both ways, `socket.io.min.js` 67368 B, `app.css` 58137 B.                                                                                                                                                                                                   |
| 290 KB Chart.js        | `src/web/static/vendor/chart.umd.min.js` is 290193 B, loaded by `src/web/templates/metrics.html` :182 (only when the period has data).                                                                                                                                                                                                                                                                                                                              |
| No versioned vendor URL, no cache header | `metrics.html` :182 and `task_detail.html` :194, :195, :199 load `/static/vendor/*.js` without `?v=` (the app's own files at :183-184, :196-197, :200 and `base.html` :8 already carry it). `src/main.py` :164-166 mounts a plain `StaticFiles`: the live response has `etag` and `last-modified` but no `Cache-Control`, so browsers revalidate or re-download heuristically. The token (`src/web/templating.py` :19-32) is the newest mtime of the bundle, which a checkout or image build can leave unchanged across a content change. |
| Per-level ancestor queries | `src/services/task_tree.py` :257-277, `ancestors()` runs one `SELECT ... WHERE id = parent` per level; called by the task page (`src/routers/web_tasks.py` :155). Measured with a `before_cursor_execute` listener: 6 SELECTs for a chain of 7; the task page runs 5 SELECTs at depth 2 and 11 at depth 8.                                                                                                                                                           |
| Full size scan on every settings GET | `src/routers/web_settings.py` :40 calls `plan_sweep()`, which sums `length(message_data)` over every selected message and `length(properties)` over every selected event (`src/services/retention_service.py` :186-202). Live Postgres, 186 tasks / 33 791 messages / 49 941 events, worst case (everything selected), `EXPLAIN ANALYZE` two runs: messages 557/484 ms with the sum vs 18/15 ms count only; events 366/317 ms vs 26/26 ms. About 0.85 s of 0.9 s per page load is the sums. |

`subtrees()` (the downward walk, :132-170) is also one query per level, but per
tree level of a whole page, not per task; it is pinned by
`test_the_tree_costs_a_query_per_level_not_per_run` and was left as is.

## 2. Fixes

1. **Gzip.** `GZipMiddleware(minimum_size=1024)` added as the innermost
   middleware. It has to be innermost: the BaseHTTPMiddleware layers
   (request logging, access, CSRF) re-stream a body in chunks, and a GZip
   outside them saw `more_body=True` on the first chunk and compressed even
   the 30-byte `/health` answer. Starlette skips `text/event-stream` and
   bodies that already carry `Content-Encoding` (the socket.io bridge
   compresses its own polling responses).
2. **Versioned vendor scripts with a long cache.** Every `/static/` URL in
   the templates now carries `?v={{ asset_v }}`. `src/web/static_files.py`
   (`VersionedStaticFiles`) adds `Cache-Control: public, max-age=31536000,
   immutable` when the request's `v` equals the current token; no token or an
   old token keeps plain ETag revalidation. The token is now a SHA-256 over
   the bundle's paths and bytes (12 hex chars, computed once at import,
   about 0.5 MB read), because an immutable cache is only safe when every
   content change changes the URL.
3. **Recursive CTE.** `_ancestor_query()` builds `WITH RECURSIVE
   ancestor_chain` climbing `parent_task_id`, bounded by a `depth` column at
   `limit`, so a cycle in the client-supplied links just repeats rows until
   the depth runs out. `ancestors()` runs it once and walks the result with
   the same seen-set and cycle warning as before (same order, same limit,
   no query at all for a root task). Checked on the live Postgres 16 with the
   compiled statement: returns the two ancestors of a depth-3 task.
4. **Size on demand.** `plan_sweep(..., measure_size=False)` selects the same
   tasks and still counts messages and events, but selects a literal 0
   instead of summing payload lengths; `RetentionPlan.size_measured` says
   which. `GET /app/settings` uses it; the "Freed (approx.)" tile shows a
   "Calculate" link to `/app/settings?size=1`, which renders the same page
   with the size. The sweep (`apply_sweep`, scheduled and "Run now") still
   measures, since it logs the size and deletes anyway.

Chart.js stays: with gzip plus a one-year cache it is 82 KB once per deploy,
and replacing three charts is not trivial.

## 3. Tests

New `tests/test_cloud_web_perf.py`, 16 tests; commit 1 has 10 failing on main,
6 pinning behaviour the fix keeps (ancestor limit and order, no query for a
root, small and `identity` responses stay plain, unversioned or stale URLs are
not cached for a year, `?size=1` shows the size).

Existing tests adjusted for the intended change: `tests/test_route_table.py`
(the settings GET gains the `size` query parameter),
`tests/test_formatting_call_sites.py` (the duck-typed plan gains
`size_measured`).

## 4. Results

| Measure                                   | Before                  | After                               |
| ----------------------------------------- | ----------------------- | ----------------------------------- |
| `chart.umd.min.js` on the wire            | 290 193 B               | 81 947 B, then cached for a year    |
| `socket.io.min.js` / `app.css`            | 67 368 B / 58 137 B     | 17 352 B / 13 847 B (58 313 B raw)  |
| Vendor script on a repeat visit           | revalidated or refetched | served from cache, no request      |
| Ancestor SELECTs, chain of 7              | 6                       | 1                                   |
| Task page SELECTs, depth 2 vs depth 8     | 5 vs 11                 | 5 vs 5                              |
| Settings GET, live corpus, all selected   | ~0.9 s of SQL           | ~40 ms (sums only on "Calculate")   |

Full cloud suite, single process: 867 passed, 1 xfailed.

## 5. Residuals

- The api image must be rebuilt for any of this to be live.
- Gzip now covers the JSON auth endpoints too. The classic BREACH attack
  needs a secret and attacker-reflected input in the same compressed
  response, repeatedly fetched with the victim's cookies; the web panel has
  no CSRF token in its pages (CSRF is an Origin check), so no concrete path
  was found, but it was not audited endpoint by endpoint.
- `subtrees()` stays per level (see section 1).
