"""The problem report's links: period, filters and sort carried in every URL.

Every state of /app/diagnostics is a plain GET URL
(``/app/diagnostics?period=&class=&model=...&sort=``), so it works without
scripting, survives a reload and can be shared. The period tabs, the class
tiles, the sort control, the filter chips and both brief links build their
URLs here from one ``ProblemFilter`` (services/diagnostics_service), so none of
them silently drops a filter the reader is looking at.
"""

from dataclasses import dataclass, replace
from typing import Optional
from urllib.parse import quote, urlencode

from src.services.diagnostics_service import (
    FILTER_FIELDS,
    FILTER_LABELS,
    SORT_IMPACT,
    SORT_LABELS,
    ProblemFilter,
)
from src.services.metrics_service import PERIOD_LABELS

PAGE = "/app/diagnostics"


@dataclass(frozen=True)
class ProblemView:
    """URLs for one state of the problem report."""

    filters: ProblemFilter

    def params(self, filters: Optional[ProblemFilter] = None, *, sort: bool = True) -> list[tuple[str, str]]:
        """The non-empty parameters in a fixed order; the period always leads."""
        f = filters or self.filters
        out = [("period", f.period)]
        out += [(name, f.value(name)) for name in FILTER_FIELDS if f.value(name)]
        if sort and f.sort != SORT_IMPACT:
            out.append(("sort", f.sort))
        return out

    def url(self, filters: Optional[ProblemFilter] = None, path: str = PAGE, *, sort: bool = True) -> str:
        # quote, not quote_plus: a "+" in a search must read back as "+".
        return path + "?" + urlencode(self.params(filters, sort=sort), quote_via=quote)

    def periods(self) -> list[dict]:
        """The period tabs, each keeping the filters and the sort."""
        return [
            {"key": key, "label": label, "active": key == self.filters.period,
             "href": self.url(replace(self.filters, period=key))}
            for key, label in PERIOD_LABELS.items()
        ]

    def class_url(self, key: str) -> str:
        """A class tile's link: filter to that class, or drop it when it is the one shown."""
        klass = "" if self.filters.klass == key else key
        return self.url(replace(self.filters, klass=klass))

    def sorts(self) -> list[dict]:
        return [
            {"key": key, "label": label, "active": key == self.filters.sort,
             "href": self.url(replace(self.filters, sort=key))}
            for key, label in SORT_LABELS.items()
        ]

    def chips(self) -> list[dict]:
        """One removable chip per active filter, each linking to this view without it."""
        return [
            {"label": FILTER_LABELS[name], "value": self.filters.label(name), "href": self.url(self.filters.without(name))}
            for name in FILTER_FIELDS
            if self.filters.value(name)
        ]

    def cleared_url(self) -> str:
        """Same period and sort, no filters."""
        return self.url(self.filters.without(*FILTER_FIELDS))

    def hidden_fields(self) -> list[tuple[str, str]]:
        """What the filter form must carry besides its own fields."""
        out = [("period", self.filters.period)]
        if self.filters.sort != SORT_IMPACT:
            out.append(("sort", self.filters.sort))
        return out

    def report_url(self) -> str:
        """The brief of every group the filters let through."""
        return self.url(path=f"{PAGE}/report.md", sort=True)

    def brief_url(self, key: str) -> str:
        """One group's brief, read with the same period and filters as the page."""
        return self.url(path=f"{PAGE}/problems/{key}/brief.md", sort=False)
