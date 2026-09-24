"""Serialize data for a ``<script type="application/json">`` island.

The HTML parser ends a script element at the first ``</script`` it meets and
treats ``<!--`` inside it specially, whatever the JSON inside means. Plain
``json.dumps`` output therefore cannot be printed into an island: stored text
such as ``</script><img src=x onerror=...>`` would close the element and run
as markup (DEF-S2).

``json_for_script`` writes ``<``, ``>`` and ``&`` as JSON unicode escapes, so
no markup can appear in the island at all, and U+2028/U+2029 as well, so the
output stays valid if it is ever pasted into JavaScript source. ``JSON.parse``
on the element's text gives back exactly the original data.

It returns ``Markup``: the result is already safe for the page, so templates
print it as ``{{ value }}`` and never need ``| safe`` (a test forbids it on
islands).
"""

import json
from typing import Any

from markupsafe import Markup

_ESCAPES = {
    ord("<"): "\\u003c",
    ord(">"): "\\u003e",
    ord("&"): "\\u0026",
    0x2028: "\\u2028",
    0x2029: "\\u2029",
}


def json_for_script(value: Any) -> Markup:
    """JSON text for an island, safe to print inside ``<script>``."""
    return Markup(json.dumps(value).translate(_ESCAPES))
