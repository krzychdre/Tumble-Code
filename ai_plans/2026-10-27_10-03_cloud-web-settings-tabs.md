# Cloud web: Settings in tabs, breadcrumbs, one pager helper

**Status:** done on `feat/cloud-web-settings-tabs` (cut from `feat/recall-extension`, the tip of the unmerged
recall stack, because the Projects and Organizations pages exist only there).
**Related plans:** `2026-10-26_18-22_cross-session-recall.md` (Projects, Organizations),
`2026-10-26_18-23_cloud-web-task-groups.md` (the task list's pager).
**Touched:** `self-hosted-cloudapi/src/web/templates/{_tabs,_breadcrumbs,_settings_head}.html` (new),
`settings.html`, `projects.html`, `organizations.html`, `organization_detail.html`, `src/web/static/app.css`,
`src/utils/pagination.py`, `src/web/presenters/{task_list,charts}.py`, tests `test_web_settings.py`,
`test_pagination.py`, `test_web_metrics_svg.py`.

## Symptom

The owner, on the web panel (2026-10-27): Settings should have tabs or something that makes navigation easier; today
it jumps between screens without saying so. The Settings page held two panels whose only content was a link
("Manage organizations", "Manage projects"); following one opened a page with its own title, no way back other than
the browser, and the Settings tab of the top bar still lit.

## Design

- **Tabs.** `_tabs.html` holds one macro, `tabs(items, active, label)`: a row of links, the active one marked with
  `aria-current="page"`. Each tab keeps its own URL (`/app/settings`, `/app/projects`, `/app/organizations`), so a
  tab can be bookmarked, the back button works, and nothing outside the panel that links to those URLs breaks.
  `_settings_head.html` is the heading every Settings tab shares: the title "Settings" and the three tabs
  (Retention, Projects, Organizations). The two link-only panels are gone from the Retention tab. The dataset page
  will reuse the same macro for its own sections.
- **Breadcrumbs.** `_breadcrumbs.html` holds `breadcrumbs(links, here)`, drawn with the existing `.trail` style of a
  subtask's page. A detail page under Settings starts with it: `Settings / Organizations / <name>`.
- **Style.** The tabs reuse the top bar's underline rules (`.mainnav a` and `.tabs a` share them) on a rule across the
  page; on a phone the row scrolls sideways instead of wrapping. The last crumb is cut with an ellipsis like the
  links before it; the phone layout check found a 100-character organization name running 12 px past a 390 px
  screen without it.
- **Pager arithmetic in one place.** The page count, the clamping of an out-of-range page and the offset of its first
  item were written out three times (the task list, its grouped view, the metrics page's daily table).
  `paginate(total, page, size)` in `src/utils/pagination.py` returns the fields `_pager.html` reads plus the
  `offset`, and the three sites use it. The paged Projects and Organizations lists are built on it.

## Tests

- `test_every_settings_tab_marks_itself_and_links_the_others`: each tab page marks exactly its own tab and links
  the other two. Mutation: the Projects page passing `"retention"` as its active tab turns it red.
- `test_paginate_clamps_the_page_and_counts_the_offset`: empty list, a page past the end, a normal second page, a
  page below 1.
- The phone layout check (`test_phone_layout.py`) covers the new heading on all three tabs and the breadcrumbs on
  an organization's page with the 100-character name.

## Notes

- The URLs stay as they were; only the navigation between them changed.
