# Backend web metrics page (tokens / cost / duration / models / modes)

**Branch:** `feature/web-metrics-page` (stacked off `feature/self-hosted-remote-task-control`)
**Date:** 2026-06-21

## Goal

Add a metrics/analytics page to the self-hosted cloud web view (`self-hosted-cloudapi`)
showing, for the logged-in user, with a period filter:

- **Tokens** used: input / output / cache-read / cache-write
- **Cost**
- **Session duration**
- **Models** used (dimension)
- **Modes** used (dimension)
- (bonus) **Providers** used

## Evidence — where the data lives (verified against the live `stork_code` DB)

The aggregation source is **`telemetry_events`**, NOT `task_messages`.

- `task_messages` only holds _shared/live_ tasks (22 rows). `api_req_started` JSON
  carries tokens/cost but **no model and no mode** (`ClineApiReqInfo` =
  `tokensIn/tokensOut/cacheWrites/cacheReads/cost/apiProtocol`).
- `telemetry_events` has 387 rows. The **`LLM Completion`** event
  (`TelemetryEventName.LLM_COMPLETION = "LLM Completion"`) carries every dimension:

    ```json
    {
    	"mode": "code",
    	"apiProvider": "openrouter",
    	"modelId": "nvidia/nemotron-3-super-120b-a12b:free",
    	"taskId": "019eeb06-...",
    	"inputTokens": 27633,
    	"outputTokens": 1752,
    	"cacheReadTokens": 0,
    	"cacheWriteTokens": 0,
    	"cost": 0
    }
    ```

- `telemetry_events.user_id` == web-session `user.id`
  (both `user_2c8fdf212b024808aa7a1ba1a`) → scope aggregation to
  `TelemetryEvent.user_id == user["user_id"]`. `organization_id` is null
  (single self-hosted user), so user-scoping is sufficient.
- Properties are stored as **TEXT** (JSON string). Tests run on **SQLite**
  (no jsonb operators) → aggregate in **Python** after loading rows, mirroring the
  existing `_compute_metrics` server-side pattern. Volume is modest.

## Decisions (confirmed with user)

- **Session duration** = per-`taskId` span (max−min event ts), summed across tasks;
  also surface the task count.
- **Charts**: real charts via a **vendored** library (consistent with
  `static/vendor/{marked,purify,socket.io}.min.js` — no CDN). Use **Chart.js**
  (single UMD file, no deps): per-day bars (tokens + cost) and doughnuts
  (tokens by model / by mode).

## Changes

### 1. `src/services/metrics_service.py` (new)

- `LLM_COMPLETION_EVENT = "LLM Completion"`.
- `PERIODS` map: `today`, `7d`, `30d`, `90d`, `all` → start `datetime` (UTC).
  (`today` = start of current UTC day.)
- `async def compute_user_metrics(db, user_id, period) -> dict`:
    - Select `TelemetryEvent` where `user_id == user_id`,
      `event_type == LLM Completion`, `created_at >= start` (if not `all`),
      order by `created_at`.
    - Parse `properties` JSON per row; coerce numbers via a local `_num`.
    - Accumulate:
        - totals: `input/output/cache_read/cache_write` tokens, `cost`,
          `completions` (row count).
        - `by_model[modelId]`, `by_mode[mode]`, `by_provider[apiProvider]`:
          tokens (in+out), cost, count.
        - `by_day[YYYY-MM-DD]`: tokens (in+out), cost — for the time series.
        - per-`taskId`: first/last ts → duration; sum → `total_duration_ms`,
          `task_count`.
    - Return a JSON-serializable dict: totals, sorted breakdown lists
      (desc by tokens), `by_day` (chronological), `duration`, `task_count`,
      `period`, and a `chart` payload (labels + datasets) ready for Chart.js.
- Reuse `_fmt_tokens` / `_fmt_duration` (move them from `web.py` into this
  service, or import). Keep formatting helpers shared.

### 2. `src/routers/web.py`

- `GET /app/metrics?period=7d`:
    - redirect to `/app/login` if no user.
    - validate `period` (default `7d`, fall back to `7d` on unknown).
    - call `compute_user_metrics`, render `metrics.html` with the dict +
      `chart_json = json.dumps(chart_payload)` + the list of period options for the
      selector.

### 3. `src/web/templates/metrics.html` (new, extends `base.html`)

- Period selector: links `?period=…` styled as a segmented control; active one
  highlighted.
- Summary stat cards: total tokens (with in/out/cache breakdown), total cost,
  session duration, task count, completion count.
- Two chart canvases: per-day bar (tokens & cost on dual axis) + two doughnuts
  (tokens by model, by mode).
- Breakdown tables: by model, by mode, by provider (tokens / cost / count).
- Empty state when no events in the period.
- `{% block scripts %}`: `<script src="/static/vendor/chart.umd.min.js">` +
  `<script src="/static/metrics.js?v=...">` + a `#metrics-data` JSON island.

### 4. `src/web/static/metrics.js` (new)

- Read `#metrics-data` JSON, instantiate Chart.js bar + doughnut charts with the
  VS Code dark palette (read CSS vars / hardcode accent colors). Guard if
  `window.Chart` is missing (best-effort, like live.js).

### 5. `src/web/static/vendor/chart.umd.min.js` (new, vendored)

- Download Chart.js v4 UMD build into vendor/ (same as other vendored libs).

### 6. `src/web/static/app.css`

- Add: `.metrics-nav`/segmented period control, `.stat-grid`/`.stat-card`,
  `.chart-grid`/`.chart-card`, `.breakdown` tables. Reuse existing CSS vars.

### 7. `src/web/templates/base.html`

- Add a primary nav (Tasks · Metrics) in the topbar so users can switch.
  Active-link styling via a `nav_active` context var (set per route).

### 8. Tests — `tests/test_web_and_share.py`

- Helper `_seed_event(db, user_id, event_type, properties, created_at)`.
- Seed several `LLM Completion` events (2 models, 2 modes, known token/cost),
  then:
    - `GET /app/metrics` 200 for a logged-in user; redirect when anonymous.
    - Totals reflect summed tokens/cost; model & mode names appear in the HTML.
    - `period` filtering excludes out-of-range events.
    - Unit-test `compute_user_metrics` directly for exact aggregate numbers,
      duration (per-task span), and breakdown ordering.

## Out of scope

- Org-wide / multi-user rollups (single self-hosted user; org_id null).
- Custom date-range picker (fixed period presets only for now).
- Editing/retention of telemetry events.
