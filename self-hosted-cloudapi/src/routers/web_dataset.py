"""The dataset page (/app/dataset): the recording switch, what is recorded, the export.

- GET  /app/dataset                         the page (period selector, counts, export form)
- POST /app/dataset/settings                the recording switch and the anonymization terms
- GET  /app/dataset/export.jsonl            the training dataset (streamed)
- GET  /app/dataset/audit                   what the same export would anonymize, and how many samples
- GET  /app/dataset/tasks/{task_id}.jsonl   one task's exchanges fully reconstructed, NOT anonymized
- POST /app/dataset/delete                  delete every recording

Owner only, like every /app page. See ai_plans/2026-10-02_llm-exchange-dataset.md.
"""

import json
from datetime import datetime, timezone

import anyio
from fastapi import APIRouter, Depends, Request
from fastapi.responses import HTMLResponse, RedirectResponse, StreamingResponse

from config.settings import settings
from src.routers.web_page import (
    WebPage,
    not_found_page,
    render_page,
    require_web_page,
)
from src.services.dataset_export import (
    ExportOptions,
    build_anonymizer,
    export_lines,
    task_ids,
    task_samples,
)
from src.services.dataset_overview import dataset_overview, delete_recordings
from src.services.exchange_ingest import read_dataset_settings, save_dataset_settings
from src.services.exchange_quality import DROP_DEFAULT, DROP_STRICT, ISSUE_LABELS
from src.services.exchange_reconstruction import load_task
from src.services.metrics_service import PERIOD_LABELS, PERIODS, period_start

router = APIRouter(tags=["web"])

DEFAULT_DATASET_PERIOD = "all"
# The audit stops after this many samples: it is a check, not the export.
AUDIT_SAMPLE_LIMIT = 2000


def _period(value: str) -> str:
    return value if value in PERIODS else DEFAULT_DATASET_PERIOD


@router.get("/app/dataset", response_class=HTMLResponse)
async def dataset_page(
    request: Request,
    period: str = DEFAULT_DATASET_PERIOD,
    deleted: str = "",
    web: WebPage = Depends(require_web_page),
):
    """Recording switch, counts per model and issue, the export form and recent tasks."""
    db = web["db"]
    period = _period(period)
    overview = await dataset_overview(db, web["user"]["user_id"], period)
    settings_row = await read_dataset_settings(db, web["user"]["user_id"])
    return render_page(
        request,
        web,
        "dataset.html",
        "dataset",
        overview=overview,
        periods=[
            {"key": key, "label": label, "active": key == period}
            for key, label in PERIOD_LABELS.items()
        ],
        recording=bool(settings_row and settings_row.recording_enabled),
        terms=(settings_row.anonymize_terms or "") if settings_row else "",
        telemetry_enabled=settings.telemetry_enabled,
        drop_default=sorted(ISSUE_LABELS[i] for i in DROP_DEFAULT),
        drop_strict_extra=sorted(ISSUE_LABELS[i] for i in DROP_STRICT - DROP_DEFAULT),
        deleted=deleted,
    )


@router.post("/app/dataset/settings")
async def save_dataset_settings_endpoint(
    request: Request,
    web: WebPage = Depends(require_web_page),
):
    """Save the recording switch and the term list. Recording starts within 5 minutes."""
    form = await request.form()
    lines = [line.strip() for line in str(form.get("terms") or "").splitlines()]
    terms = "\n".join(line for line in lines if line)[:20_000] or None
    await save_dataset_settings(
        web["db"],
        web["user"]["user_id"],
        recording=form.get("recording") == "1",
        terms=terms,
    )
    await web["db"].commit()
    return RedirectResponse(url="/app/dataset", status_code=303)


@router.get("/app/dataset/export.jsonl")
async def dataset_export(
    request: Request,
    web: WebPage = Depends(require_web_page),
):
    """The dataset as JSONL, streamed task by task."""
    options = ExportOptions.from_query(request.query_params)
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    name = f"tumble-dataset-{options.format}-{options.period}-{stamp}.jsonl"
    return StreamingResponse(
        export_lines(web["db"], web["user"]["user_id"], options),
        media_type="application/x-ndjson; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{name}"'},
    )


