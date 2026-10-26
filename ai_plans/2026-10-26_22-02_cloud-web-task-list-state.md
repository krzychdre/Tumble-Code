# Cloud web task list: remembered view, closed groups, full pickers (2026-10-26)

**Status:** implemented on `fix/cloud-web-task-list-state`.
**Related plans:** `2026-10-26_18-23_cloud-web-task-groups.md` (the groups, #1149), `2026-09-28_ui-4a-cloud-list.md`
(the filter form and its live fetch), the metrics period cookie (`routers/web_metrics.py`, `PERIOD_COOKIE`).
**Touched:** `self-hosted-cloudapi/src/routers/web_tasks.py`, `src/web/presenters/task_list.py`,
`src/web/templates/tasks_list.html`, `src/web/static/tasklist.js`, `src/web/static/app.css`, `README.md`, tests
(`test_web_task_list.py`, `test_route_table.py`, `test_browser_js.py`, `browser/taskgroup_checks.html`,
`browser/tasklist_filter_checks.html`), `.changeset/cloud-web-task-list-state.md`.

## Symptom

The owner reported three defects in `/app` after #1149:

1. A reload or a later visit to `/app` lost which groups were open and what was typed or picked in the filters.
2. The first group started open. Every group, also the one a filter or a search narrows the list to, and the subtask
   rows under a task, should start closed.
3. After picking a project in the project filter, its suggestions offered only that project; the model filter did
   the same.

## What was happening

1. Nothing remembered the view. `task_list` (`routers/web_tasks.py:58`, at `ab4566517`) built the view from the URL
   alone, and the nav link and the redirect after a single delete are a bare `/app`, so both opened the default
   list. Open groups were plain `<details>` state, lost on every page load and on every live filter swap
   (`tasklist.js` replaces `#task-results`).
2. `tasks_list.html:227`: `<details class="task-group"{% if loop.first %} open{% endif %}>`. With a project filter
   or a search the one remaining group is the first, so it was always open. Subtask trees already start folded
   (`hidden` on `.task-children`).
3. The server was not the cause. `_filter_suggestions` (`task_list.py:664`) reads every project and model of the
   user (`Task.user_id == user_id` only, lines 673 and 679), and the filter form is outside the `[data-swap]`
   regions the live fetch replaces. Rendering `/app`, `/app?project=beta`, `/app?model=glm-5.3` and both together on
   the test data gave the same `project-options` (`alpha, beta, gamma`) and `model-options`
   (`claude-opus-5, glm-5.3`) every time. The fields were `<input type="text" list="project-options">`
   (`tasks_list.html:131`, `:133`) with a `<datalist>` (`:157`, `:158`), and a browser narrows a datalist's
   suggestions to the options that match the text already in the field (the HTML standard leaves the filtering to
   the user agent; Chrome and Firefox match the current value). Once a project is picked, the field holds its name
   and only that option matches.

## Fix

1. **The view in a cookie.** `tumble_task_list_view` holds the query string of the view (`ListView.query()`, the
   same parameters `ListView.url()` writes, without the page). Precedence: a request with any query parameter is a
   whole view (every link the list writes carries the full state) and wins; it is then remembered. A bare `/app`
   reads the cookie. Both sources go through the same line,
   `ListView.parse(**{name: source.get(name) for name in _VIEW_FIELDS})`, so the view parameters are no longer
   declared one by one in the route (only `page` is). The live filter fetch is an `/app?...` request too, so typing
   in the filters is remembered without extra code. Same attributes as the metrics period cookie (a year,
   `httponly`, `lax`), path `/app`.
2. **Open groups in localStorage.** Every group is served closed with `data-group="<grouping>:<key>"` (key `(none)`
   for the group without one). `tasklist.js` keeps the open keys in `tumble.openGroups`, reopens them on load and
   after every swap, and on a group's `toggle` adds or removes only that key, so groups of other pages and other
   groupings keep their state. It is client-side because the open state changes without a request, like the
   density preference next to it.
3. **Pickers instead of datalists.** Project and model are `<select class="filter-pick">` with "Any" and every
   option, like Client and Grade. A filter value no task has any more (an old bookmark, a remembered view) is added
   to its options, so the picker shows what the list is filtered by and a later change of another field does not
   drop it.

## Tests

- `test_a_bare_visit_opens_on_the_view_last_looked_at` (two views, one with `+&=%";` in the search): the bare visit
  has the same links and rows as the picked view, an explicit `/app?scope=roots` replaces it, and the next bare
  visit follows. `_get` now clears the client's cookies, so every other test is a fresh browser.
- `test_the_list_is_grouped_by_project_by_default`: every group closed, also with `project=alpha` and `q=beta`.
- `test_the_pickers_offer_every_project_and_model_whatever_is_picked`: all options with the picked one selected,
  and a gone model offered and selected. It replaces the datalist asserts of the plain-form test.
- `browser/taskgroup_checks.html` (new): a remembered group reopens, the others stay closed, opening and closing is
  stored, another grouping's key survives. `tasklist_filter_checks.html`: a remembered group reopens in the swapped
  list.
- `test_route_table.py`: `/app` declares only `page` now.

Mutations, each seen red and restored from a `cp` backup: first group open again; suggestions built from
`view.conditions` (the filtered rows); the gone value not added; the cookie never read; the cookie written only on
bare visits; the cookie holding `view.url()` instead of the query (red once the case with `scope=all` was added);
`reopenGroups` only on first load (the swap check); the toggle not stored; the stored list rebuilt from this page
only.

## Notes

- The pickers drop free-text matching in the project and model fields (typing `glm` to match every GLM model).
  The search box still matches any part of a workspace path; a model substring now needs the URL.
- A long query or path makes a cookie of a few hundred bytes; the search is clipped at 200 characters.
