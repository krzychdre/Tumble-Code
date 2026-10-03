"""What every stage of the problem report works on: one ``Occurrence`` per
problem, from whichever source recorded it, plus the source constants, the
shared timestamp and property helpers and the period constants.

Kept in one leaf module so the stages import it without cycles: collection,
filters, grouping and views all speak ``Occurrence``.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Iterable, Optional, Sequence

from src.services.problem_catalogue import (
    CONFIGURATION,
    MODEL,
    PROVIDER,
    SOFTWARE,
    UNCLASSIFIED,
    problem_signature,
)

SOURCE_REPORT = "report"
SOURCE_CONVERSATION = "conversation"
SOURCE_TELEMETRY = "telemetry"

SOURCE_LABELS = {
    SOURCE_REPORT: "error report",
    SOURCE_CONVERSATION: "synced conversation",
    SOURCE_TELEMETRY: "telemetry event",
}

# The category each error event stands for. Events the extension sends
# without a message are still a category the catalogue knows.
TELEMETRY_CATEGORIES: dict[str, str] = {
    "Exception": "exception",
    "Code Index Error": "code_index",
    "Diff Application Error": "diff_error",
    "Consecutive Mistake Error": "mistake_limit",
    "Schema Validation Error": "settings_invalid",
    "Shell Integration Error": "shell_integration",
    "Model Cache Empty Response": "model_list_empty",
}

# Where an error event says it happened and what it said, tried in order.
WHERE_KEYS = ("location", "schemaName", "operation", "context")
MESSAGE_KEYS = ("errorMessage", "error")

# Problems that are not about the chat model: an embedder or Qdrant failing,
# the terminal, a settings file, the model list. They stay on the problem list
# but are left out of the model fit table, where they would read as the chat
# model's fault (1743 code-index errors against "openai (unknown)" on the live
# deployment).
NOT_MODEL_CATEGORIES = frozenset({"code_index", "shell_integration", "settings_invalid", "model_list_empty"})

UNKNOWN_MODEL = "(unknown)"
MAX_GROUPS = 60
# Distinct occurrences a group keeps as evidence for the agent brief.
MAX_SAMPLES = 3
# Report ids listed under a group, newest first.
MAX_GROUP_REPORTS = 5
# The longest legacy message kept for a group's sample.
SAMPLE_TEXT_MAX = 4000
# SQLite caps the parameters of one statement; IN lists are sent in chunks.
IN_CHUNK = 500

# The classes in the order the page lists their totals.
CLASS_ORDER = (SOFTWARE, MODEL, PROVIDER, CONFIGURATION, UNCLASSIFIED)


@dataclass
class Occurrence:
    """One problem, from whichever source recorded it."""

    source: str
    category: str
    tool: Optional[str]
    # What the catalogue matches and the signature is cut from: the report's
    # summary, the message's text, the event's message.
    text: str
    when: datetime
    task_id: Optional[str] = None
    model: Optional[str] = None
    provider: Optional[str] = None
    mode: Optional[str] = None
    report_id: Optional[str] = None
    signature: str = field(default="")
    # The stored message's ts (conversation source): where the brief finds
    # the messages before it.
    ts: Optional[int] = None
    app_version: Optional[str] = None

    def __post_init__(self) -> None:
        if not self.signature:
            self.signature = problem_signature(self.category, self.tool, self.text)


def utc(stamp: datetime) -> datetime:
    # SQLite hands timestamps back naive; they are stored in UTC.
    return stamp if stamp.tzinfo else stamp.replace(tzinfo=timezone.utc)


def fmt_when(stamp: datetime) -> str:
    return utc(stamp).strftime("%Y-%m-%d %H:%M")


def prop_text(props: dict, keys: Sequence[str]) -> str:
    for key in keys:
        value = props.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def chunks(items: list, size: int = IN_CHUNK) -> Iterable[list]:
    for start in range(0, len(items), size):
        yield items[start:start + size]
