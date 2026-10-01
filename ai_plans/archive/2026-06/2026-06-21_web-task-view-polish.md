# Web task-view polish — live conversation UX

**Date:** 2026-06-21
**Branch:** `feature/self-hosted-remote-task-control`
**Goal (user's words):** five fixes to the `/app/tasks/{id}` web view now that the backend streams
tasks live:

1. after confirm/deny the question still displays — can't tell if it was approved or denied;
2. tool results are always expanded — fold them by default;
3. the result is shown twice (real result + a redundant "Task completed");
4. very redundant rows (e.g. "API request" in the header _and_ tokens in/out in the body) — make
   it a one-liner;
5. show what is executing **now** (api request / tool call / thinking), like the VS Code webview.

---

## Root causes (verified)

- **#1** `live.js applyAsk()` only hides the ask-bar when a _later_ `instanceState` arrives with
  `currentAsk` cleared (pushed on `TaskAskResponded`, see `src/extension/bridge.ts:73`). The
  in-conversation ask row is never annotated, and there's no optimistic feedback on click.
- **#2** `render.js toolMsg()` / `command_output` / mcp bodies inject content inline. Only
  `reasoning` and the api `request` detail use `<details>`.
- **#3** `say:completion_result` carries the result text; the trailing empty
  `ask:completion_result` hits the same `case` and falls back to `"<em>Task completed.</em>"`
  (`render.js:68`), producing a second row.
- **#4** `apiReq()` repeats "API request" in both the `.msg-head` label and the `.msg-body`.
- **#5** Nothing reads `m.partial` (streaming) or `instanceState.isRunning` to surface current
  activity.

## Changes

### `render.js` (applies to both `/shared` read-only and live owner pages)

- **#3** `completion_result`: `if (!m.text) return null` — drop the empty trailing ask; the result
  `say` already rendered. (User confirmed the "Task completed" row is unwanted.)
- **#2** fold `tool`, `command_output`, and mcp response bodies in a collapsed `<details>` with a
  meaningful `<summary>` (tool name / path / "Output"). Keep the short `command` itself visible.
- **#4** `apiReq()`: move tokens/cost into the row label; body holds only the optional folded
  request. `rowEl()` skips the `.msg-body` div entirely when body is empty → true one-liner.
- **#5** classify returns an `active` hint; `mountConversation.upsert` ORs it with `m.partial`.
  Active rows get a `.running` class + pulsing spinner in the head. Streaming → final replaces the
  same `ts` row, so the spinner clears itself. Track active rows by `ts`; expose `getActivity()`
  (label of the newest active row) for the live header.
- **#1** add `markResolved(ts, decision)` to the conversation controller — badges the ask row
  `✓ Approved` / `✗ Denied`; persisted in a `resolvedByTs` map so a row replacement keeps the badge.

### `live.js` (owner live page only)

- **#1** remember `lastAsk` from `applyInstanceState`. On Approve/Deny click: optimistically hide
  the ask-bar and `convo.markResolved(lastAsk.ts, …)`. Still reconcile from `instanceState`.
- **#5** after each relayed event and on `instanceState`, refresh a header activity indicator from
  `convo.getActivity()` (falling back to `isRunning` → "Working…", else idle).

### `task_detail.html` / `app.css`

- Add a header activity element (`#live-activity`) next to `#live-status`.
- CSS: `.running` spinner keyframes, resolved-ask badge, compact `.role-api` row, `<details>`
  summary styling for folded tool/output bodies.

## Out of scope

Per-tool granular status strings beyond thinking/api/tool/responding; reworking the static
read-only header; image paste.

## Verification

- Backend `uv run pytest` still green (existing tests assert `#live-controls`/`live.js` presence on
  owner page and absence on `/shared` — unchanged).
- Manual: drive a task from the web — watch the spinner on the streaming row, approve an ask and see
  the badge, confirm the API row is one line, tool output folded, single completion row.

## Round 2 (2026-06-21) — coherence pass

User feedback after round 1:

1. `command` must fold to one line like the others (command text in the summary label).
2. The approval question must live **inline in chronological order** (not a floating bar), be
   coherent with other rows, and on Approve/Deny **disappear with the decision shown**. The floating
   `#ask-bar` is removed; Approve/Deny buttons attach to the ask's conversation row, driven by
   `instanceState.currentAsk`. A local `answered` set stops a stale `instanceState` (which still
   carries the old `currentAsk` until `TaskAskResponded` lands) from resurrecting the bar.
3. Assistant `text` folds by default, same as reasoning.
4. Every row shows date+time on the right and the **step duration** (gap to the next step's ts).

Changes: `render.js` — `text`/`command` `fold:true`; `rowEl` adds a right-aligned `.msg-meta`
(time + duration); `mountConversation` gains `setActiveAsk`/`clearActiveAsk` (inline Approve/Deny on
the ask row) and tracks a `tail` row to backfill the previous step's duration on each append.
`live.js` — drives the inline ask from `currentAsk`, ignores already-`answered` asks. `task_detail.html`
— drop the `#ask-bar` block. `app.css` — `.msg-meta`/`.msg-time`/`.msg-dur`, `.ask-pending`,
`.ask-actions-inline`.

## Status — 2026-06-21: COMPLETE (pending manual e2e)

All five landed in `render.js` / `live.js` / `task_detail.html` / `app.css`. `node --check` clean
on both JS files; `uv run pytest tests/test_web_and_share.py` → 16 passed. Manual web e2e pending.
</content>
</invoke>
