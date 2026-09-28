# UI-4d: task page timeline, jumps, row containment and skeleton

Plan: `ai_plans/2026-09-27_ui-modernization.md`, section 3.3 (step 4 of section 5).
Branch: `feat/ui-4d-cloud-timeline`, stacked on `feat/ui-4c-cloud-light-theme`. Everything is
in `self-hosted-cloudapi/`.

## What

- **Timeline** (`static/timeline.js`, loaded right after `render.js` on the owner and the
  shared task page): one tick per API request, per error (an `error` row, a provider retry
  `api_req_retry_delayed`, or a request that failed: `cancelReason` or
  `streamingFailedMessage`), and per message of yours (`role-user` rows, plus the task
  itself: the first row when it is a plain `text` say). A request's size is its cost
  against the dearest request (at least 15%, so a free request stays visible); errors and
  your messages are full size, in `--d-error` and `--d-you`; requests take `--d-cost`.
  Clicking a tick scrolls its row to the top (smooth unless reduced motion), outlines it
  and moves focus to its summary. Beside the reading column from 1240px (a fixed rail,
  length = cost), a strip above the conversation below that (height = cost).
- **Jumps**: "Next error" and "Next message of yours" walk those rows from the row the
  last jump landed on, or from the top of the viewport once the reader has scrolled by
  hand (wheel, touch, paging keys), and wrap round.
- **Data**: nothing new from the server. `render.js` now puts `data-kind` (the say/ask
  kind) on every row and `data-cost` / `data-failed` on API rows; the timeline reads the
  DOM and a `MutationObserver` on the conversation redraws it (debounced 60 ms) when the
  live bridge adds or replaces a row, rescaling the sizes.
- **Containment**: `.msg { content-visibility: auto; contain-intrinsic-size: auto 120px }`,
  with `overflow-clip-margin` so the spine tick left of each row is not clipped by the
  implied paint containment, and `scroll-margin-top` so a jump lands below the sticky top
  bar.
- **Skeleton**: four placeholder rows with a shimmer (stopped by the existing
  reduced-motion rule) replace the "Rendering conversation..." text, which stays as
  `sr-only` inside a `role="status"` container. `render.js` already removes `.loading` on
  the first row.

## Deviations

- `contain-intrinsic-size: auto 120px` rather than the plan's `0 120px`: `auto` lets the
  browser remember a row's real height once it has been rendered, so scrolling back up
  does not jump; the width part is irrelevant for a block row.
- Ticks are `tabindex="-1"`: a run has hundreds of requests, and the two jump buttons are
  the keyboard path; the ticks keep `aria-label`s for pointer and screen reader users.
- The task itself is counted as a message of yours (first `text` row) although the
  renderer labels it "Assistant"; relabelling that row is a renderer change left out of
  scope.

## Tests

- `tests/test_web_task_timeline.py` (3): the hidden frame with its jump buttons and track
  on both task pages, `timeline.js` right after `render.js`, the skeleton markup, and the
  containment rule plus the skeleton keyframes.
- `tests/browser/timeline_checks.html` (19): tick count, kinds and order, cost sizing and
  the minimum, failed request and retry as errors, labels, tick click, error jumps and
  wrap, user jump and focus, a live row adding a tick and rescaling.
- Screenshots (local server, a 60-message run): the rail at 1500px and the strip on a
  390px phone frame.
