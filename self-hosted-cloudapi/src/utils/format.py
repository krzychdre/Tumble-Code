"""Shared number/format helpers for the web task-list and the metrics dashboard.

These were previously duplicated in ``src/routers/web.py`` (``_num``,
``_fmt_tokens``, ``_fmt_duration``) and ``src/services/metrics_service.py``
(``_num``, ``fmt_tokens``, ``fmt_duration``). The duplication caused CB-7: one
copy counted ``True``/``False`` as 1.0/0.0 (``bool`` is a subclass of ``int``)
while the other excluded bools, so a malformed ``tokensIn: true`` inflated one
view and not the other. This module is the single source of truth; both
callers must import from here so the drift cannot silently return.
"""


def num(value) -> float:
    """Coerce a JSON number to float, treating anything else as 0.

    ``bool`` is excluded because in Python ``bool`` is a subclass of ``int``
    (``isinstance(True, (int, float))`` is ``True``), and a malformed
    ``tokensIn: true`` should not add 1.0 to the total.
    """
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) else 0


def fmt_tokens(n: float) -> str:
    """Compact token count: 1_000_000 -> "1M", 96_941 -> "96.9k".

    Mirrors ``fmt()`` in static/live.js so the list and detail header read the
    same.
    """
    magnitude = float(n)
    for threshold, suffix in ((1e9, "B"), (1e6, "M"), (1e3, "k")):
        if abs(magnitude) >= threshold:
            return f"{magnitude / threshold:.1f}".rstrip("0").rstrip(".") + suffix
    return str(int(magnitude))


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
