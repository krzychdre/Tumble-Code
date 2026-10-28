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

By default the list is grouped by project (``group``): one collapsible header per
group with its totals, the first few tasks under it, and a link that narrows the
list to that group alone (``only``). A project is the task's project entity
(models/project, ``tasks.project_id``), as on the metrics and projects pages:
every clone and worktree of one repository is one project.
"""

from dataclasses import dataclass, replace
from datetime import date, timedelta
from typing import Callable, Optional
from urllib.parse import quote, urlencode
from zoneinfo import ZoneInfo

from sqlalchemy import and_, exists, func, not_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from src.models.project import Project
from src.models.task import Task
from src.services.client_kind import CLIENT_LABELS, parse_client
from src.services.model_attribution import split_models_label
from src.services.projects import visible_to
from src.services.session_quality import (
    GRADE_CLEAN,
    GRADE_FRICTION,
    GRADE_LABELS,
    GRADE_UNFINISHED,
)
from src.services.task_tree import subtrees
from src.utils.clientzone import UTC, day_start_utc
from src.utils.format import fmt_cost, fmt_duration, fmt_int, fmt_tokens
from src.utils.pagination import paginate
from src.web.presenters.task_rows import _list_row

# Column key -> what the column header says. Only these can be sorted by;
# anything else in ``?sort=`` falls back to the default.
SORT_KEYS = ("updated", "cost", "tokens", "messages")
DEFAULT_SORT = "updated"
DEFAULT_DIR = "desc"
DIRECTIONS = ("asc", "desc")

GRADES = (GRADE_CLEAN, GRADE_FRICTION, GRADE_UNFINISHED)

# The order parameters appear in every URL this module writes, so the same
# view always has the same URL.
_FILTER_FIELDS = (
    "q",
    "project",
    "model",
    "client",
    "grade",
    "since",
    "until",
    "subtasks",
)

_MAX_TEXT = 200

# How many tasks one page of the list shows. The corpus on a working
# deployment runs to hundreds of tasks; rendering all of them was never a
# deliberate choice, just the absence of paging.
PAGE_SIZE = 25

# How many tasks an expanded group shows; the rest are one "Show all" away.
GROUP_ROWS = 5


@dataclass(frozen=True)
class Grouping:
    """One way to group the list: the column that is a task's key."""

    label: str
    unit: str
    # What the group of tasks without a key is called.
    empty: str
    # The key, NULL when the task has none.
    column: object
    # What a group header calls a key the page has no name for.
    name: Callable[[str], str] = str


GROUPINGS = {
    # By id: two projects may share a name. A project the reader cannot see
    # (an organization they left) is named by its bare id.
    "project": Grouping("Project", "project", "No project", Task.project_id),
    # The model that did most of the run's work, the first of its label.
    "model": Grouping("Model", "model", "No model", Task.primary_model),
    # The list holds the reader's own tasks only, so this is one group today.
    "user": Grouping("User", "user", "No user", Task.user_id),
}
DEFAULT_GROUP = "project"
NO_GROUP = "none"
# ``only`` for the group of tasks without a key.
NO_KEY = "(none)"


def _text(value: Optional[str]) -> str:
    return (value or "").strip()[:_MAX_TEXT]


# The days a date filter may name. The filter turns a day into the UTC start
# of the reader's day and of the day after it, which overflows at the ends of
# the calendar: ?until=9999-12-31 raised OverflowError, and, being kept in the
# list's view cookie, failed every visit to /app after it.
_FIRST_DAY = date(1900, 1, 1)
_LAST_DAY = date(9998, 12, 31)


def _day(value: Optional[str]) -> Optional[date]:
    try:
        day = date.fromisoformat((value or "").strip()) if value else None
    except ValueError:
        return None
    if day is not None and not _FIRST_DAY <= day <= _LAST_DAY:
        return None
    return day