@router.get("/app/dataset/audit", response_class=HTMLResponse)
async def dataset_audit(
    request: Request,
    web: WebPage = Depends(require_web_page),
):
    """Runs the export with the same options without writing it, and lists every replacement."""
    db = web["db"]
    user_id = web["user"]["user_id"]
    options = ExportOptions.from_query(request.query_params)
    options.anonymize = True
    anonymizer = await build_anonymizer(db, user_id)
    since = period_start(options.period)
    samples = 0
    tasks = 0
    truncated = False
    for task_id in await task_ids(db, user_id, options):
        exchanges = await load_task(db, user_id, task_id)
        found = await anyio.to_thread.run_sync(
            task_samples, exchanges, options, anonymizer, since
        )
        tasks += 1
        samples += len(found)
        if samples >= AUDIT_SAMPLE_LIMIT:
            truncated = True
            break
    rows = anonymizer.report()
    by_category: dict[str, int] = {}
    for row in rows:
        by_category[row["category"]] = (
            by_category.get(row["category"], 0) + row["count"]
        )
    return render_page(
        request,
        web,
        "dataset_audit.html",
        "dataset",
        rows=rows,
        by_category=sorted(by_category.items(), key=lambda item: -item[1]),
        samples=samples,
        tasks=tasks,
        truncated=truncated,
        limit=AUDIT_SAMPLE_LIMIT,
        export_query=request.url.query,
    )


def _report_line(exchange) -> str:
    """One exchange of the reconstruction report: everything, as recorded."""
    return json.dumps(
        {
            "id": exchange.id,
            "baseId": exchange.base_id,
            "sequence": exchange.sequence,
            "occurredAt": exchange.occurred_at.isoformat()
            if exchange.occurred_at
            else None,
            "modelId": exchange.model_id,
            "provider": exchange.provider,
            "mode": exchange.mode,
            "workspacePath": exchange.workspace_path,
            "retryAttempt": exchange.retry_attempt,
            "status": exchange.status,
            "complete": exchange.complete,
            "issues": exchange.issues,
            "request": {
                "system": exchange.system,
                "tools": exchange.tools,
                "messages": exchange.messages,
                "params": exchange.params,
            },
            "wire": (
                {
                    **exchange.wire,
                    "verified": exchange.wire_verified,
                    "body": exchange.wire_body,
                }
                if exchange.wire
                else None
            ),
            "response": exchange.response,
            "error": exchange.error,
            "outcome": exchange.outcome,
        },
        ensure_ascii=False,
        default=str,
    )


@router.get("/app/dataset/tasks/{task_id}.jsonl")
async def dataset_task_report(
    request: Request,
    task_id: str,
    web: WebPage = Depends(require_web_page),
):
    """Every exchange of one task, rebuilt in full (the exact requests). Owner only."""
    exchanges = await load_task(
        web["db"], web["user"]["user_id"], task_id, verify_wire=True
    )
    if not exchanges:
        return not_found_page(
            request,
            web["user"],
            "No recording",
            "No recorded exchanges for this task, or it is not yours.",
            back_href="/app/dataset",
            back_label="Back to the dataset",
        )
    lines = await anyio.to_thread.run_sync(
        lambda: "".join(_report_line(e) + "\n" for e in exchanges)
    )
    return StreamingResponse(
        iter([lines]),
        media_type="application/x-ndjson; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="tumble-exchanges-{task_id[:40]}.jsonl"'
        },
    )


@router.post("/app/dataset/delete")
async def dataset_delete_all(
    web: WebPage = Depends(require_web_page),
):
    """Delete every recorded exchange and blob of the user. The switch stays as it is."""
    removed = await delete_recordings(web["db"], web["user"]["user_id"])
    await web["db"].commit()
    return RedirectResponse(url=f"/app/dataset?deleted={removed}", status_code=303)
