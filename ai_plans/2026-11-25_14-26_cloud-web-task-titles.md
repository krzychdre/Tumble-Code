# Cloud web task titles: plain text, from the opening prompt only

**Status:** done on `fix/web-task-titles`
**Related plans:** `2026-11-25_12-56_cloud-web-task-list-cards.md`
**Touched:**

- `self-hosted-cloudapi/src/services/task_summary.py`
- `self-hosted-cloudapi/src/services/telemetry_service.py`
- `self-hosted-cloudapi/alembic/versions/d7e8f9a0b1c3_plain_task_titles.py`
- `self-hosted-cloudapi/tests/test_task_summary.py`, `tests/test_web_tasks.py`

## Symptom

- Titles showed the raw Markdown of the prompt: `**one**`, backticks, `# heading`.
- A `tumble -p` task whose model server answered HTTP 423 got the title "423".
- `tumble -p` tasks with a plain prompt ("Ask me which color I prefer.") showed "Untitled task" in the live
  "Needs your attention" strip.

## What was happening

Measured on the live database (2497 tasks with messages): 2486 open with `say: "text"`, the prompt. The other 11
open with `api_req_started` (9) or a `resume_completed_task` ask (2): their opening prompt never reached the cloud.
Exactly those took their title from a later message: `api_req_retry_delayed` (5, e.g. "OpenAI completion error:
Connection error."), `reasoning` (5) and `user_feedback` (1).

- `first_user_query` took the first message with any non-JSON text, of any kind. `RetryHandler.buildErrorHeaderText`
  (`src/core/task/RetryHandler.ts:255`) writes `"<status>\n<message>"`, so the first line of an
  `api_req_retry_delayed` is "423".
- The opening prompt is lost on the client side: `BridgeOrchestrator.emitTaskEvent` drops an event while no socket
  exists (`this.socket?.emit`), and the bridge is set up only after the cloud start settles (`src/extension.ts:496`).
  A `tumble -p` task says its prompt before that. The strip showed "Untitled task" while the followup was pending,
  which is only possible when the prompt (a non-JSON `text`) had not arrived; the followup ask is JSON and skipped.
- `derive_title` stored the first line verbatim, Markdown included.

## Fix

- `opening_query`: the opening request is the conversation's first message when it is `say: "text"`, else there is
  none. Without it the task has no title (shown as "Untitled task") rather than an error line, a reasoning trace or
  the model's answer.
- Live writes (`_refresh_after_live_write`): a final `say: "text"` supplies the title only when no earlier message of
  the task is stored, so the answer after a lost opening is not taken for it, while an opening prompt that commits
  after a later message still is.
- `plain_title`: the title line as plain text (heading, quote and list prefixes, images and links to their text,
  backticks, `**`/`__`/`~~`/`*`/`_` emphasis, whitespace runs). Reads at most 4x `TITLE_MAX` of the line, so the lazy
  patterns stay linear on a pasted 40 KB line. The hover excerpt keeps the prompt's Markdown and shape.
- Migration `d7e8f9a0b1c3` (data only) re-derives the stored title and excerpt of every task from its earliest row,
  so existing titles change with the rule. The downgrade keeps them.

## Tests

- `test_task_summary.py`: Markdown cases, five conversations without an opening prompt, a CLI-shaped conversation,
  linear time on unclosed markup, and the migration on seeded rows.
- `test_web_tasks.py`: live arrivals with a lost opening (no title) and a late opening (its plain title).
- Mutations, each red then restored: no Markdown stripping (7 failed), any first message as the opening (5), the
  earlier-row check off (1), the migration writing nothing (1).

## Notes

- Client side, not changed here: the bridge loses a task's first messages when it connects after the task started
  (`tumble -p` always does). Those tasks keep "Untitled task" and miss their opening rows until shared (sharing
  backfills the whole conversation). A fix would buffer or backfill on connect in `BridgeOrchestrator`.