@dataclass(frozen=True)
class ListView:
    """One normalized state of the task list."""

    scope: str = "roots"
    # A key of GROUPINGS, or NO_GROUP for the plain list.
    group: str = DEFAULT_GROUP
    # The key of the one group the list is narrowed to ("Show all"), or NO_KEY.
    only: str = ""
    q: str = ""
    # A project id.
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
        group: Optional[str] = None,
        only: Optional[str] = None,
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
        group = group if group in (*GROUPINGS, NO_GROUP) else DEFAULT_GROUP
        return cls(
            scope=scope if scope in ("roots", "all") else "roots",
            group=group,
            only=(only or "") if group != NO_GROUP else "",
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
        if self.group != DEFAULT_GROUP:
            out.append(("group", self.group))
        if self.only:
            out.append(("only", self.only))
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

    def query(self, page: Optional[int] = None) -> str:
        # quote, not quote_plus: a "+" in a search must read back as "+".
        return urlencode(self.params(page), quote_via=quote)

    def url(self, page: Optional[int] = None) -> str:
        return "/app?" + self.query(page)

    def hidden_fields(self, *, keep_filters: bool = True) -> list[tuple[str, str]]:
        """Hidden inputs that make a form submission keep this view."""
        return [
            (k, v) for k, v in self.params() if keep_filters or k not in _FILTER_FIELDS
        ]

    def sort_url(self, key: str) -> str:
        """The header link for ``key``: flips the direction on the active
        column, starts a new one at its most useful end (newest, biggest)."""
        if key == self.sort:
            direction = "asc" if self.dir == "desc" else "desc"
        else:
            direction = "desc"
        # Spelled out even when it is the default, so the header always says
        # which way it will sort.
        base = [
            (k, v)
            for k, v in replace(self, sort=DEFAULT_SORT, dir=DEFAULT_DIR).params()
        ]
        return "/app?" + urlencode(
            base + [("sort", key), ("dir", direction)], quote_via=quote
        )

    def scope_url(self, scope: str) -> str:
        """The same view (search, filters, sort) over the other scope."""
        return replace(self, scope=scope).url()

    def group_url(self, group: str) -> str:
        """The same view grouped another way; a narrowed group does not carry over."""
        return replace(self, group=group, only="").url()

    @property
    def grouped(self) -> bool:
        """Whether the page lists group headers rather than tasks."""
        return self.group != NO_GROUP and not self.only

    def sorted_as(self, key: str) -> Optional[str]:
        """How the column ``key`` is sorted: "ascending", "descending" or None."""
        if key != self.sort:
            return None
        return "ascending" if self.dir == "asc" else "descending"

    @property
    def has_filters(self) -> bool:
        return bool(self.only) or any(self._field(name) for name in _FILTER_FIELDS)

    @property
    def has_panel_filters(self) -> bool:
        """Any filter beyond the search box, so the filter panel opens on them."""
        return any(self._field(name) for name in _FILTER_FIELDS if name != "q")

    def cleared_url(self) -> str:
        """Same scope, grouping and sort, no filters."""
        return replace(
            self,
            only="",
            q="",
            project="",
            model="",
            client="",
            grade="",
            since=None,
            until=None,
            subtasks=False,
        ).url()

    def chips(self, only_label: str = "", project_label: str = "") -> list[dict]:
        """One removable chip per active filter, each linking to this view
        without that one filter. ``only_label`` names the narrowed group,
        ``project_label`` the filtered project."""
        labels = {
            "q": ("Search", self.q),
            "project": ("Project", project_label),
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
        if self.only:
            chips.append(
                {
                    "label": GROUPINGS[self.group].label,
                    "value": only_label,
                    "href": replace(self, only="").url(),
                }
            )
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
                    Task.project_id.in_(
                        select(Project.id).where(
                            visible_to(user_id),
                            Project.name.icontains(self.q, autoescape=True),
                        )
                    ),
                )
            )
        if self.scope == "roots":
            out.append(Task.parent_task_id.is_(None))
        if self.only:
            column = GROUPINGS[self.group].column
            out.append(column.is_(None) if self.only == NO_KEY else column == self.only)
        if self.project:
            out.append(Task.project_id == self.project)
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
            out.append(
                Task.updated_at < day_start_utc(self.until + timedelta(days=1), zone)
            )
        if self.subtasks:
            child = aliased(Task)
            out.append(
                exists().where(
                    child.parent_task_id == Task.id, child.user_id == user_id
                )
            )
        return out

    def order_by(self) -> list:
        """The ORDER BY clauses of this view.

        Cost and tokens sort by what the row shows: a row that delegated shows
        its whole run (itself plus every subtask beneath it, services/
        task_tree.subtree_spend), so the run totals are what the column is
        ordered by.
        """
        key = {
            "updated": Task.updated_at,
            "messages": Task.message_count,
            "cost": Task.run_cost,
            "tokens": Task.run_tokens,
        }[self.sort]
        primary = key.desc() if self.dir == "desc" else key.asc()
        # Ties keep the newest first, then a fixed order, so paging is stable.
        return [primary, Task.updated_at.desc(), Task.id]


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


