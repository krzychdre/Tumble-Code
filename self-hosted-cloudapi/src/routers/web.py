"""The web panel, split by page (CAPI-M5); this module keeps the old import path.

Server-rendered pages (Jinja2) for browsing shared tasks in a browser:

- routers/web_tasks.py     GET /app, GET /app/tasks/{task_id}, the delete POSTs
- routers/web_metrics.py   GET /app/metrics
- routers/web_settings.py  GET/POST /app/settings, POST /app/settings/run
- routers/shared.py        GET /shared/{task_id} (anonymous if visibility=public)

The Jinja environment is web/templating.py, the view-models are in
web/presenters/, the metrics page's quality panel is services/quality_overview.py
and who may open a share link is services/task_access.py.

Login/logout live in routers/browser.py (/app/login, /app/logout) because they
reuse the Authentik OAuth flow there. Conversation rendering is done client-side
by static/render.js from the embedded ClineMessage[] JSON.

Everything below is a re-export, so ``from src.routers.web import ...`` keeps
working. Patch a name where it is looked up (for example
``web_tasks.PAGE_SIZE``), not here.
"""

from src.routers.shared import shared_task
from src.routers.web_metrics import metrics_page
from src.routers.web_settings import _positive_int, run_retention_now, save_settings, settings_page
from src.routers.web_tasks import PAGE_SIZE, bulk_delete_tasks, delete_task, task_detail, task_list
from src.services.quality_overview import _QUALITY_COLUMNS
from src.services.quality_overview import quality_overview as _quality_overview
from src.web.presenters.settings import _plan_view
from src.web.presenters.task_detail import (
    _load_task_messages,
    _model_context,
    _parse_messages,
    _quality_panel,
    _spend_row,
    _spend_summary,
    _tree_entries,
    _tree_entry,
)
from src.web.presenters.task_rows import (
    _PROMPT_WRAP_COLS,
    _PROMPT_WRAP_LINES,
    _list_row,
    _metrics_tooltip,
    _quality_fields,
    _row_tooltip,
    _run_tooltip,
    _spend_fields,
    _workspace_label,
    _wrap_prompt,
)
from src.web.templating import _asset_version, templates

__all__ = [
    "PAGE_SIZE",
    "_PROMPT_WRAP_COLS",
    "_PROMPT_WRAP_LINES",
    "_QUALITY_COLUMNS",
    "_asset_version",
    "_list_row",
    "_load_task_messages",
    "_metrics_tooltip",
    "_model_context",
    "_parse_messages",
    "_plan_view",
    "_positive_int",
    "_quality_fields",
    "_quality_overview",
    "_quality_panel",
    "_row_tooltip",
    "_run_tooltip",
    "_spend_fields",
    "_spend_row",
    "_spend_summary",
    "_tree_entries",
    "_tree_entry",
    "_workspace_label",
    "_wrap_prompt",
    "bulk_delete_tasks",
    "delete_task",
    "metrics_page",
    "run_retention_now",
    "save_settings",
    "settings_page",
    "shared_task",
    "task_detail",
    "task_list",
    "templates",
]
