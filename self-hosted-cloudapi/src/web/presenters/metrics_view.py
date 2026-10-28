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

from sqlalchemy import case, func

from src.models.event import UsageRollup
from src.models.project import Project
from src.models.task import Task
from src.models.user import User
from src.services.metrics_service import GroupBy
from src.web.presenters.task_list import NO_GROUP, NO_KEY

# How many groups the table shows before "Show all".
GROUP_ROWS = 8


@dataclass(frozen=True)
class Grouping:
    """One way to group the page: an event's group, and the runs of a group."""

    label: str
    # What the group of events without a key is called.
    empty: str
    # SQL over the tables of the completions query (services/metrics_service):
    # an event's key, NULL when it has none, and the name of its group.
    key: object
    name: object
    # The tasks column a missing key is NULL in, and SQL that keeps the tasks
    # of one key: what narrows the session-quality panel.
    column: object
    match: Callable[[str], object]
    # Whether the key is the event's task's, so each task is in one group.
    per_task: bool
    # Offered in an organization space only: the reader's own page has one user.
    organization_only: bool = False

    @property
    def events(self) -> GroupBy:
        """An event's group in SQL: NO_KEY and ``empty`` for an event
        without a key."""
        return GroupBy(
            func.coalesce(self.key, NO_KEY),
            case((self.key.is_(None), self.empty), else_=self.name),
            self.per_task,
        )


# Who ran the event, by name, else by e-mail.
_USER_NAME = func.coalesce(
    func.nullif(
        func.trim(
            func.coalesce(User.first_name, "") + " " + func.coalesce(User.last_name, "")
        ),
        "",
    ),
    User.email,
)

GROUPINGS = {
    # The project of the event's task (models/project), by id: two projects
    # may share a name. One the reader may not see is named by its bare id.
    "project": Grouping(
        "Project",
        "No project",
        Task.project_id,
        func.coalesce(Project.name, Task.project_id),
        Task.project_id,
        lambda key: Task.project_id == key,
        per_task=True,
    ),
    # The event's own model. A run's quality counts under its main model.
    "model": Grouping(
        "Model",
        "No model",
        UsageRollup.model_id,
        UsageRollup.model_id,
        Task.primary_model,
        lambda key: Task.primary_model == key,
        per_task=False,
    ),
    # Who ran the event: the task's owner. Every event has one.
    "user": Grouping(
        "User",
        "No user",
        UsageRollup.user_id,
        _USER_NAME,
        Task.user_id,
        lambda key: Task.user_id == key,
        per_task=True,
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

    def events_condition(self):
        """What keeps the events of the narrowed group, or None. On the key
        column itself, not on ``events``' coalesced key, so an index on it
        (usage_rollup's primary key leads with the user) can find them."""
        if not self.only:
            return None
        if self.only == NO_KEY:
            return self.grouping.key.is_(None)
        return self.grouping.key == self.only

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