async def _count(db: AsyncSession, *conditions) -> int:
    # count(*), not count(tasks.id): Postgres answers it from an index alone.
    return await db.scalar(select(func.count()).select_from(Task).where(*conditions))


async def list_page(
    db: AsyncSession,
    view: ListView,
    user_id: str,
    email: str,
    zone: ZoneInfo,
    page: int,
) -> dict:
    """The template context of one page of the list: its rows, the pager and
    the filter suggestions.

    ``page`` is clamped to the real pages, so a typed out-of-range number lands
    on the nearest one.
    """
    filters = view.conditions(user_id, zone)
    projects = await _reader_projects(db, user_id)
    project_names = {p.id: p.name for p in projects}
    # The list holds the reader's own tasks only, so the reader is the one user
    # a group can be named after; any other id in ``only`` stays a bare id.
    names = {
        "project": project_names,
        "user": {user_id: email},
    }.get(view.group, {})
    # Under a project header: the project's key (repository or "folder without git").
    subs = {p.id: p.key_label for p in projects} if view.group == "project" else {}
    shared = dict(
        # Shown on the scope toggle so the cost of switching is visible up front.
        all_total=await _count(db, Task.user_id == user_id),
        only_label=_only_label(view, names),
        project_label=project_names.get(view.project, view.project),
        **await _filter_suggestions(db, view, user_id, projects),
    )
    if view.grouped:
        return {
            **shared,
            **await _group_page(db, view, user_id, names, subs, filters, page),
        }

    total = await _count(db, *filters)
    pager = paginate(total, page, PAGE_SIZE)

    result = await db.execute(
        select(Task)
        .where(*filters)
        .order_by(*view.order_by())
        .limit(PAGE_SIZE)
        .offset(pager["offset"])
    )

    page_tasks = list(result.scalars().all())
    # One query per tree level for the whole page rather than a lookup per row.
    tree = await subtrees(db, [t.id for t in page_tasks], user_id)
    nest = view.scope == "roots"

    return dict(
        shared,
        tasks=[_list_row(task, tree, nest) for task in page_tasks],
        groups=[],
        tree_view=nest,
        **pager,
        total=total,
    )


