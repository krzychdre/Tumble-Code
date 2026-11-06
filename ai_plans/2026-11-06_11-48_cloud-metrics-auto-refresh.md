# Cloud web: the metrics page refreshes itself (2026-11-06)

**Status:** implemented on `feat/cloud-metrics-auto-refresh`.
**Related plans:** `2026-10-28_10-16_web-metrics-rollup.md` (the rollup that keeps one render of the page cheap enough
to repeat on an interval).
**Touched:** `self-hosted-cloudapi/src/web/static/app.js`, `src/web/templates/metrics.html`, tests
(`tests/browser/refresh_checks.html` new, `test_browser_js.py`, `test_web_metrics.py`, `test_web_metrics_svg.py`),
`.changeset/cloud-metrics-auto-refresh.md`.

## Request

The owner wants the statistics on `/app/metrics` to update on their own. The page was rendered once on the server;
new `LLM Completion` telemetry showed up only after a manual reload.

## Design

- `metrics.html` wraps everything below the controls (filter chip, group table, session quality, stat tiles, charts,
  breakdown tables, the empty state) in `<div id="metrics-live" data-refresh="30">`. The controls stay outside: they
  do not change between renders of the same address.
- `app.js` (shared by every panel page) handles any `[data-refresh][id]` element: every `data-refresh` seconds it
  fetches `location.href` with the session cookie, parses the answer and replaces the region with the answer's
  element of the same id. The address carries the period, space, client, group, `only` and `day_page`, so the
  refreshed region is the same view.
- What the reader changed by hand and the server cannot know survives the swap: an opened `<details>` (the daily
  table) and a checkbox (the Tokens and Cost series toggles, which got the ids `toggle-tokens` / `toggle-cost`),
  matched by id.
- A hidden tab asks for nothing. When it is shown again it refreshes at once if the last answer is older than the
  interval, otherwise when the interval runs out. One fetch at a time; the next waits for the previous to finish.
- A non-2xx answer, a network error, or an answer without the region (the sign-in page once the session expired)
  leaves the page as it is; the next round tries again.
- The empty state is inside the region too, so a page opened before any usage fills in once usage arrives.

The id `metrics-data` was avoided: it was the old Chart.js JSON island, and `test_web_metrics_svg.py` asserts it
never comes back.

Why polling the HTML and not the socket.io bridge: the bridge relays one task's messages to its owner's task page;
the metrics are sums over many tasks, users and an organization, computed in SQL from the rollup. Re-rendering the
page reuses that code and its access rules unchanged, and costs one page render per 30 s per visible tab.

## Tests

- `tests/browser/refresh_checks.html` (10 checks, run by `test_browser_js.py` in headless Chrome): the first round
  fetches the page's own address with `same-origin` credentials and shows the new figures; an opened table stays
  open; a cleared series stays cleared and one left on stays on; a 500 and an answer without the region keep what is
  shown; a hidden tab fetches nothing; shown again after the interval it refreshes at once; the replaced region
  refreshes again.
- Mutation check: dropping `region = next`, dropping `restore(state)`, and dropping the `document.hidden` test each
  turned the harness red; restored afterwards.
- `test_web_metrics.py`: the rendered page has the region, with the daily table and both toggles inside it; the empty
  state has the region too.

## Caveats

- Keyboard focus inside the region (for example on a pager link) is lost when the region is replaced.
- Not live until the api image is rebuilt from main.
