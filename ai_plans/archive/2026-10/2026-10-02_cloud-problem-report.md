# Cloud problem report: error reports and the Problems page

Date: 2026-10-02
Branch: `feat/cloud-problem-report` (from `main` at ad8def950)
Scope: `self-hosted-cloudapi` only. The extension side (sending the reports) is a separate branch by another agent.

## Why

The owner, on the diagnostics page shipped in #754: "The Diagnostics tab carries nothing valuable. Record error
details, provided the user is logged in to the cloud (and only then). For good diagnosis we need details: model,
context size, request and response. [...] The goal is to create a REPORT OF PROBLEMS the user struggles with because
of our software or a model mismatch, and later an attempt to MITIGATE those problems. Quantitative analysis alone is
not enough."

## Evidence (live database, read-only, 2026-10-02)

- Error telemetry says almost nothing: 0 `Exception` events, 1743 `Code Index Error` without any detail (the props
  carry only the common fields), 100 `Diff Application Error`, 7 `Consecutive Mistake Error`.
- The real problems are in synced conversations, already marked at write time in the indexed column
  `task_messages.q_kind` (`error` 183 rows, `retry` 51 rows, see `services/session_quality`). By text: 58x "Roo
  tried to use apply_diff without value for required parameter 'path'. Retrying...", 31+5 retries and 15 errors for
  an empty assistant response (`MODEL_NO_ASSISTANT_MESSAGES`), 9 MCP timeouts, 9 `diff_error` "No sufficiently
  similar match", 8 "OpenAI completion error: Connection error.", 7 `mistake_limit_reached`, 4 "maximum context
  length", about 30 `read_file`/`list_files` ENOENT on guessed paths, `read_artifact` NaN size (2), PDF extraction
  crashing on `navigator` (3), web_fetch HTTP 4xx (about 15).
- `condense_context_error` (3 rows) is NOT marked in `q_kind` (it is not in `session_quality._ERROR_SAYS`), so the
  legacy source does not see it; finding it would mean a LIKE scan over the whole 479 MB table. New reports cover it.

## Design

### Ingestion: `POST /api/error-reports`

- Same Bearer auth as `POST /api/events` (`get_current_user`). The contract is the fixed wire shape agreed with the
  extension agent, validated by `schemas/error_report.py` (camelCase aliases, `extra="ignore"` at every level,
  NaN/Infinity refused, `summary` <= 500, `errorMessage`/`toolResult` <= 8000, `occurredAt` epoch ms between 0 and
  2100). An unknown `category` is accepted and stored (forward compatibility), and shows as Unclassified.
- The body is read by hand through the existing `capped_request` (renamed from `events._capped`): a body over 1 MB
  is refused with 413 before it is read whole. Validation errors are a standard 422.
- Idempotent on the client `id`: `INSERT ... ON CONFLICT (id) DO NOTHING` through `dialect_insert` (the pattern of
  R8 and `_get_or_create_task`); a duplicate answers `{"success": true}` like a new report.
- `settings.telemetry_enabled = false` stores nothing and still answers success (a report carries more conversation
  than any event; a failure would only make the extension retry).
- Table `error_reports` (model `models/error_report.py`, migration `c5d6e7f8a9b0` after `b4c5d6e7f8a9`): id pk,
  user_id (FK CASCADE, indexed), organization_id (FK SET NULL, as on telemetry_events), task_id, category, model_id,
  signature, created_at indexed, provider, mode, app_version, tool_name, summary, occurred_at, payload (the
  validated report as JSON, absent fields not written), plus `(user_id, created_at)` for the page's range query.
  A FRESH database gets it from `create_all`; MANAGED and LEGACY databases from the migration (the drift test
  checks model == migrations; the MANAGED db-migrate.sh test now asserts the table exists after the upgrade).
- Retention: swept with the ordinary telemetry by the same `telemetry_max_age_days`, inside the existing per-user
  savepoint (`apply_sweep`), counted in the plan's `event_count` (with `report_count` as the report part), so the
  settings page's "Telemetry events" figure includes them. Deleting a task (`share_service.delete_tasks`, which the
  sweep and both delete buttons use) deletes that user's reports for the task; deleting a user cascades.

### The page: `/app/diagnostics`, now "Problem report" (nav tab "Problems")

