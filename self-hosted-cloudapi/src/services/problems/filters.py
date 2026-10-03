"""One state of the problem report: period, filters and sort.

Read from the query string by ``parse``, which never fails: a class, a source
or a sort it does not know is dropped (a stale or hand-edited link lands on
the unfiltered list, not on an error), the period falls back to the default.
Category, model, provider and tool are free text compared exactly, so a shared
link for a model that has no problems in the chosen period shows an empty
list that says so. ``klass`` is a class key (``CLASS_KEYS``), the URL's
``class``.

Filters (class, category, model, provider, tool, source, free text) and the
sort run after the period's occurrences are collected: they are a few
thousand rows at most, and filtering in Python lets one filter apply to all
three sources alike. The period stays in SQL.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from typing import TYPE_CHECKING

from src.services.metrics_service import DEFAULT_PERIOD, PERIODS
from src.services.problem_catalogue import CLASS_BY_KEY, CLASS_KEYS
from src.services.problems.base import SOURCE_LABELS, UNKNOWN_MODEL, Occurrence

if TYPE_CHECKING:
    from src.services.problem_catalogue import Rule

SORT_IMPACT = "impact"
SORT_COUNT = "count"
SORT_RECENT = "recent"
SORT_LABELS = {SORT_IMPACT: "Impact", SORT_COUNT: "Occurrences", SORT_RECENT: "Last seen"}

# The order the filters appear in every URL and in the brief's header.
FILTER_FIELDS = ("class", "category", "model", "provider", "tool", "source", "q")
FILTER_LABELS = {
    "class": "Class",
    "category": "Category",
    "model": "Model",
    "provider": "Provider",
    "tool": "Tool",
    "source": "Source",
    "q": "Search",
}
_FILTER_TEXT_MAX = 200


def _param(value) -> str:
    return value.strip()[:_FILTER_TEXT_MAX] if isinstance(value, str) else ""


@dataclass(frozen=True)
class ProblemFilter:
    """One state of the problem report: period, filters and sort."""

    period: str = DEFAULT_PERIOD
    klass: str = ""
    category: str = ""
    model: str = ""
    provider: str = ""
    tool: str = ""
    source: str = ""
    q: str = ""
    sort: str = SORT_IMPACT

    @classmethod
    def parse(cls, params) -> "ProblemFilter":
        """From a mapping of query parameters (``request.query_params``)."""
        get = params.get
        period = get("period")
        klass = get("class")
        source = get("source")
        sort = get("sort")
        return cls(
            period=period if period in PERIODS else DEFAULT_PERIOD,
            klass=klass if klass in CLASS_BY_KEY else "",
            category=_param(get("category")),
            model=_param(get("model")),
            provider=_param(get("provider")),
            tool=_param(get("tool")),
            source=source if source in SOURCE_LABELS else "",
            q=_param(get("q")),
            sort=sort if sort in SORT_LABELS else SORT_IMPACT,
        )

    def value(self, name: str) -> str:
        return self.klass if name == "class" else getattr(self, name)

    def label(self, name: str) -> str:
        """The filter's value as the page says it ("Model mismatch", not "model")."""
        value = self.value(name)
        if name == "class":
            return CLASS_BY_KEY.get(value, value)
        if name == "source":
            return SOURCE_LABELS.get(value, value)
        return value

    @property
    def active(self) -> bool:
        return any(self.value(name) for name in FILTER_FIELDS)

    def without(self, *names: str) -> "ProblemFilter":
        changes = {("klass" if name == "class" else name): "" for name in names}
        return replace(self, **changes)

    def describe(self) -> str:
        """The active filters in one line, for the brief's header."""
        parts = [f"{FILTER_LABELS[name].lower()} {self.label(name)!r}" for name in FILTER_FIELDS if self.value(name)]
        return ", ".join(parts) if parts else "none"

    def matches(self, occurrence: Occurrence, rule: "Rule", *, ignore_class: bool = False) -> bool:
        if self.klass and not ignore_class and CLASS_KEYS[rule.classification] != self.klass:
            return False
        if self.category and occurrence.category != self.category:
            return False
        if self.model and (occurrence.model or UNKNOWN_MODEL) != self.model:
            return False
        if self.provider and (occurrence.provider or "") != self.provider:
            return False
        if self.tool and (occurrence.tool or "") != self.tool:
            return False
        if self.source and occurrence.source != self.source:
            return False
        if self.q:
            needle = self.q.lower()
            haystacks = (rule.title, occurrence.signature, occurrence.text)
            if not any(needle in (h or "").lower() for h in haystacks):
                return False
        return True
