# Cloud web: a streaming row flickers and cannot be opened

## Symptom

While a task streams from VS Code to the cloud web view, a "Reasoning" row
flickers, its spinner restarts many times a second, and clicking its header
does not open it, so the streamed reasoning cannot be read until the message
is final.

## Root cause

Every relayed chunk (`task:relayed_event` in `live.js`) calls
`conversation.upsert()`, and `upsert()` built a new row with `rowEl()` and
swapped it in with `replaceChild`. The server only coalesces partials on the
way to the database (`realtime/partial_buffer.py`); viewers get every chunk.

- A new element starts its CSS animations from zero, so `.spinner` (`spin`)
  and `.msg.running::before` (`tick`) restarted on every chunk: the flicker.
- A click needs mousedown and mouseup on the same element. The `<summary>`
  under the mouse at mousedown was replaced before mouseup, so no click, no
  toggle. The fold carry-over in `upsert()` was fine; the toggle never happened.

## Fix

`render.js`: `patchRow(existing, fresh)` updates the existing row in place:
class list (keeping `ask-pending`), data attributes, the header part before
`.msg-meta` only when its markup changed (so the spinner element survives),
and the body's `innerHTML` only when it changed. `.msg-meta` (step duration,
ask resolution) is left alone. When the shape differs (a body appears or
disappears) it returns false and the row is swapped as before. A patched row
keeps its `toggle` listener, so none is added twice.

## Tests

`tests/browser/render_checks.html`: six checks on a partial, partial, final
sequence: the same row element and the same spinner element across chunks, the
new text shown, a row opened mid-stream stays open, the final revision stops
the spinner. A/B: the old `render.js` fails the two identity checks.
`_MIN_CHECKS` for the harness raised from 31 to 37.

## Deploy

Static asset of the api image: rebuild the image (see the cloud web memory
notes about building from a `git archive` export of main).
