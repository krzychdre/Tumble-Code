# Cloud web: a live task page follows its newest message

**Status:** implemented on `feat/web-follow-tail`
**Related plans:** cloud web ergonomics round (ask dock, task list cards, phone cockpit), preview in the owner's
`private_docs/cloud-web-ergonomics/preview/`
**Touched:**

- `self-hosted-cloudapi/src/web/static/follow.js` (new)
- `self-hosted-cloudapi/src/web/static/live.js`
- `self-hosted-cloudapi/src/web/templates/task_detail.html`
- `self-hosted-cloudapi/src/web/static/app.css`
- `self-hosted-cloudapi/tests/browser/follow_checks.html` (new), `tests/browser/live_checks.html`,
  `tests/test_browser_js.py`

## Symptom

On the owner's task page in the cloud web panel a running task appends its messages below the screen. Nothing
moves the page, so following a task meant scrolling down by hand after every message, on a phone too.

## What was happening

`render.js` appends a new row to `#conversation` (or swaps a streaming row in place) when `live.js` relays a
message. No code touched the scroll position.

## Behaviour now

| Situation                                                 | Page                                             |
| --------------------------------------------------------- | ------------------------------------------------ |
| Live task (running or waiting on an ask) is opened        | opens at its newest message                      |
| Finished task is opened                                   | opens at the top, as before                      |
| Reader within 80 px of the bottom, a row arrives or grows | stays at the bottom                              |
| Reader scrolls up                                         | stays where it is, "↓ Latest" pill above the bar |
| Rows arrive while reading above                           | pill reads "↓ Latest (n new)"                    |
| Reader clicks the pill or scrolls back to the bottom      | follows again                                    |

## Fix

`follow.js` is independent of `render.js`:

- A `MutationObserver` on `#conversation` (subtree, text, attributes) keeps the page at the bottom while following,
  in the same task as the change, and otherwise counts rows added as direct children. A streaming row swapped for
  its next version adds one row and removes one, so it does not count.
- A `ResizeObserver` covers growth without a DOM change (images and diagrams loading).
- The scroll listener turns following on near the bottom and off only when `scrollTop` decreases: content growing
  below never lowers it, so growth cannot be mistaken for the reader leaving.
- Scrolling is instant; the steps of a smooth scroll would read as the reader scrolling away.
- Observation starts at `DOMContentLoaded`, after `render.js` drew the stored history (its listener was added
  first), so the history does not count as new rows.

`live.js` calls `window.TumbleFollow.toTail()` the first time an `instanceState` of this task says `isRunning`. The
extension sets `isRunning` for `TaskStatus.Running` and `TaskStatus.Interactive`, so a task waiting on an ask counts
as live too (`src/extension/bridge.ts`).

The pill is shown only when there is something to catch up on: on a live task, or when rows arrived while reading
above. It moves the page, not the task, so an offline control bar does not dim it.

## Tests

- `tests/browser/follow_checks.html` (19 checks): opens at the top unless live, counts a row missed while not
  following, opens at the tail when told, follows a new and a growing row, stops on scrolling up, counts new rows but
  not a swapped one, resumes on the pill and on reaching the bottom by hand.
- `tests/browser/live_checks.html`: `toTail` is called once for this task running, never for a registration-only
  record or another task's running snapshot.
- The harness runs Chrome with a virtual clock that drives no rendering steps, so `ResizeObserver` and native scroll
  events never fire there; the harness dispatches the scroll event itself and the `MutationObserver` path carries the
  following checks. The same harness passes 19/19 in a normal headless Chrome with real scroll events.
- Mutations, each turned the harness red and was restored: scrolling up never stopping following (4 failures),
  counting a swapped row as new (1), `live.js` not calling `toTail` (2).
- Geometry on a real owner page rendered by the app (40 exchanges, stubbed socket) at 1440, 1000 and 390 px wide:
  gap to the bottom 0 after opening live and after a live row, pill centred 11 px above the controls, finished task
  stays at scrollTop 0.

## Notes

- A task that becomes live while the page is open (Resume from the web) is also sent to its tail once, since that
  is the first time `live.js` sees it running.
