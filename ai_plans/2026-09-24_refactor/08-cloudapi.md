# Self-hosted cloud API (`self-hosted-cloudapi`, Python)

The service is live and reachable from the LAN (and from the owner's phone). Its security defects are Phase 1
(`02-defects.md` DEF-S2 to DEF-S12); its test isolation and CI are Phase 0 (TEST-4, TEST-5); dependency floors are
Phase 2 (DEP-5); the maintainability items below are Phase 9. All findings were checked against the code; the
security ones were reproduced with probe tests in a copy under `/tmp`. The test suite passed 233/233 in 16.6 s in a
clean copy.

## Structure

| Area                      | Lines                   | Notes                                                                                                                                                                                                                             |
| ------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/routers` (8 files)   | 1,929                   | `web.py` 967 (Jinja panel), `browser.py` 423 (sign-in flow, HTML built as Python strings), `auth.py` 213 (Clerk-compatible `/v1` facade), `extension.py` 94, `events.py` 86, `proxy.py` 62, `settings.py` 57, `marketplace.py` 27 |
| `src/services` (16 files) | 2,975                   | business logic and almost all queries (no repository layer); largest `telemetry_service` 355, `model_attribution` 346, `task_summary` 336                                                                                         |
| `src/models`              | 529                     | the schema's source of truth (`create_all`)                                                                                                                                                                                       |
| `src/schemas`             | 302                     | Pydantic mirrors of the extension's Zod schemas                                                                                                                                                                                   |
| `src/auth`                | 651                     | Authentik OAuth, JWT via python-jose, signed web cookie, IP allowlist                                                                                                                                                             |
| `src/realtime`            | 341                     | socket.io relay and connection registry                                                                                                                                                                                           |
| `src/proxy`               | 457                     | OpenAI-compatible proxy stub                                                                                                                                                                                                      |
| Templates, own JS, CSS    | 742, 1,625, 2,552       | JSON islands feed the JS (`render.js` 808, `live.js` 404)                                                                                                                                                                         |
| Vendored JS               | 15,632                  | chart.js 4.4.7, marked 12.0.2, DOMPurify 3.1.6, socket.io client 4.8.3                                                                                                                                                            |
| Tests                     | 5,861 Python + 783 HTML | 13 files, 233 collected; browser checks run headless Chrome                                                                                                                                                                       |

No raw SQL anywhere. `web.py` runs 9 queries itself; the network-access middleware imports the router's templates
(`network_access.py:165`, an inverted dependency); import cycles are dodged with function-level imports
(`telemetry_service.py:23-32` and 8 more); singletons are built at import time (`settings`, the engine,
`templates`, the limiter, `sio`); `create_all` runs in `db_bootstrap.py:48` and again on every startup in
`main.py:33`.

**Not covered by tests:** `/v1/chat/completions`, `/v1/images/generations`, `/v1/models`, the marketplace,
`PATCH /api/user-settings`, `/bridge/config`, `/credit-balance`, `/v1/client/sessions/{id}/remove`, `/l/{slug}`,
CORS headers, rate limiting, `db_bootstrap`, alembic migrations, the retention loop, cross-user backfill, and
`</script>` inside message content (the last two are now DEF-S2 and DEF-S4 tests).

## Maintainability items (Phase 9), ranked by gain over risk

### CAPI-M3 One telemetry vocabulary (also fixes DEF-C31's retention bug)

"LLM Completion" is defined at `metrics_service.py:34` and `model_attribution.py:48` and as a literal at
`retention_service.py:45`; `TASK_KIND` twice (`metrics_service.py:47`, `model_attribution.py:63`); two label maps
say the same thing (`KIND_LABELS` `metrics_service.py:48-53`, `SIDE_CALL_LABELS` `model_attribution.py:243-247`);
the "parse JSON, skip non-dict" loop 3 times (`metrics_service.py:118-124, 207-213`, `model_attribution.py:114-120`);
`api_req_started` parsed twice (`task_summary.py:194-210`, `model_attribution.py:135-144`); an inline `num()` copy at
`metrics_service.py:93`; a docstring pointing at the removed `web._compute_metrics` (`:15`). **Change:**
`services/telemetry_vocab.py` with the names, kinds, labels, `iter_event_props()` and the `api_req_started` parser;
retention protects both event types. **Test first:** an identity test in the style of
`test_web_and_share.py:1333-1356`; "Embedding Usage survives a purge". **Size** S.

**Status CAPI-M3:** DONE 2026-09-26, #441 (merge d5bc8cf21), pytest 414 to 442 on the branch. `services/telemetry_vocab.py`
holds the event names, kinds, labels, `parse_event_props`/`iter_event_props` and `api_req_started_payload`; old names
re-exported. Already done before: the inline `num()` copy, retention protecting both event types (DEF-C31). Pinned,
not unified: `task_summary` requires `type == "say"` for `api_req_started`, `model_attribution` does not; a
non-string `completionKind` shows as its own row on the metrics page but counts as a conversation turn on the task
detail page (owner question).

### CAPI-M4 Formatting helpers, finished

The earlier extraction holds (`num`, `fmt_tokens`, `fmt_duration` exist only in `src/utils/format.py:13, 23, 36`,
guarded by an identity test). Still copied: cost as `f"${x:.4f}"` 7 times in `web.py` plus `"%.4f"|format` in
templates; thousands separators in `web.py` and `metrics.html`; `_fmt_bytes` (`web.py:838`) and `_plural`
(`web.py:167`) in the router; three JS token formatters that disagree (`live.js:51-68` no rounding, `metrics.js:52-65`
rounds, Python truncates) and cost formatted separately in 3 JS files. **Change:** `fmt_cost`, `fmt_int`,
`fmt_bytes`, `plural` in `utils/format.py`, registered as Jinja filters; one `static/format.js`; a pytest emits
golden vectors that a browser check compares against `format.js`. **Size** S to M.

**Status CAPI-M4:** DONE 2026-09-26, #446 (merge b04316070), pytest 587 to 642 on the branch (plus 2 strict xfails from
M8). `fmt_cost`, `fmt_int`, `fmt_bytes`, `plural`, `round_half_up` in `utils/format.py`, registered as Jinja filters;
one `static/format.js` (`window.TumbleFormat`) replaces the JS copies; 29 token and 10 cost golden vectors checked
against both Python and `format.js` in headless Chrome. Deliberate output changes: token counts below 1000 round
half up in both languages; exact decimal ties now round half up in Python too (as JS `toFixed` does), so 1,250 tokens
read "1.3k" and $0.03125 reads "$0.0313" everywhere (before, the server printed "1.2k"/"$0.0312" and the live header
"1.3k"). Left alone: the chart tooltip's `toLocaleString()` and the cost axis label.

### CAPI-M5 Split `routers/web.py` (967 lines, 31 functions)

9 routes and about 20 presenter helpers; `_quality_overview` (567-631) is business logic; the share access policy
sits inline (896-938). **Target:** `src/web/templating.py` (templates and filters; also fixes the inverted
middleware import), `src/web/presenters/{task_rows,task_detail,settings}.py`, `services/quality_overview.py`,
`services/task_access.py` (one shared-view policy, reused by the bridge's task join), routers `web_tasks`,
`web_metrics`, `web_settings`, `shared`. Pure moves with re-exports first. **Test first:** direct unit tests for
`_list_row`, `_spend_summary`, `_row_tooltip`, `_quality_overview` (today asserted only through rendered HTML).
Split the 3,372-line `test_web_and_share.py` along the same lines. **Existing:** 112 tests in that file plus the
phone-layout and browser checks. **Size** M, low risk.

**Status CAPI-M5:** DONE 2026-09-26, #453 (merge f403c5339), pytest 720 to 769. `routers/web.py` 959 to 89 lines (re-exports
only); `src/web/templating.py` 36 (the middleware now imports templates from here), presenters `task_rows` 215,
`task_detail` 183, `settings` 20; `services/quality_overview.py` 101 (with M9's `_QUALITY_COLUMNS`),
`services/task_access.py` 81 (`shared_view_access` verdict); routers `web_tasks` 250, `web_metrics` 46,
`web_settings` 114, `shared` 75; tests split, helpers in `tests/web_helpers.py`, same 123 test ids; route-table and
14-case share-policy tests; moved functions AST-identical, 10 pages and 4 redirects byte-identical. Not changed: the
bridge `task:join` is owner-only, a different policy than the share page; a stored visibility other than "public" is
treated as "organization"; `routers/browser.py` still builds its own `Jinja2Templates`.

### CAPI-M6 Route boilerplate into dependencies

Bearer-token parsing repeated 4 times in `routers/auth.py` (93, 138, 173, 204): a `client_session` dependency. The
"not logged in, redirect to `/app/login`" check repeated 9 times in `web.py`: `require_web_user` plus one exception
handler. Three near-identical sign-in handlers (`browser.py:152-217`, the `/l/{slug}` slug unused). Two HTML pages
built from Python strings (`browser.py:44-148`): templates. `dependencies.py:33-38` decodes the JWT twice and the
second path skips the issuer and version checks; `:17` and `:64` open a DB session per extension call without using
it. **Size** S each.

**Status CAPI-M6:** DONE 2026-09-26, #442 (merge 72035960e), pytest 452 to 561 on the branch (109 tests in
`test_route_boilerplate.py`). `client_session` dependency in `routers/auth.py`; `require_web_user` plus one
`LoginRequired` handler (303 to `/app/login`) for 8 web routes and `/shared`; one `_start_sign_in` for the three
sign-in routes (`/l/{slug}` kept, the extension builds it in `WebAuthService.ts`); the auth success and error pages are
Jinja templates; `get_current_user` no longer opens an unused DB session and decodes the JWT once. Visible change:
an anonymous `/app` request with an invalid query now gets 303 instead of 422. **Open (owner question):** the issuer
(`iss == "rcc"`) and version (`v == 1`) checks never decide anything, because a token failing them is decoded again
without them; the same pattern is in `realtime/sio.py::_user_id_from_token`. Every token this server ever issued
carries both claims (`jwt_issuer.py` since #112), so enforcing them would log nobody out.

### CAPI-M7 Configuration and bootstrap consistency

`BRIDGE_PATH` is configurable (`config/settings.py:140`) and advertised to clients but `main.py:143` hard-codes the
mount (DEF-C31); logging is never configured (the startup banner uses `print`, `main.py:35-79`); `README.md:134-135`
and `make migrate` say to run `alembic upgrade head` on a fresh database, which `db_bootstrap`'s own docstring says
cannot work; `README.md:257` links a missing `../plans/...`; `alembic/env.py:25-30` has its own `.env` parser; model
import lists duplicated in `main.py:24-30` and `alembic/env.py:14-20`; `create_all` on every startup hides a
forgotten migration for any new table [I]; `credit_system_enabled` changes nothing (`extension.py:84-94`); unused
code (`get_authentik_issuer_url`, `get_openid_configuration`, `issue_static_token`, `adapt_streaming_response`,
`create_session_and_token`, `count_descendants`, `AuthCallbackParams`, the `ProviderConfig` model); `ruff` reports
41 issues (38 auto-fixable unused imports); the dev venv is Python 3.13, the image 3.12. **Size** S to M.

**Status CAPI-M7:** DONE 2026-09-26, #445 (merge bb6a0fd8e), pytest 561 to 568 on the branch; `ruff check .` 58 to 0
findings, the CI lint step is now blocking. Stdlib logging configured once (`src/logging_setup.py`, `LOG_LEVEL`,
default INFO; the INFO lines of retention, bridge and sign-in were silently dropped before; request middleware moved
to DEBUG because uvicorn's access log already has it); banner through a logger. `create_all` removed from startup
(Docker runs `db-migrate.sh` first; running the server on an empty DB before `make migrate` produced tables without
`alembic_version`, classified LEGACY); README says run `make migrate` before first start. `alembic/env.py` uses the
app settings and `import src.models` (its own model list had drifted: `TaskRelation`, `RetentionPolicy` missing).
`credit_system_enabled` removed, `/credit-balance` kept and tested. Dead code removed (incl. three unused Authentik URL
helpers); `ProviderConfig` kept (real table). Already done before: `BRIDGE_PATH` mount, Python 3.13 image, `make
migrate`, PyJWT, `adapt_streaming_response`. **Deploy check:** confirm the live container starts through
`docker-entrypoint.sh` (migrations before uvicorn), since startup no longer creates tables.

### CAPI-M8 Cross-language golden fixtures for token and cost aggregation

Three implementations: TypeScript `consolidateTokenUsage.ts:29` (authoritative), the JS port in `render.js:622-657`,
Python `task_summary.py:181-217`. **Change:** one shared fixture file (input messages, expected totals) checked by
vitest, pytest and a browser check. No cross-language code generation. Also the gate for zod 4 (DEP-8). **Size** M,
no risk.

**Status CAPI-M8:** DONE 2026-09-26, #444 (merge be1adbf47), test-only: `self-hosted-cloudapi/tests/fixtures/token_usage_golden.json`
(19 cases, TypeScript values authoritative) checked by vitest (`consolidateTokenUsage.golden.spec.ts` in
`packages/core`), pytest (`test_token_golden_fixtures.py`, sum of `message_metrics`) and headless Chrome
(`tests/browser/token_golden.js` against `render.js` `getMetrics`); pytest 561 to 580 plus 2 strict xfails. Known
divergences recorded in the fixture: (1) Python truncates fractional tokens (harmless, tokens are integers);
(2) Python raises on `NaN` in the request text, which would crash a whole backfill (fix branch
`fix/capi-backfill-nan-tokens`); (3) `render.js` picks contextTokens by highest `ts`, TypeScript by array order;
(4) `render.js` counts two requests with the same `ts` once (rows are keyed by `ts`). (3) and (4) are display-only
edge cases, left as they are.

### CAPI-M10 Guard against model and migration drift

No test touches `db_bootstrap` or alembic. **Change:** test `classify_and_seed` for its three states (fresh,
legacy, managed) on SQLite; a drift check that builds the baseline, runs migrations to head and expects
`compare_metadata` to find nothing (the datetime migration may need Postgres). **Size** M.

**Status CAPI-M10:** DONE 2026-09-26, #449 (merge 16161bdc6), test-only, pytest 642 to 653 plus 1 strict xfail.
`tests/test_migration_drift.py`: `classify_and_seed` in FRESH/LEGACY/MANAGED, `db-migrate.sh` end to end with a fake
`uv`, and a drift check (frozen pre-alembic schema `tests/fixtures/baseline_schema_sqlite.sql`, stamp b2c3d4e5f6a7,
upgrade to head, `compare_metadata` with type and default comparison; a `KNOWN_DRIFT` allowance list that must stay
accurate). Findings: (1) real drift, the model declares `UniqueConstraint uq_task_messages_task_ts`, migration
`d4e5f6a7b8c9` creates a unique index of that name (follow-up branch); (2) `b2c3d4e5f6a7` (datetime timezone) cannot
run on SQLite, so the LEGACY path stops there on SQLite (Postgres fine). Untested (owner decision 23, SQLite only):
`b2c3d4e5f6a7` itself, the Postgres-only branches of the data migrations (`d4e5f6a7b8c9` duplicate cleanup,
`e1f2a3b4c5d6`, `f6a7b8c9d0e1`), timezone flags and `String` lengths (not seen by `compare_metadata` on SQLite).

### CAPI-M9 Metrics: SQL aggregation instead of Python over unbounded rows

`metrics_service.py:170-179` loads full `TelemetryEvent` rows with their JSON blob for the whole period ("all
time" has no bound) and parses them on the event loop; `models/event.py:14-23` has only single-column indexes
(`created_at` none); `web.py:583` loads full Task rows for `_quality_overview`. Code comments record 13,164
completions and a 146 MB `telemetry_events` table. **Way out that keeps SQLite tests:** (1) now, select only
`(properties, created_at)` and add an index on `(user_id, event_type, created_at)`; (2) next, copy the numeric and
dimension fields into their own columns at ingest (as `task_id` already is, `event.py:17-21`,
`telemetry_service.py:92-101`), backfill in a migration, aggregate with `GROUP BY`/`SUM`. **Test first:** pin the
whole `compute_user_metrics()` result for a seeded dataset including malformed rows. **Size** M (L with the
backfill), medium risk.

**Status CAPI-M9:** step 1 DONE 2026-09-26, #452 (merge e22f06097), pytest 711 to 720. The metrics computation selects
only `(properties, created_at)`, `_quality_overview` only `id`, `title` and the ten `q_*` counters; composite index
`ix_telemetry_events_user_type_created` on the model and in migration a3b4c5d6e7f8. Measured on a copy of the live
database (2,811 completions for the heaviest user, 20,328 rows, 36 MB; median of 3 x 40 warm runs): all time 64.6 to
58.5 ms (DB 9.5 to 8.6 ms), 30 days 64.9 to 56.2, 7 days 25.5 to 20.5 (EXPLAIN 4.1 to 0.96 ms), today 3.9 to 2.2. The
time is the Python loop (about 18 us per event, mostly `json.loads`), not the database. **Step 2 not needed**
(decision 20): revisit at roughly 10,000 events per user per period. `ix_telemetry_events_user_id` is now redundant
(left in place). The plan's 13,164 completions and 146 MB are stale (retention).

### CAPI-M11 Bridge: stop the per-chunk tree-link queries

`telemetry_service.py:277` runs `_link_task_tree` (2 to 4 queries) on every streamed chunk; run it only when the
task row is created (`task_tree.py:64-71` already stamps rows that exist when the link arrives). **Test first:**
ordering permutations (child first, parent first, relation last). **Size** S, medium risk (hot path).

**Status CAPI-M11:** DONE 2026-09-26, #440 (merge 8a9863ab1), pytest 414 to 424 on the branch. `_link_task_tree` runs only
when the bridge creates the task row: 20 chunks of an existing task went from 20 calls and 40 `task_relations` queries
to 0. All 6 arrival orders, a three-level tree and the concurrent miss (repaired by the next telemetry event with
`parentTaskId`) are tested. **Finding (new item, DEF-C47):** `record_relation` (`task_tree.py`) writes
`tasks.parent_task_id` on an existing child without checking the parent row exists; on Postgres the order "child
streams, relation, parent" should raise an IntegrityError (foreign key); SQLite tests do not enforce it. Not yet
reproduced on Postgres.

**Follow-ups merged 2026-09-26:** #447 (merge 3bdaa6af7, decision 24) one JWT decode in `jwt_issuer.decode_token`
requiring `iss == "rcc"` and integer `v == 1` for the extension API and the bridge, `static_token.py` removed;
#448 (merge c2827ef25, decision 25) `telemetry_vocab.completion_kind()` used by both pages; #451 (merge 4b66a863e)
NaN/Infinity in a request text is ignored like malformed JSON (TypeScript parity) and `num()` maps non-finite
floats to 0, so a backfill no longer fails; main pytest 711 passed, 2 xfailed. **New defects:** DEF-C48, live logs
show `tasks_pkey` violations from two concurrent first bridge chunks (the losing message is dropped); DEF-C49, a
shared-conversation upload fails with 500 when two messages share a `ts` (decision 26). Both plus the
`uq_task_messages_task_ts` model/migration drift are on one stacked fix branch set.

**DEF-C47:** DONE 2026-09-26, #454 (merge see git log), pytest 769 to 771. Reproduced on Postgres (copy of the live
data, scratch DB): child streams, then the relation event raised `ForeignKeyViolationError` (non-deferrable
`tasks_parent_task_id_fkey`), rolling back the whole telemetry request including the `task_relations` row. Not seen
live yet (no FK errors in the logs, all 19 live relations stamped). Fix: one UPDATE with `EXISTS` on the parent row;
a missing parent leaves the relation waiting for `link_pending_children` (the CAPI-M11 path). The task tree spec now
runs with `PRAGMA foreign_keys=ON`; suite-wide enforcement is a follow-up branch `test/capi-sqlite-foreign-keys`.

### CAPI-M12 CPU-heavy work off the event loop (lowest priority)

Backfill parsing (the whole upload read into memory at `events.py:65`), full-conversation JSON dumps
(`web.py:690`), metrics aggregation, the marketplace YAML read on every request (`marketplace_service.py:23, 43`,
two copied loaders). **Change:** `anyio.to_thread` for pure functions, cache the YAML, cap the upload size.

## Dependencies (DEP-5)

Audit: `pip-audit` against the `uv.lock` pins, 20 unique advisory IDs in 8 packages.

| Package                                                                   | Locked                     | Latest                           | Known vulnerabilities                                                                   | Upgrade risk                                         |
| ------------------------------------------------------------------------- | -------------------------- | -------------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| starlette                                                                 | 1.0.0                      | 1.7.0                            | CVE-2026-48710, -48817, -48818 (Windows), -54282, -54283 (form limits bypass)           | medium; test the bridge mount first                  |
| python-multipart                                                          | 0.0.27                     | 0.0.32                           | CVE-2026-53538, -53539, -53540 (reachable before login via `/v1/client/sign_ins` forms) | low                                                  |
| pydantic-settings                                                         | 2.14.0                     | 2.15.0                           | CVE-2026-58203 (nested `secrets_dir`, unused here)                                      | low                                                  |
| python-jose                                                               | 3.5.0                      | 3.5.0 (no release since 2025-05) | pulls `ecdsa` (CVE-2024-23342, no fix), `pyasn1`, `rsa`                                 | replace with PyJWT (4 call sites in `jwt_issuer.py`) |
| cryptography                                                              | 48.0.0                     | 50.0.1                           | GHSA-537c-gmf6-5ccf, CVE-2026-69247, -69248, -69249                                     | low                                                  |
| anyio                                                                     | 4.13.0                     | 4.15.1                           | CVE-2026-63374, -64847                                                                  | low                                                  |
| idna                                                                      | 3.13                       | 3.20                             | CVE-2026-45409                                                                          | low                                                  |
| pyasn1                                                                    | 0.6.3                      | 0.6.4                            | CVE-2026-59884, -59885, -59886                                                          | low, or gone with jose                               |
| fastapi, uvicorn, sqlalchemy, alembic, pydantic, python-socketio, slowapi | current minus a few minors |                                  | none                                                                                    | low                                                  |

Vendored front end: DOMPurify 3.1.6 to 3.4.16 (20 OSV advisories, DEF-S12); chart.js 4.4.7 to 4.5.1; marked 12 to
18 (six majors, medium); socket.io client current. Containers: `python:3.12-slim` floating (dev is 3.13), `uv:latest`
unpinned, `postgres:16-alpine` floating minor, `redis:alpine` floating major, Authentik `2026.2.2` while `2026.8.3` is
current and only the two latest lines get security support [I].

## Do not touch

The monotonic `ON CONFLICT` upsert in `upsert_task_message` (`telemetry_service.py:279-314`) and the final-only
refresh (`:322-355`), covered by `test_bridge.py:436-544`; `response_model_exclude_none=True` (`extension.py:29`,
`settings.py:29, 45`; the client's Zod `.optional()` rejects null); share returning 404 for unknown tasks (the
extension's backfill-then-retry depends on it); the `/bridge` prefix in the socket path and reading the client
address from the ASGI scope; the fresh/legacy/managed bootstrap and the no-op baseline migration; level-by-level
tree walks with cycle guards (SQLite compatibility); the denormalized summary and quality columns (they replaced a
list page that ran 387 queries and read 205 MB); the conservative `attribute_requests` matching; retention's
plan/apply pairing (extend the protected list, never shrink it); `client_allowed` in its three uses; vendored
libraries (replace whole files, never hand-edit); SQLite as the test database.

## Suggested order

Phase 0: TEST-4, TEST-5. Phase 1: DEF-S2 and DEF-S12, then S3, S4, S10, then S5 to S9 and S11, DEF-C31. Phase 2:
DEP-5. Phase 9: CAPI-M3, M4, M6, M7, M5, M8, M10, M11, M9, M12.