async def _group_page(
    db: AsyncSession,
    view: ListView,
    user_id: str,
    names: dict,
    subs: dict,
    filters: list,
    page: int,
) -> dict:
    """One page of groups: their totals, and the first GROUP_ROWS tasks of each.

    The totals are one GROUP BY, a row per group however many tasks match.
    Groups are ordered by the sorted column summed over the group (newest
    activity for "updated"), and a group lists its tasks in the view's order.

    The group sums what its rows show. Under "Runs" a run's tokens and cost
    include its subtasks and its duration is the run's elapsed time; under
    "All" every task is a row of its own and the group sums own figures, so no
    subtask is counted twice. Either way the duration is a sum over rows: rows
    that ran at the same time each count in full.
    """
    grouping = GROUPINGS[view.group]
    runs = view.scope == "roots"
    sums = await db.execute(
        select(
            grouping.column.label("key"),
            func.count().label("count"),
            # A row shows its own messages and its run's duration, tokens and cost.
            func.sum(Task.message_count).label("messages"),
            func.sum(Task.run_duration_ms if runs else Task.duration_ms).label(
                "duration_ms"
            ),
            func.sum(
                Task.run_tokens if runs else Task.tokens_in + Task.tokens_out
            ).label("tokens"),
            func.sum(Task.run_cost if runs else Task.cost).label("cost"),
            func.max(Task.updated_at).label("updated"),
        )
        .where(*filters)
        .group_by(grouping.column)
    )
    groups = [row._asdict() for row in sums.all()]

    # The key last: two projects may share a name.
    ordered = sorted(
        groups,
        key=lambda g: (
            _group_label(grouping, g["key"], names).lower(),
            g["key"] or "",
        ),
    )
    ordered.sort(key=lambda g: g[view.sort], reverse=view.dir == "desc")

    pager = paginate(len(ordered), page, PAGE_SIZE)
    shown = ordered[pager["offset"] : pager["offset"] + PAGE_SIZE]

    keys = [g["key"] for g in shown]
    in_shown = grouping.column.in_([key for key in keys if key is not None])
    if None in keys:
        in_shown = or_(in_shown, grouping.column.is_(None))
    ranked = (
        select(
            Task.id,
            grouping.column.label("key"),
            func.row_number()
            .over(partition_by=grouping.column, order_by=view.order_by())
            .label("position"),
        )
        .where(*filters, in_shown)
        .subquery()
    )
    # The rows are loaded by id in a second query: joined to the ranking,
    # Postgres misjudged how few rows pass and scanned every task to join them
    # (240 ms for "All" on the bench).
    first = await db.execute(
        select(ranked.c.id, ranked.c.key)
        .where(ranked.c.position <= GROUP_ROWS)
        .order_by(ranked.c.position)
    )
    rows: dict[Optional[str], list[str]] = {}
    for task_id, key in first.all():
        rows.setdefault(key, []).append(task_id)
    ids = [task_id for group_ids in rows.values() for task_id in group_ids]
    loaded = await db.scalars(select(Task).where(Task.id.in_(ids)))
    tasks = {task.id: task for task in loaded.all()}
    tree = await subtrees(db, ids, user_id)

    return dict(
        tasks=[],
        groups=[
            {
                # What tasklist.js remembers an open group by.
                "key": f"{view.group}:{g['key'] or NO_KEY}",
                "label": _group_label(grouping, g["key"], names),
                "sub": subs.get(g["key"]),
                "count": g["count"],
                "messages": fmt_int(g["messages"]),
                "duration": fmt_duration(g["duration_ms"])
                if g["duration_ms"]
                else None,
                "tokens": fmt_tokens(g["tokens"]) if g["tokens"] else None,
                "cost": fmt_cost(g["cost"]) if g["cost"] > 0 else None,
                "updated": g["updated"],
                # A write between the sums and the ranking can empty a group.
                "rows": [
                    _list_row(tasks[task_id], tree, runs)
                    for task_id in rows.get(g["key"], [])
                ],
                "more_url": replace(view, only=g["key"] or NO_KEY).url()
                if g["count"] > GROUP_ROWS
                else None,
            }
            for g in shown
        ],
        group_count=len(ordered),
        group_unit=grouping.unit,
        tree_view=runs,
        **pager,
        total=sum(g["count"] for g in groups),
    )


def _group_label(grouping: Grouping, key: Optional[str], names: dict) -> str:
    if key is None:
        return grouping.empty
    return names.get(key) or grouping.name(key)


def _only_label(view: ListView, names: dict) -> str:
    """What the chip of the narrowed group says."""
    if not view.only:
        return ""
    key = None if view.only == NO_KEY else view.only
    return _group_label(GROUPINGS[view.group], key, names)


async def _reader_projects(db: AsyncSession, user_id: str) -> list[Project]:
    """The projects of the reader's tasks that the reader may see, by name.

    One query for the whole page: it names the groups, the chips and the
    picker's options. A project of a space the reader is no longer in is not
    among them, so its name never shows.
    """
    result = await db.scalars(
        select(Project)
        .where(
            visible_to(user_id),
            Project.id.in_(select(Task.project_id).where(Task.user_id == user_id)),
        )
        .order_by(func.lower(Project.name), Project.id)
    )
    return list(result.all())


async def _filter_suggestions(
    db: AsyncSession, view: ListView, user_id: str, projects: list[Project]
) -> dict:
    """The options of the filter's pickers, (value, label) pairs: the reader's
    projects by name, and the models of their own tasks.

    A filter value no option has (an old bookmark, a remembered view) is
    offered too, so its picker still shows what the list is filtered by.
    """
    project_options = [(p.id, p.name) for p in projects]
    if view.project and view.project not in {p.id for p in projects}:
        project_options.append((view.project, view.project))
    joined = await db.scalars(
        select(Task.models)
        .where(Task.user_id == user_id, Task.models.is_not(None))
        .distinct()
    )
    models = {m for value in joined.all() for m in split_models_label(value)}
    if view.model:
        models.add(view.model)
    return {
        "project_options": project_options,
        "model_options": [(m, m) for m in sorted(models, key=str.lower)],
    }
