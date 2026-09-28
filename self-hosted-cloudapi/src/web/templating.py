"""The web panel's Jinja environment: templates, filters and the asset token.

Every server-rendered page goes through ``templates``, including the 403 page
the network-access middleware sends, which is why this lives beside the
templates rather than in a router: the middleware can import it without pulling
in the routes.
"""

import hashlib
from pathlib import Path

from fastapi.templating import Jinja2Templates

from src.utils.format import JINJA_FILTERS

_WEB_DIR = Path(__file__).resolve().parent
templates = Jinja2Templates(directory=str(_WEB_DIR / "templates"))


def _asset_version(static_dir: Path = _WEB_DIR / "static") -> str:
    """Cache-busting token: a hash of every file in the static bundle.

    Appended as ``?v=<token>`` to every CSS/JS URL, vendored scripts included,
    and ``/static/`` answers a request carrying the current token with a
    one-year immutable Cache-Control (``VersionedStaticFiles``). That is only
    safe if any change to any file changes the token, so it hashes the bytes
    (about 0.5 MB, once at import) rather than trusting mtimes, which a
    checkout or an image build can set to anything. Recomputed at import: the
    server is restarted to pick up edits.
    """
    digest = hashlib.sha256()
    for path in sorted(p for p in static_dir.rglob("*") if p.is_file()):
        digest.update(path.relative_to(static_dir).as_posix().encode())
        digest.update(b"\0")
        digest.update(path.read_bytes())
        digest.update(b"\0")
    return digest.hexdigest()[:12]


ASSET_VERSION = _asset_version()


templates.env.globals["asset_v"] = ASSET_VERSION
templates.env.filters.update(JINJA_FILTERS)
