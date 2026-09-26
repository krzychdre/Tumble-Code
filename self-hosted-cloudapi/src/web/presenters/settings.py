"""View-models for the retention settings page."""

from src.utils.format import fmt_bytes


def _plan_view(plan) -> dict:
    """View-model for the preview, including a readable size.

    The size is an approximation, see RetentionPlan.message_bytes.
    """
    return {
        "task_count": plan.task_count,
        "message_count": plan.message_count,
        "event_count": plan.event_count,
        "exempt_shared": plan.exempt_shared,
        "total_bytes": plan.total_bytes,
        "size": fmt_bytes(plan.total_bytes),
        "is_empty": plan.is_empty,
        "reasons": sorted(set(plan.reasons.values())),
    }
