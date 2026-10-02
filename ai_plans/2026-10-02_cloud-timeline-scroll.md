# Cloud task page timeline cut off on long sessions

Branch: `fix/cloud-timeline-scroll`. Everything is in `self-hosted-cloudapi/`.

## Problem

On a long session the timeline rail (wide screens) ended well before the end of the
run, and could not be scrolled.

## Root cause

`static/app.css`, the rail's `.tl-track` had `overflow: hidden`. Ticks shrink to fit
(`flex: 0 1 8px`) but no lower than `min-height: 2px`, plus a 1px gap: once a run has
more ticks than `track height / 3px` (about 200 on a laptop screen), the rest overflow
and are clipped. The narrow-screen strip had the same limit sideways (`min-width: 2px`)
with no overflow rule at all, so its ticks spilled past the well.

## Fix

- `.tl-track` gets `overflow: auto` (thin scrollbar) for both layouts; the rail drops its
  `overflow: hidden`. Short runs still fill the track as before (ticks only stop
  shrinking at 2px).
- `timeline.js`:
    - `build()` empties and refills the track on every live row; that reset the track's
      scroll. It now keeps the scroll position, and sticks to the end when the reader was
      at the end (the live tail).
    - `goTo()` brings the row's tick into view in the track by adjusting the track's own
      scroll offsets (not `scrollIntoView`, which would also move the page on phones, where
      the strip sits above the conversation).

Not done: bucketing ticks so the whole run always fits without scrolling. That keeps
the overview at a glance but merges neighbouring requests into one tick; scrolling
keeps one tick per request, which is what the tooltips and clicks rely on.

## Tests

- `tests/browser/timeline_checks.html` (19 -> 23): a too-short track scrolls, a jump
  scrolls the track to its tick, a reader at the end stays at the end across a live
  row, a reader in the middle keeps their place. Against the old `timeline.js` the jump
  and stay-at-end checks fail.
- `tests/test_web_task_timeline.py`: `.tl-track` has `overflow: auto` and the rail no
  longer overrides it with `overflow: hidden`.
- Checked by screenshot: 400 ticks with the real `app.css` at 1500px, the rail scrolls.
