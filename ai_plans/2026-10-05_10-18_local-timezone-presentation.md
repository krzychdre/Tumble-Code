# Local time zone in presentation: store UTC, show and count in the client's zone

Status: planned (not started)

Rule for the whole change: **storage stays UTC; every human-facing date and every "day"
(today, daily buckets, date filters) is computed in the time zone of whoever is looking.**
Machine-facing data (JSONL exports, API payloads, epoch fields) stays UTC with an explicit
offset.

## Problem (evidence)

An agent answering "how many tokens today" compared llama-swap (local day,
`2026-10-05T10:09+02:00`) with cloudapi queried from `created_at >= '2026-10-05'` (UTC
midnight). The 00:00-02:00 local slice (130 requests, 16.9M tokens) is still 4 October in
UTC, so the numbers looked like "15M vs 30M" although both sides had logged the same 460
requests and 37 155 712 input tokens. Two independent causes:

1. **The model is never told the local wall-clock time.**
   `src/core/environment/getEnvironmentDetails.ts:250-259` emits
   `Current time in ISO 8601 UTC format: <toISOString()>` plus
   `User time zone: Europe/Warsaw, UTC+2:00`. The model has to do the offset arithmetic
   itself, and weak models (and sometimes strong ones) do not; they take the UTC date as
   "today".
2. **The cloud web GUI knows nothing about the viewer's zone.** No cookie, header or setting
   carries it. Every day boundary is UTC:
    - `services/metrics_service.py:61-69` `period_start("today")` = UTC midnight; 7d/30d/90d
      are rolling (`now - delta`), so the first chart bucket is a partial day.
    - `metrics_service.py:259` daily bucket `created.strftime("%Y-%m-%d")` on UTC `created_at`.
    - `web/presenters/task_list.py:235-239,269-270` `?since/?until` = UTC midnight.
    - `services/problems/views.py:81,224` group occurrences by UTC date.
    - `services/problems/base.py:108-109` `fmt_when` prints UTC (sometimes labelled, at
      `diagnostics.html:125,163` not).
    - `tasks_list.html:194`, `settings.html:73` print UTC without a label; the browser
      localizer meant for them (`static/render.js:778-783`) is only loaded on the task detail
      page, so it never runs where those elements are.
    - Download filenames (`routers/web_dataset.py:116`, `routers/web_diagnostics.py:102`)
      use the UTC date.

Smaller CLI inconsistencies: `tumble list` prints `toISOString()` (UTC,
`apps/cli/src/commands/cli/list.ts:95`); the transcript export header is UTC
(`ui/utils/transcriptExport.ts:148`) while its filename is local (`:191-196`).

Already correct, keep as is: all DB columns are `DateTime(timezone=True)` (Postgres
timestamptz), defaults are `datetime.now(timezone.utc)` / `func.now()`, client stamps are
epoch ms converted with `tz=timezone.utc`. The VS Code webview already shows local time
everywhere (`webview-ui/src/utils/format.ts`, `useGroupedTasks.ts`).

## Design decisions

### D1. Where the cloud learns the viewer's zone: a cookie written by the browser

- `static/app.js` (loaded on every `/app` page, CSP allows only `script-src 'self'`, so no
  inline script) reads `Intl.DateTimeFormat().resolvedOptions().timeZone` and writes cookie
  `tumble_tz=<IANA name>` (path `/`, 1 year, `SameSite=Lax`) when it is missing or differs.
- The server reads it through one dependency, `client_zone(request) -> ZoneInfo`. It accepts
  only names in `zoneinfo.available_timezones()`; anything else, or no cookie, gives UTC.
- First visit (no cookie yet): the page is rendered in UTC with an explicit "UTC" label.
  `app.js` then sets the cookie and reloads **once**, only if the page is marked
  `data-tz-sensitive` and only if the cookie actually stuck (read it back), so blocked
  cookies cannot cause a reload loop.
- Why server side and not "let JS convert": daily sums and "today" are aggregations. The
  browser only receives the finished buckets, so it cannot re-cut them; the server has to
  know the zone before it groups.
