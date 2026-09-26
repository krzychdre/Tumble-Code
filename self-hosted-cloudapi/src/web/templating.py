"""The web panel's Jinja environment: templates, filters and the asset token.

Every server-rendered page goes through ``templates``, including the 403 page
the network-access middleware sends, which is why this lives beside the
templates rather than in a router: the middleware can import it without pulling
in the routes.
"""

from pathlib import Path

from fastapi.templating import Jinja2Templates

from src.utils.format import JINJA_FILTERS

_WEB_DIR = Path(__file__).resolve().parent
templates = Jinja2Templates(directory=str(_WEB_DIR / "templates"))


def _asset_version() -> str:
    """Cache-busting token: newest mtime across the static bundle.

    Appended as ``?v=<token>`` to CSS/JS URLs so a browser refetches the
    assets whenever they change instead of serving a stale cached copy
    (the page HTML is dynamic, but ``/static/*`` is otherwise cached hard).
    Recomputed at import - the server is restarted to pick up edits.
    """
    static_dir = _WEB_DIR / "static"
    try:
        latest = max(p.stat().st_mtime_ns for p in static_dir.rglob("*") if p.is_file())
    except ValueError:
        return "0"
    return format(latest, "x")


templates.env.globals["asset_v"] = _asset_version()
templates.env.filters.update(JINJA_FILTERS)
