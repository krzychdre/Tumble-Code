"""``/static/``: the web panel's CSS and scripts, cached hard when versioned.

Every template links its assets as ``/static/<file>?v=<token>``, where the
token hashes the whole bundle (``src.web.templating.ASSET_VERSION``). A request
carrying the current token can therefore be cached for a year without ever
going stale: new content means a new token, hence a new URL. Anything else (no
token, or an old one) keeps the plain ETag/Last-Modified revalidation, so a
page cached from before a deploy never pins a mismatched asset for a year.
"""

from urllib.parse import parse_qs

from starlette.staticfiles import StaticFiles
from starlette.types import Scope

from src.web.templating import ASSET_VERSION

IMMUTABLE = "public, max-age=31536000, immutable"


class VersionedStaticFiles(StaticFiles):
    def file_response(self, full_path, stat_result, scope: Scope, status_code: int = 200):
        response = super().file_response(full_path, stat_result, scope, status_code)
        query = parse_qs(scope.get("query_string", b"").decode("latin-1"))
        if query.get("v") == [ASSET_VERSION]:
            response.headers["Cache-Control"] = IMMUTABLE
        return response
