# Cloud task page: the task's first message is labelled "You"

Status: done (branch `fix/cloud-task-first-message-label`)

## Touched files

- `self-hosted-cloudapi/src/web/static/render.js`
- `self-hosted-cloudapi/src/web/static/timeline.js`
- `self-hosted-cloudapi/tests/browser/render_checks.html`
- `self-hosted-cloudapi/tests/test_browser_js.py`

## Problem

The extension stores the task's instruction as a plain `say: "text"` message, the same kind as an assistant answer.
`classify()` in `render.js` maps every `text` say to `{ role: "assistant", label: "Assistant" }`, so the first row
of every task page read "Assistant" in the assistant colour. The timeline rail already knew better: `kindOf()` in
`timeline.js` had a special case (`index === 0 && data-kind === "text"` counts as "user"), so the rail showed a
"Your message" tick for a row the conversation called "Assistant". The role was decided in two places that
disagreed. The label is drawn only in the browser; the Python presenters do not render roles.

## Fix

- `mountConversation().upsert()` remembers the key of the first row it appends. When that row is a `text` say, it is
  rendered with role `user` and label "You" (same class `role-user`, same colour, same open-by-default rule as
  other user messages). A live update of the same row keeps the user role because the key is remembered.
- `timeline.js` drops its index-0 special case: the renderer's `role-user` class is now the one source of truth,
  and the unused `index` parameter of `kindOf()` is gone.

## Tests

- `tests/browser/render_checks.html`: a trailing assistant `text` row was added (so "assistant opens by default"
  still has an assistant row), plus three checks: the first row is `role-user` labelled "You", a later text say stays
  "Assistant", and a live upsert of the first row keeps it as "You". Without the fix two of them fail (verified by
  running the harness against the old `render.js`).
- `tests/browser/timeline_checks.html` is unchanged and still counts two messages of yours, which now proves the
  rail reads the renderer's class instead of its own rule.
- `pytest tests/test_browser_js.py tests/test_web_task_timeline.py`: 15 passed.

## Notes

- Only the first row of the rendered conversation is relabelled, the same scope the timeline rule had. A task
  whose first stored message is something else (none known) keeps its labels.
