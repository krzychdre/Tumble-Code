"""The metrics page's view state: space, period, client, grouping, and the URLs that carry them.

The page shows the reader's own usage, or (``space``) the usage of an
organization they administer, from every member. Like the task list
(web/presenters/task_list.py), it can be summed per project (the default), per
model or, in an organization, per user (``group``), and narrowed to one group
(``only``): then every figure on the page is that group's. Every link of the
page is built by ``MetricsView.url``, so none of them drops a choice the reader
made.
"""

from dataclasses import dataclass, replace
from typing import Callable, Optional
from urllib.parse import quote, urlencode

from sqlalchemy import Row

from src.models.task import Task
from src.web.presenters.task_list import GROUPINGS as TASK_GROUPINGS
from src.web.presenters.task_list import NO_GROUP, NO_KEY

# How many groups the table shows before "Show all".
GROUP_ROWS = 8


@dataclass(frozen=True)
class Grouping:
    """One way to group the page: an event's group, and the runs of a group."""

    label: str
    # What the group of events without a key is called.
    empty: str
    # (key, name) of an event from its row of the completions query
    # (services/metrics_service); key None when it has none.
    of_event: Callable[[Row], tuple[Optional[str], Optional[str]]]
    # The tasks column a missing key is NULL in, and SQL that keeps the tasks
    # of one key: what narrows the session-quality panel.
    column: object
    match: Callable[[str], object]
    # Offered in an organization space only: the reader's own page has one user.
    organization_only: bool = False

    def event_key(self, row: Row) -> tuple[str, str]:
        key, name = self.of_event(row)
        return (NO_KEY, self.empty) if key is None else (key, name)


def _event_user(row):
    """Who ran the event, by name, else by e-mail."""
    name = f"{row.first_name or ''} {row.last_name or ''}".strip()
    return row.user_id, name or row.email


GROUPINGS = {
    # The project of the event's task (models/project), by id: two projects
    # may share a name. One the reader may not see is named by its bare id.
    "project": Grouping(
        "Project",
        "No project",
        lambda row: (row.project_id, row.project_name or row.project_id),
        Task.project_id,
        lambda key: Task.project_id == key,
    ),
    # The event's own model. A run's quality counts under its main model.
    "model": Grouping(
        "Model",
        "No model",
        lambda row: (row.model_id, row.model_id),
        TASK_GROUPINGS["model"].column,
        TASK_GROUPINGS["model"].match,
    ),
    # Who ran the event: the task's owner. Every event has one.
    "user": Grouping(
        "User",
        "No user",
        _event_user,
        Task.user_id,
        lambda key: Task.user_id == key,
        organization_only=True,
    ),
}
DEFAULT_GROUP = "project"


def group_options(in_organization: bool) -> list[tuple[str, str]]:
    """The "Group" selector's (key, label) pairs in the reader's space or an
    organization's."""
    return [
        (key, g.label)
        for key, g in GROUPINGS.items()
        if in_organization or not g.organization_only
    ] + [(NO_GROUP, "None")]


@dataclass(frozen=True)
class MetricsView:
    # The id of the organization whose usage the page shows, "" for the
    # reader's own.
    space: str
    period: str
    # "vscode" or "cli" (services/client_kind), None for both.
    client: Optional[str]
    # A key of GROUPINGS, or NO_GROUP.
    group: str
    # The key of the one group the page is narrowed to, or NO_KEY; "" when
    # the page is not narrowed.
    only: str

    @property
    def grouping(self) -> Optional[Grouping]:
        return GROUPINGS.get(self.group)

    @property
    def grouped(self) -> bool:
        """Whether the page shows the table of groups."""
        return self.grouping is not None and not self.only

    def url(self, **changes) -> str:
        """This view's URL with ``changes`` applied. The period and the group
        are always spelled out: a URL without them opens on the remembered
        ones."""
        view = replace(self, **changes)
        params = [("period", view.period)]
        if view.space:
            params.append(("space", view.space))
        if view.client:
            params.append(("client", view.client))
        params.append(("group", view.group))
        if view.only:
            params.append(("only", view.only))
        return "/app/metrics?" + urlencode(params, quote_via=quote)

    def group_url(self, group: str) -> str:
        """The same view grouped another way; a narrowed group does not carry over."""
        return self.url(group=group, only="")

    def space_url(self, space: str) -> str:
        """The same view of another space; a narrowed group does not carry over."""
        return self.url(space=space, only="")

    def tasks_condition(self):
        """What keeps the runs of the narrowed group, or None."""
        if not self.only:
            return None
        if self.only == NO_KEY:
            return self.grouping.column.is_(None)
        return self.grouping.match(self.only)

    def only_label(self, groups: list[dict]) -> str:
        """What the chip of the narrowed group says. A group with no usage in
        the period is named by its key."""
        if groups:
            return groups[0]["name"]
        return self.grouping.empty if self.only == NO_KEY else self.only
