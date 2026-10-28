# Cloud web: the Dataset page in four tabs

**Status:** done on `feat/cloud-web-dataset-tabs` (on `feat/cloud-web-settings-tabs`, whose `_tabs.html` and
`paginate()` it uses).
**Related plans:** `2026-10-02_llm-exchange-dataset.md` (what the dataset is), `2026-10-27_10-03_cloud-web-settings-tabs.md`.
**Touched:** `self-hosted-cloudapi/src/routers/web_dataset.py`, `src/services/dataset_overview.py`, templates
`_dataset_head.html` (new), `dataset.html`, `dataset_export.html`, `dataset_tasks.html`, `dataset_recording.html`
(new), `src/web/static/app.css`, `README.md`, `docs/08-cloud.md`, tests `test_dataset_export.py`,
`test_client_filters.py`, `test_route_table.py`, `test_route_boilerplate.py`, `test_web_a11y_csp.py`,
`test_phone_layout.py`.

## Symptom

The owner (2026-10-27): the dataset page is one long strip with settings in it, unreadable and against every UI rule.
One page held, top to bottom: the period and client selectors, the recording switch and the anonymization terms (a
setting, saved by its own button), four counters, the per-model table, the issues table, a form of twelve controls
with one checkbox per model and per project, the 20 latest tasks, and "Delete all recordings". Things that are set
once sat between things read every day, and the export form grew with every model and project.

## Design

Four tabs under the "Dataset" heading (`_dataset_head.html`, built on `_tabs.html`), each its own URL:

| Tab       | URL                       | Holds                                                                                   |
| --------- | ------------------------- | --------------------------------------------------------------------------------------- |
| Overview  | `/app/dataset`            | the counters, "By model", "Why exchanges are left out"                                  |
| Export    | `/app/dataset/export`     | the export form in two panels: what goes in, how it is written; the audit button        |
| Tasks     | `/app/dataset/tasks`      | every recorded task, latest first, 25 to a page, each downloadable in full              |
| Recording | `/app/dataset/recording`  | the recording switch, the anonymization terms, deleting all recordings with their count |

- Overview, Export and Tasks show a period and a client; their selectors stay on the tab, and the tabs carry the
  period and client along, so switching tabs keeps what you are looking at. Recording has no period: it is a
  setting, and its "Delete all" counts every recording.
- The model and project checklists of the export scroll inside a box (`.pick-list`) instead of stretching the form.
- The Tasks tab replaces "the 20 latest tasks" with the full paged list (`recorded_tasks`, count plus
  limit/offset in SQL). The task filter of the overview and the tasks list is one helper (`_scope`).
- Saving the recording settings is `POST /app/dataset/recording` (was `/app/dataset/settings`) and returns there;
  deleting recordings returns there too, with the count removed.
- The export, the audit, the task download and the delete keep their URLs.

## Tests

- `test_the_tabs_count_offer_the_export_and_list_the_tasks`: each tab holds its part (models and issues; the export
  form; the task download; the switch, the terms and the recording count).
- `test_the_tabs_keep_the_period_and_client`: the tabs and the period selector of the Tasks tab carry `period` and
  `client`. Mutation: dropping the client from the tab links turns it red.
- `test_the_tasks_tab_pages_latest_first`: 28 tasks, page 1 starts with the latest and holds 25, a page past the end
  lands on the last page with the three oldest. Mutation: ascending order turns it red.
- The route table, the route boilerplate check (status and redirect target of every route), the CSP check and the
  phone layout check list the three new pages.

## Notes

- `docs/08-cloud.md` and the API README name the new URLs.
