"""A safe ``Content-Disposition: attachment`` header for a download.

Download names are built from values a client chose (a task id, which the
extension sends and a path segment can carry anything in). Put straight into
``filename="..."`` such a value could close the quoted string and add
parameters of its own, carry CR/LF into the header, or hold characters a
header cannot (latin-1 only), which failed the response with 500.

The header carries two names (RFC 6266): ``filename`` with every character
outside a safe ASCII set replaced by ``_``, for old clients, and
``filename*`` with the whole name UTF-8 and percent-encoded (RFC 5987), which
current browsers prefer.
"""

import re
from urllib.parse import quote

_UNSAFE = re.compile(r"[^A-Za-z0-9._-]")
_MAX_NAME = 200


def attachment(filename: str) -> str:
    """The ``Content-Disposition`` value that downloads as ``filename``."""
    name = filename[:_MAX_NAME]
    fallback = _UNSAFE.sub("_", name).lstrip(".") or "download"
    encoded = quote(name, safe="")
    return f"attachment; filename=\"{fallback}\"; filename*=UTF-8''{encoded}"
