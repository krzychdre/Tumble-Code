# UI-4a: cloud task list (headers, sort, filters, chips)

Plan: `ai_plans/2026-09-27_ui-modernization.md`, section 3.2 (step 4 of section 5).
Branch: `feat/ui-4a-cloud-list`, first of the cloud stack (4a list, 4b a11y and CSP,
4c light theme, 4d timeline, 5d SVG charts). Everything is in `self-hosted-cloudapi/`.

## What

- **Header row** for all nine columns (Task, Project, Model, Messages, Duration, Tokens,
  Cost, Grade, Updated), built from the same pieces as a row (checkbox spacer, tree
  gutter, the row grid, an invisible Delete button), so every label sits over its
  column. Sticky under the top bar (at the very top on phones, where the bar scrolls
  away). Below 860px only the four sort links stay, as one line.
- **Server-side sort**: `?sort=updated|cost|tokens|messages&dir=asc|desc`, allow-listed in
  `src/web/presenters/task_list.py` (`ListView`). Anything else falls back to newest
  first and is never echoed into a link. A header link flips the direction on the
  active column and starts a new column at its biggest end; the state is said in words
  (`sr-only` ", sorted descending") beside the arrow.
- **Filters** as one plain GET form: search, project, model (both with a `<datalist>` of
  the user's own projects and models), grade, date range (`since`, `until`, inclusive,
  UTC days) and "has subtasks". Unusable values (a bad date, an unknown grade) are
  dropped, never a 422. The fields live in a `<details>` that opens when a filter
  beyond the search is active.
- **Chips**: one square, removable chip per active filter (the link is the view minus
  that filter), plus "Clear all" that keeps scope and sort. A filtered empty list says
  so and shows the same chips.
- **Every link keeps the view**: pager links, the jump form, the scope toggle, the
  header links and the redirect after a bulk delete all come from `ListView.url()`.
- **Progressive fetch** (`tasklist.js`): the filter form is submitted 300 ms after the
  last change (or at once on Enter/Apply), the same URL is fetched, and every
  `[data-swap][id]` region (`#list-count`, `#scope-control`, `#task-results`) is
  replaced from the parsed response. The form itself is never replaced, so the caret
  stays put. Stale answers are dropped (generation counter plus `AbortController`);
  any failure falls back to a normal navigation. The selection code is re-bound
  after a swap.
- **Zebra rows** on the runs through `--surface-1` (hover steps to `--surface-2`), and a
  **Compact** density toggle stored in `localStorage` (`tumble.listDensity`) and applied
  as `data-density` on `<html>`, so it survives a swap.
- **Phones (<640px)**: each row is a card, title with its grade on the first line, the
  rest wrapping under it. Checkboxes appear only in **Select** mode, which is a real
  checkbox read by `:has()` (works without scripting); leaving the mode clears the
  selection. The pager shows only previous, next and "3 / 12".

## Why these choices

- **Cost and tokens sort by the run total the row shows.** A run row shows itself plus
  every subtask (Σ), so sorting by the task's own column would put a $0.10 run with a
  $5 subtask below a $1 solo task while the row reads $5.10. The totals come from one
  recursive CTE of (run, member) pairs with `UNION` (not `UNION ALL`), so a cycle in the
  client-supplied parent links ends the recursion and nothing is counted twice. It is
  only built when sorting by cost or tokens; the default sort is still the
  `ix_tasks_user_updated` index scan.
- **The grade filter is the grade rule in SQL** (`_grade_condition`), mirroring
  `Quality.grade`: unfinished = not completed; clean = completed with no errors,
  retries, interventions, condensing or repeated tool calls; friction = the rest.
- **Built links are entity-encoded.** The old pager wrote a literal `&` from the template
  and an escaped `&amp;` from the search; now every `&` in a built URL is `&amp;` (which
  is what HTML wants). `test_pager_links_every_page_in_the_window` follows that.

## Deviations

- The header is not an ARIA table (the list is a `ul` of rows with nested subtrees), so
  it carries no `aria-sort`; the sorted state is spoken through visually hidden text.
- Density applies when `tasklist.js` runs (end of body), so a compact reader can see
  one frame of the default density on a cold load. 4c adds a head script for the
  theme; the density could move there if the flash shows.
- "Filters" is a `<details>` disclosure rather than an always-visible row, to keep the
  list first on a phone.

## Tests

- `tests/test_web_task_list.py` (33): headers, sort links, each sort key, run-total sort,
  cycle, allow-list (5 bad inputs), pager/jump keep the view, compact pager status,
  14 filter cases, literal wildcards, the GET form, chips, clear-all, filtered empty
  state, swappable regions, bulk-delete redirect, select mode and density markup.
- `tests/browser/tasklist_filter_checks.html` (18 checks, headless Chrome): density
  toggle and memory, select mode clearing, debounce (one request 300 ms after the last
  keystroke), empty fields left out, swap of results and count, form not replaced,
  re-bound selection, submit folds the pending debounce.
- `tests/test_phone_layout.py` gains a filtered list with the panel open.
- `test_route_table` lists the new query parameters.
