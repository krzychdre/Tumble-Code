"""Storing the extension's error reports (POST /api/error-reports).

A report is written once. The extension generates its id and retries an
upload that did not get an answer, so the same report can arrive twice, or
twice at the same moment; the insert is ``ON CONFLICT (id) DO NOTHING`` and
the second copy is simply not stored (the pattern of share_service and
telemetry_service._get_or_create_task). A report never updates an earlier
one: there is nothing in a retry the first copy did not have.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import dialect_insert
from src.models.error_report import ErrorReport
from src.schemas.error_report import ErrorReportRequest
from src.services.client_kind import client_kind_from
from src.services.problem_catalogue import problem_signature

# Longest value stored in a plain column (provider, model, mode, version,
# tool, task id). The payload keeps the value as sent.
COLUMN_MAX = 200


def _short(value: Optional[str]) -> Optional[str]:
    if not isinstance(value, str) or not value.strip():
        return None
    return value.strip()[:COLUMN_MAX]


def report_row(user_id: str, org_id: Optional[str], report: ErrorReportRequest) -> dict:
    """The ``error_reports`` row of one validated report, as insert values."""
    tool = _short(report.tool_name)
    # The summary is what the extension chose to say in one line; the error
    # message is the fallback for a report that left the summary empty.
    headline_source = report.summary if report.summary.strip() else (report.error_message or "")
    return {
        "id": report.id,
        "user_id": user_id,
        "organization_id": org_id,
        "task_id": _short(report.task_id),
        "category": report.category,
        "provider": _short(report.provider),
        "model_id": _short(report.model_id),
        "mode": _short(report.mode),
        "app_version": _short(report.app_version),
        "client_kind": client_kind_from({"clientKind": report.client_kind, "editorName": report.editor_name}),
        "tool_name": tool,
        "summary": report.summary,
        "signature": problem_signature(report.category, tool, headline_source),
        "occurred_at": datetime.fromtimestamp(report.occurred_at / 1000.0, tz=timezone.utc),
        "created_at": datetime.now(timezone.utc),
        # Exactly what was validated, in the wire's camelCase: unknown fields
        # are already gone, absent ones are not written as null.
        "payload": report.model_dump_json(by_alias=True, exclude_none=True),
    }


async def record_error_report(
    db: AsyncSession, user_id: str, org_id: Optional[str], report: ErrorReportRequest
) -> bool:
    """Store ``report`` for ``user_id``. True when this call inserted it.

    A report whose id is already stored (a retried upload, whoever sent it) is
    left alone and False comes back.
    """
    values = report_row(user_id, org_id, report)
    upsert_insert = dialect_insert(db)
    if upsert_insert is None:
        # No portable ON CONFLICT: look first, then insert.
        exists = await db.scalar(select(ErrorReport.id).where(ErrorReport.id == report.id))
        if exists is not None:
            return False
        db.add(ErrorReport(**values))
        await db.flush()
        return True

    result = await db.execute(
        upsert_insert(ErrorReport).values(**values).on_conflict_do_nothing(index_elements=["id"])
    )
    return result.rowcount == 1
