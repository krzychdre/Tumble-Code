# Cloud web: answer a task's question from the web (ask dock)

**Status:** implemented on `feat/web-ask-dock`
**Related plans:** preview in `private_docs/cloud-web-ergonomics/preview/` (task.html, preview-task.js); follow-ups `feat/web-follow-tail`, `feat/web-task-list-cards`, `feat/web-phone-cockpit` (stacked on this branch)
**Touched:**

- `self-hosted-cloudapi/src/web/static/live.js` (the dock: `ASK_DOCK` table, rendering, commands)
- `self-hosted-cloudapi/src/web/static/render.js` (ask row highlight only, answered badge with the answer, `revealRow`, exported Markdown helpers)
- `self-hosted-cloudapi/src/web/templates/task_detail.html` (dock markup inside `#live-controls`)
- `self-hosted-cloudapi/src/web/static/app.css` (dock styles, phone touch sizes, answered badge)
- `self-hosted-cloudapi/tests/browser/live_checks.html`, `tests/browser/render_checks.html`, `tests/test_browser_js.py`

## Symptom

On the owner's task page a pending `ask_followup_question` showed its suggestions as a plain list, and the only
actions were Approve and Deny on the ask's row. A suggestion could not be picked, and Approve on a followup answers
it with no text. Every other ask (command, tool, failed request) also got the same Approve/Deny, whatever the
VS Code panel shows for it, and in a long run the row with the buttons scrolled far out of reach on a phone.

## What was happening

- `live.js` `updateAskFromState` called `setActiveAsk` for any `currentAsk`, and `render.js` `decorateAsk` appended
  Approve/Deny to that row, sending `approve_ask` / `deny_ask` with an empty payload.
- The extension already answers a pending followup from a plain `message` command:
  `Task.submitUserMessage` calls `handleWebviewAskResponse("messageResponse", text)` (`src/core/task/Task.ts`), which
  is what the panel's suggestion buttons do. `AskFollowupQuestionTool` then uses that text as the answer, and a
  `payload.mode` on the message switches the mode first. So the gap was the web page only.

## Fix

- A dock above the composer (`#ask-dock`) owns every action for the pending ask. `live.js` keeps one table,
  `ASK_DOCK`, keyed by `ClineAsk`, with the kind label, a one-line prompt, the approve and deny labels and the detail
  line. The labels follow `webview-ui/src/components/chat/hooks/useAskButtons.ts`: command = Run / Deny, edit
  tools = Save / Deny (batch: Save All / Deny All), `finishTask` = Complete subtask and keep going, other tools and
  MCP = Approve / Deny, `api_req_failed` = Retry, `mistake_limit_reached` = Proceed Anyways, `command_output` =
  Continue While Running, `auto_approval_max_req_reached` = Reset and Continue. A deny label exists only where the
  panel's secondary button is a `noButtonClicked` answer; Start New Task and Kill Command are not ask answers and
  stay out.
- Asks missing from the table (`completion_result`, `resume_task`, `resume_completed_task`) get no dock; the composer
  answers them as before and Resume keeps its own button.
- Followup: the question as Markdown (render.js `md`), one button per usable suggestion (inline Markdown,
  `→ <mode> mode` when it switches mode). A click sends `message` with the answer and the mode. Send while a
  followup is pending answers it the same way. The composer placeholder says which.
- Approvals: the composer text travels as `payload.text` and is cleared; the placeholder says so when there is a
  deny choice.
- The ask row keeps its `ask-pending` highlight but has no buttons; "show in conversation" calls `revealRow`. An
  answered followup's badge reads `✓ Answered: <first 40 chars>`, the whole answer in its title.
- The existing `answered` map still stops a stale snapshot from bringing an answered ask back. A repeated snapshot of
  the same ask does not redraw the dock (a redraw under a finger would swallow the tap). Partial asks and an offline
  bridge disable the dock buttons.

## Tests

- `live_checks.html`, new scenario (29 checks): question Markdown, suggestions (blank answer dropped), mode label,
  suggestion click sends `message` with text and mode, answered badge call, stale snapshot, Send answering a
  followup, command labels/detail/placeholder, approve with comment, edit tool labels, deny without text, Retry
  only, no dock for `completion_result`, the jump, offline buttons. The harness now loads the real `render.js` for
  the Markdown helpers.
- `render_checks.html` (7 checks): row marked without buttons, mark kept across a live update, answered badge text
  and title, `revealRow`.
- Mutations: dropping `payload.mode` in `answerFollowup` turned live_checks red; dropping `decorateAsk` from
  `setActiveAsk` turned render_checks red. Both restored.

## Notes

- The phone layout of the header and composer is `feat/web-phone-cockpit`, stacked on this branch; here only the dock
  gets 44 px buttons.
- `feat/web-follow-tail` edits `live.js` / `task_detail.html` in parallel; the dock is its own section of `live.js`
  and its markup sits at the top of `#live-controls`.
