"""The app's route table, pinned: every path, method and route name.

Splitting ``routers/web.py`` into several routers (CAPI-M5) must keep every URL,
method and name exactly as it was. The only thing a split may change is the
order in which routes are registered, and order only matters where one route's
path pattern also matches another route's path: those pairs are pinned in
their registration order below.
"""

import re

from fastapi.routing import APIRoute
from starlette.routing import Mount

from src.main import app

try:  # FastAPI 0.141+ keeps an included router as one lazy entry.
    from fastapi.routing import _IncludedRouter
except ImportError:  # pragma: no cover - older FastAPI flattens on include
    _IncludedRouter = ()


def _flatten(routes, prefix=""):
    for route in routes:
        if _IncludedRouter and isinstance(route, _IncludedRouter):
            yield from _flatten(route.original_router.routes, prefix + route.include_context.prefix)
        else:
            yield prefix, route


def _routes():
    return list(_flatten(app.router.routes))


def _key(prefix, route):
    methods = tuple(sorted(getattr(route, "methods", None) or ()))
    return (prefix + route.path, methods, route.name, type(route).__name__)


EXPECTED = {
    ("/openapi.json", ("GET", "HEAD"), "openapi", "Route"),
    ("/docs", ("GET", "HEAD"), "swagger_ui_html", "Route"),
    ("/docs/oauth2-redirect", ("GET", "HEAD"), "swagger_ui_redirect", "Route"),
    ("/redoc", ("GET", "HEAD"), "redoc_html", "Route"),
    ("/v1/client/sign_ins", ("POST",), "sign_in", "APIRoute"),
    ("/v1/client/sessions/{session_id}/tokens", ("POST",), "create_session_token", "APIRoute"),
    ("/v1/me", ("GET",), "get_me", "APIRoute"),
    ("/v1/me/organization_memberships", ("GET",), "get_organization_memberships", "APIRoute"),
    ("/v1/client/sessions/{session_id}/remove", ("POST",), "remove_session", "APIRoute"),
    ("/extension/sign-in", ("GET",), "sign_in_page", "APIRoute"),
    ("/app/login", ("GET",), "web_login", "APIRoute"),
    ("/app/logout", ("POST",), "web_logout", "APIRoute"),
    ("/app/signed-out", ("GET",), "web_signed_out", "APIRoute"),
    ("/auth/clerk/callback", ("GET",), "auth_callback", "APIRoute"),
    ("/auth/error", ("GET",), "auth_error_page", "APIRoute"),
    ("/api/extension/share", ("POST",), "share_task_endpoint", "APIRoute"),
    ("/api/extension/bridge/config", ("GET",), "bridge_config_endpoint", "APIRoute"),
    ("/api/extension-settings", ("GET",), "extension_settings_endpoint", "APIRoute"),
    ("/api/user-settings", ("PATCH",), "update_user_settings_endpoint", "APIRoute"),
    ("/api/events", ("POST",), "record_event_endpoint", "APIRoute"),
    ("/api/events/backfill", ("POST",), "backfill_events_endpoint", "APIRoute"),
    ("/api/error-reports", ("POST",), "record_error_report_endpoint", "APIRoute"),
    ("/api/llm-exchanges/config", ("GET",), "llm_exchange_config_endpoint", "APIRoute"),
    ("/api/llm-exchanges", ("POST",), "record_llm_exchange_endpoint", "APIRoute"),
    ("/api/llm-exchanges/outcome", ("POST",), "record_llm_exchange_outcome_endpoint", "APIRoute"),
    # The web panel (routers/web.py before CAPI-M5).
    ("/", ("GET",), "root_redirect", "APIRoute"),
    ("/app", ("GET",), "task_list", "APIRoute"),
    ("/app/metrics", ("GET",), "metrics_page", "APIRoute"),
    ("/app/diagnostics", ("GET",), "diagnostics_page", "APIRoute"),
    ("/app/diagnostics/report.md", ("GET",), "diagnostics_markdown", "APIRoute"),
    ("/app/diagnostics/problems/{key}/brief.md", ("GET",), "diagnostics_problem_brief", "APIRoute"),
    ("/app/diagnostics/reports/{report_id}", ("GET",), "diagnostics_report", "APIRoute"),
    ("/app/dataset", ("GET",), "dataset_page", "APIRoute"),
    ("/app/dataset/settings", ("POST",), "save_dataset_settings_endpoint", "APIRoute"),
    ("/app/dataset/export.jsonl", ("GET",), "dataset_export", "APIRoute"),
    ("/app/dataset/audit", ("GET",), "dataset_audit", "APIRoute"),
    ("/app/dataset/tasks/{task_id}.jsonl", ("GET",), "dataset_task_report", "APIRoute"),
    ("/app/dataset/delete", ("POST",), "dataset_delete_all", "APIRoute"),
    ("/app/tasks/{task_id}", ("GET",), "task_detail", "APIRoute"),
    ("/app/tasks/{task_id}/delete", ("POST",), "delete_task", "APIRoute"),
    ("/app/settings", ("GET",), "settings_page", "APIRoute"),
    ("/app/settings", ("POST",), "save_settings", "APIRoute"),
    ("/app/settings/run", ("POST",), "run_retention_now", "APIRoute"),
    ("/app/tasks/bulk-delete", ("POST",), "bulk_delete_tasks", "APIRoute"),
    ("/shared/{task_id}", ("GET",), "shared_task", "APIRoute"),
    ("/static", (), "static", "Mount"),
    ("/bridge", (), None, "Mount"),
    ("/health", ("GET",), "health_check", "APIRoute"),
    ("/health/ready", ("GET",), "readiness_check", "APIRoute"),
}


