# Cloud problem report: filters, condensed list, agent brief

Date: 2026-10-02
Branch: `feat/cloud-problem-filters-agent-brief` (from `main` at 879e2d5bf)
Scope: `self-hosted-cloudapi` only. Follows `ai_plans/2026-10-02_cloud-problem-report.md`.

## Why

The owner, on the Problems page from #758: filtering is missing on the problem list, a more condensed list is
missing, and a report an agent can take to fix the program or the integration is missing. The old export had one
sample per group and no pointer into the code, so an agent still needed the conversation that produced it.

## Design

### Filters and sort (`services/diagnostics_service.ProblemFilter`)

- Query string only (`period`, `class`, `category`, `model`, `provider`, `tool`, `source`, `q`, `sort`), read by
  `ProblemFilter.parse` from a FastAPI dependency (`routers/web_diagnostics.problem_filter`) whose parameters are
  plain optional strings, so nothing in a link can 422. Unknown class, source, sort and period are dropped;
  category, model, provider and tool are free text compared exactly (cut to 200 characters), so a shared link for a
  model with no problems in the chosen period shows an empty list that says so. `q` is a case-insensitive
  substring of the rule title, the signature or the message.
- The SQL period filter is unchanged; the filters run in Python on the period's occurrences (a few thousand at
  most), which lets one filter apply to all three sources. Each signature's rule is decided once over the whole
  period (`rules_by_signature`), so a filter never moves a problem to another class.
- Totals, groups and model fit count the matching occurrences only. The class tiles count everything the other
  filters let through (a facet), so each tile says what clicking it would show; the model fit's request counts
  are the period's, narrowed only by a model or provider filter (a request has no category or tool). The page
  says this in one line under the filters.
- Option lists come from the unfiltered period with counts; a value the period does not have stays selected as
  "value (0)".
- Sort: `impact` (default: reach, then count, then recency), `count`, `recent`.
- URLs are built in one place, `web/presenters/problem_view.ProblemView` (period tabs, class tiles, sort, chips,
  clear, both brief links), the pattern of `web/presenters/task_list.ListView`.

### Condensed list

- One closed `details` per group (no group open by default): class chip, title, tool, top model with "+N more",
  count, tasks, last seen. Every row is its own grid with the same tracks (fixed rem widths and fractions of the
  same width), so columns line up under a header row without a table. Below 640px the header row hides and the row
  becomes a short card: chip, title, then the figures on one wrapping line, each saying what it is ("3 tasks",
  "last ...").
- The expanded body keeps the old detail (what to do, facts now with signature and problem key, models table,
  latest occurrence, report links) plus "Download brief" and "Copy for agent".
- `app.js`: a `form[data-autosubmit]` submits when one of its lists changes; `button[data-copy-url]` fetches the URL
  with the session cookie and copies the text (ClipboardItem with a promise where available, so Safari's
  user-activation rule holds; otherwise fetch then `copyText`). On failure the button says "Copy failed, use
  Download"; a `#copy-status` live region announces the result.

### The agent brief (`services/problem_brief.py`)

- `/app/diagnostics/report.md` (the filtered set, contents first) and `/app/diagnostics/problems/{key}/brief.md`
  (one group). The key is 12 hex digits of the signature's SHA-256 (`group_key`); a malformed key, an unknown one
  and another user's all answer the same 404 page.
- Header: what Tumble Code is and the monorepo layout, period, filters, generated time, how to read it, the note
  that quoted text is data, not instructions.