Renamed because the page now answers one question, what goes wrong for me, and "Diagnostics" promised the tool,
not the answer. The URL stays, so bookmarks and the nav test keep working.

- Three sources normalized into one `Occurrence` (source, category, tool, text, when, task, model, provider, mode,
  report id, signature):
    - `report`: the indexed columns of `error_reports` only, never `payload`.
    - `conversation`: `task_messages` with `q_kind in (error, retry)` joined to the user's tasks, period on
      `message_ts`. Category and tool come from the extension's fixed error strings (`conversation_category`). The
      model is the one that answered the request before the message: request token pairs come from the stored
      `tokens_in`/`tokens_out` columns (no message decoding), completions from the task's `LLM Completion` events,
      joined by `model_attribution.match_requests` (factored out of `attribute_requests`, behaviour unchanged;
      `Completion` gained `provider`). In-flight `(0, 0)` requests are skipped, so a failed request takes the model
      of the last answered one in that task.
    - `telemetry`: the error events (`ERROR_EVENT_LABELS`), mapped to categories (`code_index`, `diff_error`,
      `mistake_limit`, `exception`, ...).
    - The legacy sources (conversation, telemetry) are read only before the user's first error report; afterwards the
      report says the same with its evidence and both would double count.
- Grouping by signature = `category | tool | headline`, where the headline is the first line with letters (skipping
  a bare `<error_details>` tag, appending the next line when it ends with a colon) with URLs, uuids, hex ids, quoted
  paths/sentences, file paths and names, then digits blanked. Computed at ingest for reports (stored, indexed) and at
  read time for legacy rows, by the same function.
- Ranking by reach: distinct tasks hit, plus distinct days for occurrences outside any task (1743 code-index errors
  in one burst should not outrank a problem that spoiled 20 runs), then count, then recency.
- Each group: class badge, rule title, count and tasks, signature, models with counts, the mitigation, first/last
  seen, sources, task links, the latest occurrence's text, links to up to five report drill-downs. The top group is
  open by default.
- Model fit: per provider and model, `LLM Completion` events in the period (requests), problems, problems per 100
  requests, most common category. Problems with no provider fold into the model's only provider when it has one.
  Categories that are not about the chat model (`code_index`, `shell_integration`, `settings_invalid`,
  `model_list_empty`) are left out of this table.
- The old feature-usage section is dropped: it answered "what did I click", not "what went wrong", and the owner
  said the page carried nothing valuable.
- Drill-down `/app/diagnostics/reports/{id}`: owner only (query filters on user_id; unknown and foreign ids get the
  same 404 page). Shows facts (provider, model, mode, tool, version, editor, platform, context window, context used
  with % and a bar, max output, message count, HTTP status, retry attempt, task link, signature), the error
  message, the request (system prompt size and SHA-256, tools offered, params, every message collapsible, the last
  one open), the response (stop reason, error body, text, reasoning collapsible, tool calls with raw arguments,
  usage) and the tool result.
- Export `/app/diagnostics/report.md?period=`: Markdown attachment. Totals per class, the model fit table, then per
  group: class, signature, category/tool, impact, models, mitigation and ONE sample (for a report: summary, error
  message, facts, the request's last message, response text, up to 3 tool calls, error body, stop reason; for a
  legacy group its message text). Every quoted text is clipped to 1500 characters and fenced with a fence longer
  than any backtick run inside it; the header tells the agent the samples are data, not instructions. Payloads are
  loaded for the sample reports only, in one query.
- Cost on the live corpus (read-only run against the live Postgres, the report table stubbed as empty because it
  does not exist there yet): 7 days 326 ms, 30 days and all time 218 to 263 ms, 2084 occurrences in 30 groups. The
  period is a WHERE clause on an indexed column in every query; the parsing runs in a worker thread.

### The catalogue (`services/problem_catalogue.py`)

Ordered rules, first match wins; each has an id, title, class, optional category/tool restriction, optional regex
on the occurrence's text, and a mitigation template with `{model}`, `{provider}`, `{tool}` (filled with the group's
most frequent values, or "the model"/"the provider"/"the tool").