def test_every_path_method_and_name_is_unchanged():
    keys = [_key(prefix, route) for prefix, route in _routes()]

    assert len(keys) == len(set(keys)), "a route is registered twice"
    assert set(keys) == EXPECTED


def test_overlapping_routes_keep_their_order():
    """Pairs where the earlier route's pattern also matches the later one's path.

    Methods are ignored on purpose: a path match with the wrong method is a
    partial match in Starlette, which still decides between a 405 and the next
    route, so the pair's order is pinned either way.
    """
    routes = [route for _prefix, route in _routes() if isinstance(route, (APIRoute, Mount))]

    def concrete(path):
        return re.sub(r"\{[^}]+\}", "x", path)

    overlaps = []
    for i, first in enumerate(routes):
        for second in routes[i + 1:]:
            if first.path_regex.match(concrete(second.path)) or second.path_regex.match(
                concrete(first.path)
            ):
                overlaps.append((first.name, second.name))

    assert overlaps == [
        ("task_detail", "bulk_delete_tasks"),
        ("settings_page", "save_settings"),
    ]


# The problem report's period, filters and sort (routers/web_diagnostics.problem_filter).
_PROBLEM_FILTERS = (
    ("period", "query", False),
    ("class", "query", False),
    ("category", "query", False),
    ("model", "query", False),
    ("provider", "query", False),
    ("tool", "query", False),
    ("source", "query", False),
    ("q", "query", False),
    ("sort", "query", False),
)


