"""View-models for the retention settings page."""

from src.utils.format import fmt_bytes


def _plan_view(plan) -> dict:
    """View-model for the preview, including a readable size.

    The size is an approximation, see RetentionPlan.message_bytes, and is
    None when the plan was made without measuring it (the page then offers a
    link that does).
    """
    return {
        "task_count": plan.task_count,
        "message_count": plan.message_count,
        "event_count": plan.event_count,
        "exempt_shared": plan.exempt_shared,
        "total_bytes": plan.total_bytes,
        "size": fmt_bytes(plan.total_bytes) if plan.size_measured else None,
        "is_empty": plan.is_empty,
        "reasons": sorted(set(plan.reasons.values())),
    }