- Why not a DB user setting first: the zone belongs to the device, not the account (a laptop
  that travels, a phone in another zone). A per-account override can be added later on top
  of the same `client_zone` dependency without touching any call site.

### D2. One server helper module for all zone math

New `src/utils/clientzone.py` (name to match the existing `utils/format.py`):

- `client_zone(request)` (D1).
- `as_utc(dt)`: the existing "SQLite returns naive, attach UTC" logic now repeated in
  `problems/base.py:103`, `metrics_service.py:84`, `dataset_export.py:120` and others;
  consolidated here.
- `local_day(dt, zone) -> date`: `as_utc(dt).astimezone(zone).date()`.
- `day_start_utc(day, zone) -> datetime`: local midnight of `day` as a UTC instant, built as
  `datetime.combine(day, time.min, tzinfo=zone).astimezone(timezone.utc)`. This is the
  single place that handles DST: a day can be 23 or 25 hours long (EU: 2026-10-25 has 25
  hours), and in a few zones midnight itself does not exist on the switch day; the
  round-trip through UTC normalises it.
- `fmt_local(dt, zone)`: `YYYY-MM-DD HH:MM` in the zone, plus the zone abbreviation
  (`CEST`) only when the zone is UTC, so a stale UTC rendering is never mistaken for local.

Never use `timedelta(days=1)` on an aware local datetime to get "tomorrow's midnight"; always
go `date + 1` then `day_start_utc`. That is the classic DST bug.

### D3. Periods become calendar-aligned in the client zone

- `today` = from local midnight today.
- `7d` / `30d` / `90d` = today plus the previous 6 / 29 / 89 **full local days** (was: a
  rolling `now - 7 days`). The chart and the daily table then never start with a partial
  day, and "7 days" means seven rows.
- `all` unchanged.
- `period_start(period, zone, now)` gets the zone; default `UTC` keeps the existing golden
  fixture `tests/fixtures/metrics_characterization.json` valid for the UTC case (the 7d
  window shifts to midnight, so the golden is regenerated once and the diff reviewed by eye).

**This is a visible behaviour change for 7d/30d/90d (to be confirmed by the owner).**

### D4. What stays UTC on purpose

- Retention sweep (`retention_service.py`): rolling "older than N days" is not a calendar
  question; leave it.
- JSONL dataset export and per-task reconstruction: keep UTC ISO, but always with an offset
  (`as_utc(x).isoformat()`; today a naive SQLite value loses the `+00:00`,
  `routers/web_dataset.py:178`).
- Problem brief markdown for agents (`services/problem_brief.py`): keep UTC, labelled, and
  add the viewer's zone once in the header ("Times are UTC; viewer zone Europe/Warsaw") so an
  agent reading it can convert.

### D5. The model gets local time ready-made, no arithmetic

Replace the block in `getEnvironmentDetails.ts` with:

```
# Current Time
Local time: 2026-10-05 10:18:07 (Monday), time zone Europe/Warsaw (UTC+02:00)
Same moment in UTC: 2026-10-05T08:18:07Z
Today in local time runs from 2026-10-04T22:00:00Z to 2026-10-05T22:00:00Z (UTC).
Logs and databases usually store UTC: convert before reporting, and use the local day above for "today".
```

- Local first, because the user means local time when they say "today" or "at 9".
- The third line gives the exact UTC bounds of the local day, precomputed (DST-safe via
  `Intl`), which is exactly what the agent in the evidence needed for its SQL `WHERE`.
- Offset zero-padded (`+02:00`, ISO form), unlike today's `UTC+2:00`.
- Short, no conditional wording: meant to survive GLM/Qwen/local Llamas.
- Mode switching: the block is regenerated every turn, so a model switch mid-task sees the
  same text; nothing is cached across modes.

### D6. CLI zone source and display

- The core runs in-process in the CLI, so D5 uses the CLI process zone (`TZ`, else
  `/etc/localtime`). Nothing in the CLI clears it.
