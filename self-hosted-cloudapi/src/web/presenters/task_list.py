"""The task list's view state: sort, filters and the URLs that carry them.

Every state of the list is a plain GET URL (``/app?scope=&q=&project=...``), so
it works without scripting, survives a reload and can be bookmarked. This
module is the one place that reads those parameters, turns them into SQL, and
writes them back into links: the pager, the column headers, the filter chips
and the redirect after a bulk delete all build their URLs here, so none of
them can silently drop a filter the reader is looking at.

Nothing a request says reaches the query unchecked: the sort key and the
direction are looked up in an allow-list, dates must parse, the grade must be
one of the three, the client one of the two, and free text is matched with LIKE wildcards escaped.
"""

from dataclasses import dataclass, replace
from datetime import date, timedelta
from typing import Optional
from urllib.parse import quote, urlencode
from zoneinfo import ZoneInfo

from sqlalchemy import and_, exists, func, literal, not_, or_, select
from sqlalchemy.orm import aliased

from src.models.task import Task
from src.services.client_kind import CLIENT_LABELS, parse_client
from src.services.session_quality import GRADE_CLEAN, GRADE_FRICTION, GRADE_LABELS, GRADE_UNFINISHED
from src.utils.clientzone import UTC, day_start_utc

# Column key -> what the column header says. Only these can be sorted by;
# anything else in ``?sort=`` falls back to the default.
SORT_KEYS = ("updated", "cost", "tokens", "messages")
DEFAULT_SORT = "updated"
DEFAULT_DIR = "desc"
DIRECTIONS = ("asc", "desc")

GRADES = (GRADE_CLEAN, GRADE_FRICTION, GRADE_UNFINISHED)

# The order parameters appear in every URL this module writes, so the same
# view always has the same URL.
_FILTER_FIELDS = ("q", "project", "model", "client", "grade", "since", "until", "subtasks")

_MAX_TEXT = 200


def _text(value: Optional[str]) -> str:
    return (value or "").strip()[:_MAX_TEXT]


def _day(value: Optional[str]) -> Optional[date]:
    try:
        return date.fromisoformat((value or "").strip()) if value else None
    except ValueError:
        return None


