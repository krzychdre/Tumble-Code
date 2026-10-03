"""Re-export of ``services/problems`` under the module name the routes,
presenters, brief and tests import (kept by the R3-9 split so those sites
stay untouched).

The implementation lives in the package: collect (``problems/collect``),
filters (``problems/filters``), grouping (``problems/aggregate``), views
(``problems/views``) and the period entry point (``problems/service``);
``problems/base`` holds the ``Occurrence`` shape and the shared helpers.
"""

from src.services.problems.aggregate import (
    aggregate_problems,
    group_occurrences,
    model_fit,
    rules_by_signature,
)
from src.services.problems.base import (
    MAX_GROUP_REPORTS,
    MAX_GROUPS,
    MAX_SAMPLES,
    NOT_MODEL_CATEGORIES,
    SAMPLE_TEXT_MAX,
    SOURCE_CONVERSATION,
    SOURCE_LABELS,
    SOURCE_REPORT,
    SOURCE_TELEMETRY,
    TELEMETRY_CATEGORIES,
    UNKNOWN_MODEL,
    Occurrence,
    chunks as _chunks,
    fmt_when as _fmt_when,
    utc as _utc,
)
from src.services.problems.collect import (
    collect_occurrences,
    conversation_category,
    conversation_occurrences,
    first_report_at,
    telemetry_occurrence,
)
from src.services.problems.filters import (
    FILTER_FIELDS,
    FILTER_LABELS,
    SORT_COUNT,
    SORT_IMPACT,
    SORT_LABELS,
    SORT_RECENT,
    ProblemFilter,
)
from src.services.problems.service import compute_user_problems, load_report
from src.services.problems.views import group_key, pick_samples, report_view

__all__ = [
    "FILTER_FIELDS",
    "FILTER_LABELS",
    "MAX_GROUP_REPORTS",
    "MAX_GROUPS",
    "MAX_SAMPLES",
    "NOT_MODEL_CATEGORIES",
    "Occurrence",
    "ProblemFilter",
    "SAMPLE_TEXT_MAX",
    "SORT_COUNT",
    "SORT_IMPACT",
    "SORT_LABELS",
    "SORT_RECENT",
    "SOURCE_CONVERSATION",
    "SOURCE_LABELS",
    "SOURCE_REPORT",
    "SOURCE_TELEMETRY",
    "TELEMETRY_CATEGORIES",
    "UNKNOWN_MODEL",
    "_chunks",
    "_fmt_when",
    "_utc",
    "aggregate_problems",
    "collect_occurrences",
    "compute_user_problems",
    "conversation_category",
    "conversation_occurrences",
    "first_report_at",
    "group_key",
    "group_occurrences",
    "load_report",
    "model_fit",
    "pick_samples",
    "report_view",
    "rules_by_signature",
    "telemetry_occurrence",
]