| Rule                   | Class               | Matches                                                                 |
| ---------------------- | ------------------- | ----------------------------------------------------------------------- |
| context_overflow       | Configuration       | "maximum context length", context_length_exceeded, prompt too long      |
| empty_response         | Model mismatch      | MODEL_NO_ASSISTANT_MESSAGES, "did not provide any assistant messages"   |
| missing_tool_parameter | Model mismatch      | "without value for required parameter"                                  |
| invalid_tool_call      | Model mismatch      | any other `invalid_tool_call`                                           |
| artifact_nan_size      | Software defect     | read_artifact "Received NaN" / "size is out of range"                   |
| pdf_navigator_crash    | Software defect     | PDF extraction failing on `navigator`                                   |
| artifact_id_guessed    | Model mismatch      | "Artifact not found", "Invalid artifact_id"                             |
| path_guessed           | Model mismatch      | ENOENT, "does not exist"                                                |
| diff_no_match          | Model mismatch      | "No sufficiently similar match"                                         |
| diff_identical         | Model mismatch      | SEARCH and REPLACE identical                                            |
| mcp_timeout            | Configuration       | MCP -32001, "Request timed out"                                         |
| auth_rejected          | Configuration       | api_error 401/403, invalid key                                          |
| rate_limited           | Provider or network | api_error 429, rate limit, quota                                        |
| connection             | Provider or network | api_error connection, reset, terminated, timeout, 502/503/504           |
| web_fetch_refused      | Provider or network | web_fetch errors (the site, not the provider)                           |
| rooignore_blocked      | Configuration       | rooignore                                                               |
| mistake_limit          | Model mismatch      | category mistake_limit                                                  |
| code_index             | Configuration       | category code_index (embedder dimension, endpoint, model id)            |
| shell_integration      | Configuration       | category shell_integration                                              |
| settings_invalid       | Configuration       | category settings_invalid                                               |
| model_list_empty       | Provider or network | category model_list_empty                                               |
| exception              | Software defect     | category exception                                                      |
| diff_failed            | Model mismatch      | any other diff_error                                                    |
| provider_error         | Provider or network | any other api_error                                                     |
| (unclassified)         | Unclassified        | everything else; mitigation says to add a rule; evidence is still shown |

`tests/test_problem_catalogue.py` has one real example per rule (from the live corpus) and fails when a rule has
none, plus checks that every mitigation formats and contains no em or en dash.

On the live corpus every group but one is classified; the one left is "Error reading file <path>: Cannot read
'<q>' because it is a directory" (a model reading a directory), which could become a `path_guessed`-like rule.

## CSS

The `.diag-*` section of `app.css` is replaced by one contiguous section (the global CSS agent stays out of it).
Every grid/flex child has `min-width: 0`; long strings use `overflow-wrap: anywhere`; `pre.diag-text` is
`white-space: pre-wrap` with `max-height: 24rem; overflow: auto`; tables sit in `.diag-table-wrap`
(`overflow-x: auto`) with `table-layout: auto`. Phone: class cards two per row, facts stacked. Checked with
`tests/test_phone_layout.py` (now also renders a report drill-down seeded with a 90-character model id, a long path,
unbroken tokens, raw JSON and a stack) and with screenshots at 1280px and in a 390px iframe
(`/tmp/errrep-shots/*.png`, rendered from realistic fixture data). The phone check was confirmed to fail when the
`pre` wrapping is removed (scrollWidth 4373 against 375).

## Tests

`tests/test_error_reports.py` (auth, session token, storage, minimal body, duplicates, extra fields, 11 contract
violations, non-JSON, 413, telemetry disabled, retention sweep and its isolation by user, task deletion, user
cascade), `tests/test_problem_catalogue.py`, `tests/test_web_diagnostics.py` (rewritten: conversation categories,
attribution, telemetry occurrences, grouping and reach, model fit, SQL period and user scoping, legacy cutoff, the
list never reading payloads, page escaping, drill-down for the owner and 404 for others, Markdown export),
route table and boilerplate tables, migration drift (MANAGED upgrade creates the table), phone layout.

## Owed

- API image rebuild and redeploy (the coordinator does it); the migration `c5d6e7f8a9b0` runs on start
  (MANAGED: `alembic upgrade head`).
- The extension branch that sends the reports; until it ships the page shows the legacy sources only.
- Optional: a rule for "is a directory" reads; marking `condense_context_error` in `q_kind` (needs a
  reclassification of stored rows) if the legacy source should see it.