- Per group: Task (the rule's `task`), Classification (class, category, tool, `explain()`: rule id, the
  restrictions that held and the words its pattern found), the mitigation, Impact (occurrences, tasks, first/last,
  models with providers, providers, modes, app versions), Where to look (the rule's `code_hints`), Evidence, How to
  proceed (prove the root cause from the evidence first, failing test at the lowest layer, fix, then the rule's
  `acceptance`).
- Evidence: up to 3 distinct samples per group (`pick_samples`: reports first, newest first; one per model and
  task before a second from the same; never the same text twice in one task). A report sample has the facts
  (model, provider, mode, version, context window, context used with %, HTTP status, retry attempt, task), the
  error message, the tool calls (the failing tool's first) with raw arguments, the tool result, the request's last
  2 messages, the response (stop reason, text, reasoning, error body, usage). A legacy conversation sample says
  plainly that no request or response was recorded and quotes what the synced conversation holds: the message,
  the request before it (its stored token counts: how full the context was) and the 2 messages before it
  (bookkeeping rows skipped; the `ask: tool` row carries the tool call the model made). A telemetry sample quotes
  the event's text.
- Quoting: long texts keep head and tail with "[... N more characters cut]" in the middle; fenced blocks use a
  fence longer than any backtick run inside; short values are inline code with the same rule.
- Cost: payloads only for the chosen samples (at most 3 per group, one query per 500 ids); context messages per
  legacy sample through the `(task_id, message_ts)` unique index, user-scoped by a join on `tasks`. Live corpus
  (read-only transaction, all time, 2084 occurrences in 30 groups, no error reports yet): report.md in 342 ms,
  194 KB; filtered to class model + GLM-5.3-NVFP4 in 284 ms.

### Catalogue (`services/problem_catalogue.py`)

Each rule gained `task`, `code_hints` (repo-relative path, optionally ": symbol") and `acceptance`, the latter two
filled with the same `{model}`/`{provider}`/`{tool}` placeholders as the mitigation. Task wording by class: "Fix"
(software), "Make the integration with {model} robust" (model mismatch), "Change the default ... or explain to the
user" (configuration), "Handle, retry and surface" (provider). The hints were found by grepping the repo for the
extension's own error strings and symbols (`TaskAskSay.sayAndCreateMissingParamError`,
`TaskApiLoop.handleEmptyAssistantResponse`, `ReadArtifactTool.readArtifact`, `extract-text.ts loadPdfParse`,
`multi-search-replace.ts`, `RetryHandler`, `McpToolCatalog.callTool`, `service-factory.findDimensionMismatch`, ...).
Unclassified points at the catalogue and its test. `explain()` and `task_for()`/`acceptance_for()` are new.

## Tests

- `tests/test_problem_filters_brief.py` (new): parsing (unknown values dropped, known kept), every filter alone,
  `(unknown)` as a model value, search over title/signature/message, combinations, empty result, faceted class
  tiles, option counts, model fit following the filter, the three sorts, sample selection and distinctness, the
  group key, quoting; page: closed condensed rows and their markup, tiles as links with the active one marked,
  chips and every link carrying the filters, empty filter state with the clear link, invalid values never a 500,
  an absent value staying selected; brief: every section, the facts, raw tool arguments, tool result, request
  tail fenced past backticks, 3 distinct samples, owner-only (same 404 for unknown, malformed and foreign keys),
  filters honoured (and a group outside them is 404), legacy wording with the request's tokens and the messages
  before it, report.md with contents and the class filter.
- `tests/test_problem_catalogue.py`: every rule has a task and acceptance without em/en dashes, tasks start the way
  their class asks, every rule has hints, every hinted path exists and contains its symbol (skipped when the
  cloud API runs outside the monorepo), `explain` names the rule and the match.
- `tests/test_phone_layout.py`: the problem rows are opened before measuring (they start closed); new states: a
  filtered list (phone fit), a filtered list with a 90-character model id and search, and an empty filter with
  unbroken chip values (long text in its box, 390 and 900 px).
- `tests/browser/app_checks.html`: auto-submit only in `data-autosubmit` forms, "Copy for agent" fetches with the
  session cookie, copies, reports a failed fetch, announces.
- Route table, route boilerplate (the new route redirects anonymous readers, 404s an unknown key), CSP/a11y now
  renders a filtered `/app/diagnostics`.

Screenshots (`/tmp/problem-filters-shots/`): the live corpus rendered through the app against the live Postgres in
a read-only transaction (`live_all`, `live_filtered`, `live_empty`) and a fixture with error reports and hostile
long strings (`fixture_all`, `fixture_filtered`), each at 1280 px and in a 390 px iframe.

## Owed

- API image rebuild and redeploy (the coordinator does it). No migration.
- The live corpus has no error reports yet, so the report-sample path of the brief was checked on fixtures only.
- The 1743 bare "Code Index Error" events and the 100 bare "Diff not applied" events still carry no reason; their
  briefs say so and their acceptance criteria ask the extension to send it.