@dataclass(frozen=True)
class ListView:
    """One normalized state of the task list."""

    scope: str = "roots"
    q: str = ""
    project: str = ""
    model: str = ""
    # "vscode" or "cli" (services/client_kind), "" for both.
    client: str = ""
    grade: str = ""
    since: Optional[date] = None
    until: Optional[date] = None
    subtasks: bool = False
    sort: str = DEFAULT_SORT
    dir: str = DEFAULT_DIR

    @classmethod
    def parse(
        cls,
        *,
        scope: Optional[str] = None,
        q: Optional[str] = None,
        project: Optional[str] = None,
        model: Optional[str] = None,
        client: Optional[str] = None,
        grade: Optional[str] = None,
        since: Optional[str] = None,
        until: Optional[str] = None,
        subtasks: Optional[str] = None,
        sort: Optional[str] = None,
        dir: Optional[str] = None,
    ) -> "ListView":
        """Read request parameters; anything unusable is dropped, never an error.

        A stale bookmark or a hand-edited URL should land on a sensible list,
        not on a 422 in place of the page.
        """
        return cls(
            scope=scope if scope in ("roots", "all") else "roots",
            q=_text(q),
            project=_text(project),
            model=_text(model),
            client=parse_client(client) or "",
            grade=grade if grade in GRADES else "",
            since=_day(since),
            until=_day(until),
            subtasks=subtasks == "1",
            sort=sort if sort in SORT_KEYS else DEFAULT_SORT,
            dir=dir if dir in DIRECTIONS else DEFAULT_DIR,
        )

    # --- what the URL carries -------------------------------------------------

    def params(self, page: Optional[int] = None) -> list[tuple[str, str]]:
        """The non-default parameters, in a fixed order. Scope always leads."""
        out: list[tuple[str, str]] = [("scope", self.scope)]
        if page is not None:
            out.append(("page", str(page)))
        for name in _FILTER_FIELDS:
            value = self._field(name)
            if value:
                out.append((name, value))
        if (self.sort, self.dir) != (DEFAULT_SORT, DEFAULT_DIR):
            out += [("sort", self.sort), ("dir", self.dir)]
        return out

    def _field(self, name: str) -> str:
        value = getattr(self, name)
        if isinstance(value, bool):
            return "1" if value else ""
        if isinstance(value, date):
            return value.isoformat()
        return value or ""

    def url(self, page: Optional[int] = None) -> str:
        # quote, not quote_plus: a "+" in a search must read back as "+".
        return "/app?" + urlencode(self.params(page), quote_via=quote)

    def hidden_fields(self, *, keep_filters: bool = True) -> list[tuple[str, str]]:
        """Hidden inputs that make a form submission keep this view."""
        return [(k, v) for k, v in self.params() if keep_filters or k not in _FILTER_FIELDS]

    def sort_url(self, key: str) -> str:
        """The header link for ``key``: flips the direction on the active
        column, starts a new one at its most useful end (newest, biggest)."""
        if key == self.sort:
            direction = "asc" if self.dir == "desc" else "desc"
        else:
            direction = "desc"
        # Spelled out even when it is the default, so the header always says
        # which way it will sort.
        base = [(k, v) for k, v in replace(self, sort=DEFAULT_SORT, dir=DEFAULT_DIR).params()]
        return "/app?" + urlencode(base + [("sort", key), ("dir", direction)], quote_via=quote)

    def scope_url(self, scope: str) -> str:
        """The same view (search, filters, sort) over the other scope."""
        return replace(self, scope=scope).url()

    def sorted_as(self, key: str) -> Optional[str]:
        """How the column ``key`` is sorted: "ascending", "descending" or None."""
        if key != self.sort:
            return None
        return "ascending" if self.dir == "asc" else "descending"

    @property
    def has_filters(self) -> bool:
        return any(self._field(name) for name in _FILTER_FIELDS)

    @property
    def has_panel_filters(self) -> bool:
        """Any filter beyond the search box, so the filter panel opens on them."""
        return any(self._field(name) for name in _FILTER_FIELDS if name != "q")

    def cleared_url(self) -> str:
        """Same scope and sort, no filters."""
        return replace(
            self, q="", project="", model="", client="", grade="", since=None, until=None, subtasks=False
        ).url()

    def chips(self) -> list[dict]:
        """One removable chip per active filter, each linking to this view
        without that one filter."""
        labels = {
            "q": ("Search", self.q),
            "project": ("Project", self.project),
            "model": ("Model", self.model),
            "client": ("Client", CLIENT_LABELS.get(self.client, "")),
            "grade": ("Grade", GRADE_LABELS.get(self.grade, "")),
            "since": ("From", self._field("since")),
            "until": ("To", self._field("until")),
            "subtasks": ("Has subtasks", ""),
        }
        empty = {
            "q": "",
            "project": "",
            "model": "",
            "client": "",
            "grade": "",
            "since": None,
            "until": None,
            "subtasks": False,
        }
        chips = []
        for name in _FILTER_FIELDS:
            if not self._field(name):
                continue
            label, value = labels[name]
            chips.append(
                {
                    "label": label,
                    "value": value,
                    "href": replace(self, **{name: empty[name]}).url(),
                }
            )
        return chips

    # --- what the query does --------------------------------------------------

    def conditions(self, user_id: str, zone: ZoneInfo = UTC) -> list:
        """WHERE clauses for this view, the user's own tasks only."""
        out = [Task.user_id == user_id]
        if self.q:
            # autoescape: "%" and "_" typed into the box mean those characters,
            # not LIKE wildcards (SQLAlchemy escapes them, and its escape char).
            out.append(
                or_(
                    Task.title.icontains(self.q, autoescape=True),
                    Task.workspace_path.icontains(self.q, autoescape=True),
                )
            )
        if self.scope == "roots":
            out.append(Task.parent_task_id.is_(None))
        if self.project:
            out.append(Task.workspace_path.icontains(self.project, autoescape=True))
        if self.model:
            out.append(Task.models.icontains(self.model, autoescape=True))
        if self.client:
            out.append(Task.client_kind == self.client)
        if self.grade:
            out.append(_grade_condition(self.grade))
        # The dates are the reader's calendar days (``zone``, utils/clientzone).
        if self.since:
            out.append(Task.updated_at >= day_start_utc(self.since, zone))
        if self.until:
            # Inclusive: "to 30 May" keeps everything on the 30th.
            out.append(Task.updated_at < day_start_utc(self.until + timedelta(days=1), zone))
        if self.subtasks:
            child = aliased(Task)
            out.append(
                exists().where(child.parent_task_id == Task.id, child.user_id == user_id)
            )
        return out

    def order_by(self, user_id: str):
        """(ORDER BY clauses, an outer join to apply first or None).

        Cost and tokens sort by what the row shows: a row that delegated shows
        its whole run (itself plus every subtask beneath it, services/
        task_tree.subtree_spend), so that sum is what the column is ordered by.
        """
        descending = self.dir == "desc"
        rollup = None
        if self.sort == "updated":
            key = Task.updated_at
        elif self.sort == "messages":
            key = Task.message_count
        else:
            rollup = _run_totals(user_id)
            column = rollup.c.cost if self.sort == "cost" else rollup.c.tokens
            key = func.coalesce(column, 0)
        primary = key.desc() if descending else key.asc()
        # Ties keep the newest first, then a fixed order, so paging is stable.
        return [primary, Task.updated_at.desc(), Task.id], rollup


def _grade_condition(grade: str):
    """The grade rule of services/session_quality.Quality.grade, as SQL."""
    repeated = Task.q_tool_paths > Task.q_distinct_tool_paths
    smooth = and_(
        Task.q_errors == 0,
        Task.q_retries == 0,
        Task.q_interventions == 0,
        Task.q_condense == 0,
        not_(repeated),
    )
    completed = Task.q_completed.is_(True)
    if grade == GRADE_UNFINISHED:
        return not_(completed)
    if grade == GRADE_CLEAN:
        return and_(completed, smooth)
    return and_(completed, not_(smooth))


def _run_totals(user_id: str):
    """Cost and tokens of every task of the user plus everything beneath it.

    A recursive CTE of (run, member) pairs, with UNION rather than UNION ALL:
    duplicates are discarded, so a cycle in the client-supplied parent links
    ends the recursion instead of looping, and every member is counted once
    per run. Runs on SQLite and Postgres alike. Only built when the list is
    sorted by cost or tokens.
    """
    members = (
        select(Task.id.label("run_id"), Task.id.label("member_id"))
        .where(Task.user_id == user_id)
        .cte("run_members", recursive=True)
    )
    child = aliased(Task)
    members = members.union(
        select(members.c.run_id, child.id).join(
            members, and_(child.parent_task_id == members.c.member_id, child.user_id == literal(user_id))
        )
    )
    member = aliased(Task)
    return (
        select(
            members.c.run_id,
            func.sum(member.cost).label("cost"),
            func.sum(member.tokens_in + member.tokens_out).label("tokens"),
        )
        .join(member, member.id == members.c.member_id)
        .group_by(members.c.run_id)
        .subquery("run_totals")
    )