- Optional `timeZone` in `~/.roo/cli-settings.json`: if set and valid, the CLI sets
  `process.env.TZ` at startup before anything creates a `Date`. Covers containers and
  sandboxes without `/etc/localtime`, where Node silently resolves to UTC. If invalid: one
  warning, ignored.
- `tumble list` text output: local `YYYY-MM-DD HH:MM`; `--json` (if present) keeps UTC.
- Transcript export header: local time with offset, so it matches the filename.

## Branches (one per functionality, from `main`)

1. `fix/llm-local-current-time`: D5 + spec in `src/core/environment/__tests__`.
   Independent of the rest; smallest, highest value.
2. `fix/cli-local-dates`: D6 (display + optional `timeZone` setting). Independent.
3. `feat/cloud-client-timezone`: D1, D2, D3: cookie, helper, periods, daily buckets, task
   list `since/until`, problems grouping. Pages marked `data-tz-sensitive`.
4. `fix/cloud-local-rendered-times` (stacked on 3): every server-rendered timestamp through
   `fmt_local`; remove the dead `localizeDates()` and its `data-ts` hooks (server already
   renders local, so the JS pass is redundant); download filenames use the local date;
   D4 export offsets.

After 3 and 4: api image rebuild (memory: verify live == main by content). After 1 and 2:
VSIX and CLI rebuild.

## Tests

Cloud (pytest, run **twice**: `TZ=UTC` and `TZ=Pacific/Kiritimati` (UTC+14), to prove the
result never depends on the host zone; memory trap from #652):

- `clientzone`: valid, invalid, missing cookie; `day_start_utc` for Europe/Warsaw on
  2026-03-29 (23 h) and 2026-10-25 (25 h); a zone with half-hour offset (Asia/Kolkata); a
  negative zone (America/Los_Angeles); naive input treated as UTC.
- Metrics: one event at 2026-10-04T23:30Z and one at 2026-10-04T21:30Z.
  Zone UTC: both on 10-04. Zone Europe/Warsaw: first on 10-05 ("today" when now is 10-05),
  second on 10-04. This is the regression test for the evidence above; it fails on main.
- 7d with Warsaw zone returns exactly 7 daily rows, first starts at local midnight.
- Task list `since/until` with Warsaw: a task updated 2026-05-31T22:30Z is inside
  `since=2026-06-01`.
- Web: cookie present → headers/labels local; absent → "UTC" label and
  `data-tz-sensitive` on the page.
- Golden fixture regenerated for D3 with `TZ=UTC`, diff reviewed.

Core (vitest): `getEnvironmentDetails` with fake timers at 2026-10-04T22:30:00Z and
`TZ=Europe/Warsaw` → `Local time: 2026-10-05 00:30:00 (Monday)` and bounds
`2026-10-04T22:00:00Z .. 2026-10-05T22:00:00Z`; same with `TZ=America/Los_Angeles`; and on
2026-10-25 (25 h day) the bounds are 25 h apart. Vitest sets `TZ` per process, so these
specs set it in the test file's environment config, not mid-test.

CLI (vitest): `list` formatting and export header with a fixed `TZ`; invalid `timeZone`
setting warns and falls back.

## Risks and traps

- DST: covered by `day_start_utc` and the 23 h / 25 h tests. EU switches on 2026-10-25, three
  weeks from now, so a bug here would show up immediately in real data.
- SQLite naive datetimes in tests vs Postgres aware ones in production: always go through
  `as_utc`.
- Browser and cookie zone disagree (laptop moved, cookie not yet refreshed): app.js refreshes
  the cookie on every page load; at most one page view is in the old zone.
- Shared task pages (`/shared/...`) are viewed by other people: same cookie mechanism, their
  own zone, which is correct.
- Postgres session `TimeZone` is irrelevant because no SQL date functions are used; keep it
  that way (all day math in Python through the helper). If a future query needs SQL bucketing,
  use `created_at AT TIME ZONE :zone`, never the session zone.

## Not in scope

- A per-account zone setting (possible later on top of `client_zone`).
- Sending the client zone from the extension to the cloud (the web reads the browser's own).
- The VS Code webview: already local.