def test_web_routes_keep_their_openapi_operations():
    """Operation id, tags, response type and parameters of every web route.

    Read from the OpenAPI schema, which reflects what the routers were included
    with (tags from an including router land here, not on the route object).
    """
    ops = {}
    for path, methods in app.openapi()["paths"].items():
        if not path.startswith(("/app", "/shared")):
            continue
        for method, op in methods.items():
            params = tuple((p["name"], p["in"], p.get("required", False)) for p in op.get("parameters", []))
            content = tuple(sorted(op["responses"]["200"].get("content", {})))
            ops[(path, method)] = (op["operationId"], tuple(op.get("tags", [])), content, params)

    html, json_ = ("text/html",), ("application/json",)
    assert ops == {
        ("/app/login", "get"): ("web_login_app_login_get", ("browser-auth",), json_, ()),
        ("/app/logout", "post"): ("web_logout_app_logout_post", ("browser-auth",), json_, ()),
        ("/app/signed-out", "get"): ("web_signed_out_app_signed_out_get", ("browser-auth",), html, ()),
        ("/app", "get"): (
            "task_list_app_get",
            ("web",),
            html,
            (
                ("page", "query", False),
                ("q", "query", False),
                ("scope", "query", False),
                ("project", "query", False),
                ("model", "query", False),
                ("grade", "query", False),
                ("since", "query", False),
                ("until", "query", False),
                ("subtasks", "query", False),
                ("sort", "query", False),
                ("dir", "query", False),
            ),
        ),
        ("/app/metrics", "get"): (
            "metrics_page_app_metrics_get",
            ("web",),
            html,
            (("period", "query", False), ("client", "query", False), ("day_page", "query", False)),
        ),
        ("/app/diagnostics", "get"): (
            "diagnostics_page_app_diagnostics_get",
            ("web",),
            html,
            _PROBLEM_FILTERS,
        ),
        ("/app/diagnostics/report.md", "get"): (
            "diagnostics_markdown_app_diagnostics_report_md_get",
            ("web",),
            ("text/plain",),
            _PROBLEM_FILTERS,
        ),
        ("/app/diagnostics/problems/{key}/brief.md", "get"): (
            "diagnostics_problem_brief_app_diagnostics_problems__key__brief_md_get",
            ("web",),
            ("text/plain",),
            (("key", "path", True),) + _PROBLEM_FILTERS,
        ),
        ("/app/diagnostics/reports/{report_id}", "get"): (
            "diagnostics_report_app_diagnostics_reports__report_id__get",
            ("web",),
            html,
            (("report_id", "path", True),),
        ),
        ("/app/dataset", "get"): (
            "dataset_page_app_dataset_get",
            ("web",),
            html,
            (("period", "query", False), ("deleted", "query", False)),
        ),
        ("/app/dataset/settings", "post"): ("save_dataset_settings_endpoint_app_dataset_settings_post", ("web",), json_, ()),
        ("/app/dataset/export.jsonl", "get"): ("dataset_export_app_dataset_export_jsonl_get", ("web",), json_, ()),
        ("/app/dataset/audit", "get"): ("dataset_audit_app_dataset_audit_get", ("web",), html, ()),
        ("/app/dataset/tasks/{task_id}.jsonl", "get"): (
            "dataset_task_report_app_dataset_tasks__task_id__jsonl_get",
            ("web",),
            json_,
            (("task_id", "path", True),),
        ),
        ("/app/dataset/delete", "post"): ("dataset_delete_all_app_dataset_delete_post", ("web",), json_, ()),
        ("/app/tasks/{task_id}", "get"): (
            "task_detail_app_tasks__task_id__get",
            ("web",),
            html,
            (("task_id", "path", True),),
        ),
        ("/app/tasks/{task_id}/delete", "post"): (
            "delete_task_app_tasks__task_id__delete_post",
            ("web",),
            json_,
            (("task_id", "path", True),),
        ),
        ("/app/settings", "get"): ("settings_page_app_settings_get", ("web",), html, (("ran", "query", False), ("size", "query", False))),
        ("/app/settings", "post"): ("save_settings_app_settings_post", ("web",), json_, ()),
        ("/app/settings/run", "post"): ("run_retention_now_app_settings_run_post", ("web",), json_, ()),
        ("/app/tasks/bulk-delete", "post"): ("bulk_delete_tasks_app_tasks_bulk_delete_post", ("web",), json_, ()),
        ("/shared/{task_id}", "get"): ("shared_task_shared__task_id__get", ("web",), html, (("task_id", "path", True),)),
    }
