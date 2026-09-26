"""Shared number/format helpers for the web task-list and the metrics dashboard.

These were previously duplicated in ``src/routers/web.py`` (``_num``,
``_fmt_tokens``, ``_fmt_duration``) and ``src/services/metrics_service.py``
(``_num``, ``fmt_tokens``, ``fmt_duration``). The duplication caused CB-7: one
copy counted ``True``/``False`` as 1.0/0.0 (``bool`` is a subclass of ``int``)
while the other excluded bools, so a malformed ``tokensIn: true`` inflated one
view and not the other. This module is the single source of truth; both
callers must import from here so the drift cannot silently return.

The browser formats the same figures when it updates a page live
(``static/format.js``). The two agree to the character: ``fmt_tokens`` and
``fmt_cost`` round the way JavaScript does (half up, see ``round_half_up`` and
``_to_fixed``), and ``tests/test_format_golden.py`` checks one table of inputs
and expected strings against both.
"""

import math
from decimal import ROUND_HALF_UP, Decimal


def num(value) -> float:
    """Coerce a JSON number to float, treating anything else as 0.

    ``bool`` is excluded because in Python ``bool`` is a subclass of ``int``
    (``isinstance(True, (int, float))`` is ``True``), and a malformed
    ``tokensIn: true`` should not add 1.0 to the total.
    """
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) else 0


def round_half_up(value: float) -> int:
    """Nearest integer, a tie going up: JavaScript's ``Math.round``.

    Python's ``round`` sends a tie to the even neighbour (``round(2.5) == 2``),
    ``Math.round`` sends it up (3, and -2 for -2.5). Taking the fraction off the
    floor is exact for a float, so this matches ``Math.round`` everywhere.
    """
    value = float(value)
    floor = math.floor(value)
    return int(floor) + (1 if value - floor >= 0.5 else 0)


def _to_fixed(value: float, places: int) -> str:
    """``value`` with ``places`` decimals: JavaScript's ``Number.toFixed``.

    ``toFixed`` rounds the float's exact binary value and sends a tie away from
    zero; ``"%.4f"`` rounds the same exact value but sends a tie to the even
    digit. They differ only on a true tie (0.03125 is "0.0313" in the browser
    and was "0.0312" here), and a figure the browser later rewrites must not
    change when it does.
    """
    value = float(value) or 0.0  # -0.0 prints as "0", as toFixed does
    exact = Decimal(value).quantize(Decimal(1).scaleb(-places), rounding=ROUND_HALF_UP)
    return f"{exact:f}"


def fmt_tokens(n: float) -> str:
    """Compact token count: 1_000_000 -> "1M", 96_941 -> "96.9k", 512 -> "512".

    ``TumbleFormat.tokens`` in static/format.js is the same function, so the
    list and the live detail header read the same. Below a thousand the count
    is rounded to the nearest integer (token counts are integers in practice).
    """
    magnitude = float(n)
    for threshold, suffix in ((1e9, "B"), (1e6, "M"), (1e3, "k")):
        if abs(magnitude) >= threshold:
            return _to_fixed(magnitude / threshold, 1).removesuffix(".0") + suffix
    return str(round_half_up(magnitude))


def fmt_cost(dollars: float) -> str:
    """A cost to four places: 0.1656 -> "$0.1656". ``TumbleFormat.cost`` in JS."""
    return "$" + _to_fixed(dollars, 4)


def fmt_int(n: float) -> str:
    """A whole count with thousands separators: 1234567 -> "1,234,567"."""
    return f"{round_half_up(n):,}"


def plural(n: int, word: str) -> str:
    """``n`` and ``word``, the word pluralised unless there is exactly one."""
    return f"{n} {word}{'' if n == 1 else 's'}"


def fmt_bytes(n: int) -> str:
    """Human size in binary units: 1536 -> "1.5 KB", GB the largest unit."""
    size = float(n)
    for unit in ("B", "KB", "MB", "GB"):
        if abs(size) < 1024 or unit == "GB":
            return f"{size:.0f} {unit}" if unit == "B" else f"{size:.1f} {unit}"
        size /= 1024
    return f"{size:.1f} GB"


def fmt_duration(ms: float) -> str:
    """Human session span: 4500 -> "4s", 125000 -> "2m 5s", 3_700_000 -> "1h 1m"."""
    total = int(ms // 1000)
    if total <= 0:
        return "0s"
    hours, rem = divmod(total, 3600)
    minutes, seconds = divmod(rem, 60)
    if hours:
        return f"{hours}h {minutes}m"
    if minutes:
        return f"{minutes}m {seconds}s"
    return f"{seconds}s"


# The helpers the templates use as filters, e.g. ``{{ t.cost|fmt_cost }}``.
JINJA_FILTERS = {
    "fmt_bytes": fmt_bytes,
    "fmt_cost": fmt_cost,
    "fmt_int": fmt_int,
    "fmt_tokens": fmt_tokens,
    "plural": plural,
}
