"""The training dataset: recorded exchanges as clean, anonymized chat samples.

One JSON object per line, in the OpenAI chat fine-tuning shape (``messages``
plus ``tools``) that TRL, Axolotl and the OpenAI fine-tuning API read:

* ``turns``: one sample per clean exchange: the system prompt, the request's
  conversation (assistant messages weight 0) and the exchange's own answer
  (weight 1) exactly as the model produced it, raw tool arguments included.
* ``trajectories``: one sample per chain of exchanges whose requests extend
  each other (a condense, truncation or microcompact starts a new one): the
  last request plus its answer; each assistant message a clean exchange of the
  selected models produced is its exact answer with weight 1, any other
  assistant message stays as it was sent, with weight 0.

What "clean" means is services/exchange_quality; how a text is anonymized is
services/anonymizer. See ai_plans/2026-10-02_llm-exchange-dataset.md.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, AsyncIterator, Optional
from zoneinfo import ZoneInfo

import anyio
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.llm_exchange import DatasetSettings, LlmExchange
from src.models.user import User
from src.services.anonymizer import Anonymizer
from src.services.exchange_quality import is_clean
from src.services.exchange_reconstruction import Exchange, js_json, load_task
from src.services.client_kind import parse_client
from src.services.metrics_service import PERIODS, period_start
from src.utils.clientzone import UTC
from src.services.openai_messages import convert_message, response_message

FORMATS = ("turns", "trajectories")


@dataclass
class ExportOptions:
    period: str = "all"
    models: list[str] = field(default_factory=list)
    # Workspaces whose exchanges never go into the dataset (a client's code).
    exclude_workspaces: list[str] = field(default_factory=list)
    # "vscode" or "cli" (services/client_kind): only the tasks that client
    # recorded; "" for both. A task is recorded by one client only, so this
    # picks tasks (task_ids), not single exchanges.
    client: str = ""
    format: str = "turns"
    strict: bool = False
    reasoning: bool = True
    anonymize: bool = True
    metadata: bool = False
    limit: int = 0
    # The reader's zone (utils/clientzone): a period starts at their local
    # midnight. Set by the router from the request, not from the query string.
    zone: ZoneInfo = UTC

    @classmethod
    def from_query(cls, params) -> "ExportOptions":
        """From the export form's query string (unknown values fall back to the defaults)."""

        def flag(name: str, default: bool) -> bool:
            value = params.get(name)
            return default if value is None else value in ("1", "true", "on", "yes")

        try:
            limit = max(0, int(params.get("limit") or 0))
        except ValueError:
            limit = 0
        return cls(
            period=params.get("period") if params.get("period") in PERIODS else "all",
            models=[m for m in params.getlist("model") if m],
            exclude_workspaces=[w for w in params.getlist("exclude_workspace") if w],
            client=parse_client(params.get("client")) or "",
            format=params.get("format") if params.get("format") in FORMATS else "turns",
            strict=flag("strict", False),
            reasoning=flag("reasoning", True),
            anonymize=flag("anonymize", True),
            metadata=flag("metadata", False),
            limit=limit,
        )


async def build_anonymizer(db: AsyncSession, user_id: str) -> Anonymizer:
    """An anonymizer that knows the account's identity and the user's terms."""
    user = await db.get(User, user_id)
    identity: list[tuple[str, str]] = []
    if user is not None:
        first, last = (user.first_name or "").strip(), (user.last_name or "").strip()
        if user.email:
            identity.append(("email", user.email))
        if first and last:
            identity.append(("name", f"{first} {last}"))
        identity += [("name", first), ("name", last)]
    settings_row = await db.get(DatasetSettings, user_id)
    terms = (settings_row.anonymize_terms or "").splitlines() if settings_row else []
    return Anonymizer(identity=identity, terms=terms)


async def task_ids(db: AsyncSession, user_id: str, options: ExportOptions) -> list[str]:
    """The tasks with at least one exchange matching the filters, oldest first."""
    query = select(LlmExchange.task_id).where(LlmExchange.user_id == user_id)
    since = period_start(options.period, zone=options.zone)
    if since is not None:
        query = query.where(LlmExchange.occurred_at >= since)
    if options.models:
        query = query.where(LlmExchange.model_id.in_(options.models))
    if options.client:
        query = query.where(LlmExchange.client_kind == options.client)
    if options.exclude_workspaces:
        query = query.where(
            or_(LlmExchange.workspace_path.is_(None), LlmExchange.workspace_path.notin_(options.exclude_workspaces))
        )
    query = query.group_by(LlmExchange.task_id).order_by(func.min(LlmExchange.occurred_at))
    return list((await db.scalars(query)).all())


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


class _TaskRenderer:
    """Renders one task's exchanges; caches per message object (histories share them)."""

    def __init__(self, options: ExportOptions, anonymizer: Optional[Anonymizer], since: Optional[datetime]):
        self.options = options
        self.anonymizer = anonymizer
        self.since = since
        self._converted: dict[int, list[dict]] = {}
        self._keys: dict[int, str] = {}
        self._tools: dict[int, Any] = {}
        self._systems: dict[str, str] = {}

    def text(self, value: str) -> str:
        return self.anonymizer.text(value) if self.anonymizer else value

    def args(self, raw: str) -> str:
        return self.anonymizer.arguments(raw) if self.anonymizer else raw

    def selected(self, exchange: Exchange) -> bool:
        """A target the filters ask for: clean, of a chosen model, in the period and workspaces."""
        options = self.options
        if exchange.status != "completed" or exchange.messages is None or exchange.system is None:
            return False
        if not is_clean(exchange.issues, options.strict):
            return False
        if options.models and exchange.model_id not in options.models:
            return False
        if exchange.workspace_path and exchange.workspace_path in options.exclude_workspaces:
            return False
        return self.since is None or _aware(exchange.occurred_at) >= self.since

    def convert(self, message: Any) -> list[dict]:
        key = id(message)
        if key not in self._converted:
            self._converted[key] = convert_message(
                message, reasoning=self.options.reasoning, text=self.text, args=self.args
            )
        return self._converted[key]

    def message_key(self, message: Any) -> str:
        key = id(message)
        if key not in self._keys:
            self._keys[key] = hashlib.sha256(js_json(message).encode("utf-8")).hexdigest()
        return self._keys[key]

    def system(self, exchange: Exchange) -> dict:
        text = exchange.system or ""
        if text not in self._systems:
            self._systems[text] = self.text(text)
        return {"role": "system", "content": self._systems[text]}

    def tools(self, exchange: Exchange) -> Any:
        key = id(exchange.tools)
        if key not in self._tools:
            tools = exchange.tools or []
            self._tools[key] = self.anonymizer.tools(tools) if self.anonymizer else tools
        return self._tools[key]

    def answer(self, exchange: Exchange) -> dict:
        return response_message(exchange.response, reasoning=self.options.reasoning, text=self.text, args=self.args)

    def history(self, messages: list) -> list[dict]:
        out: list[dict] = []
        for message in messages:
            for converted in self.convert(message):
                out.append({**converted, "weight": 0} if converted["role"] == "assistant" else converted)
        return out

    def sample(self, messages: list[dict], exchange: Exchange, metadata: dict) -> dict:
        sample: dict = {"messages": messages, "tools": self.tools(exchange)}
        if self.options.metadata:
            sample["metadata"] = metadata
        return sample

    # --- the two formats ---------------------------------------------------------

    def turns(self, exchanges: list[Exchange]) -> list[dict]:
        samples = []
        for exchange in exchanges:
            if not self.selected(exchange):
                continue
            messages = [self.system(exchange), *self.history(exchange.messages), {**self.answer(exchange), "weight": 1}]
            samples.append(self.sample(messages, exchange, _meta(exchange)))
        return samples

    def trajectories(self, exchanges: list[Exchange]) -> list[dict]:
        samples = []
        for segment in self._segments(exchanges):
            sample = self._trajectory(segment)
            if sample is not None:
                samples.append(sample)
        return samples

    def _segments(self, exchanges: list[Exchange]) -> list[list[Exchange]]:
        """Runs of completed exchanges whose requests extend the previous one's."""
        segments: list[list[Exchange]] = []
        current: list[Exchange] = []
        last_keys: list[str] = []
        for exchange in exchanges:
            if exchange.status != "completed" or exchange.messages is None or exchange.system is None:
                continue
            keys = [self.message_key(m) for m in exchange.messages]
            if current and len(keys) > len(last_keys) and keys[: len(last_keys)] == last_keys:
                current.append(exchange)
            else:
                if current:
                    segments.append(current)
                current = [exchange]
            last_keys = keys
        if current:
            segments.append(current)
        return segments

    def _trajectory(self, segment: list[Exchange]) -> Optional[dict]:
        last = segment[-1]
        # Where each earlier exchange's answer sits in the last request.
        answers = {len(e.messages): e for e in segment[:-1]}
        messages: list[dict] = [self.system(last)]
        trained = []
        for index, message in enumerate(last.messages):
            producer = answers.get(index)
            converted = self.convert(message)
            if producer is not None and len(converted) == 1 and converted[0]["role"] == "assistant":
                if self.selected(producer):
                    exact = self.answer(producer)
                    _reuse_call_ids(exact, converted[0])
                    messages.append({**exact, "weight": 1})
                    trained.append(producer.id)
                    continue
            for item in converted:
                messages.append({**item, "weight": 0} if item["role"] == "assistant" else item)
        if self.selected(last):
            messages.append({**self.answer(last), "weight": 1})
            trained.append(last.id)
        if not trained:
            return None
        # A sample ends with an assistant message.
        while messages and messages[-1]["role"] != "assistant":
            messages.pop()
        return self.sample(
            messages,
            last,
            {
                "task": last.task_id,
                "exchanges": [e.id for e in segment],
                "trained": trained,
                "models": sorted({e.model_id for e in segment if e.model_id}),
            },
        )


def _reuse_call_ids(exact: dict, sent: dict) -> None:
    """Keep the tool call ids the later tool results answer (the extension may sanitize them)."""
    exact_calls, sent_calls = exact.get("tool_calls") or [], sent.get("tool_calls") or []
    if len(exact_calls) == len(sent_calls):
        for mine, theirs in zip(exact_calls, sent_calls):
            mine["id"] = theirs["id"]


def _meta(exchange: Exchange) -> dict:
    return {
        "task": exchange.task_id,
        "exchange": exchange.id,
        "model": exchange.model_id,
        "provider": exchange.provider,
        "mode": exchange.mode,
    }


def task_samples(
    exchanges: list[Exchange], options: ExportOptions, anonymizer: Optional[Anonymizer], since: Optional[datetime]
) -> list[dict]:
    """The samples of one task (pure and CPU-bound: run it in a worker thread)."""
    if anonymizer is not None:
        # Learn every workspace and home folder of the task before any text is
        # rewritten, so the first message is treated like the last.
        for exchange in exchanges:
            anonymizer.learn(exchange.system, exchange.workspace_path)
    renderer = _TaskRenderer(options, anonymizer, since)
    if anonymizer is not None:
        # Histories repeat within a task, not across tasks: keep memory flat.
        try:
            return renderer.trajectories(exchanges) if options.format == "trajectories" else renderer.turns(exchanges)
        finally:
            anonymizer.forget_texts()
    return renderer.trajectories(exchanges) if options.format == "trajectories" else renderer.turns(exchanges)


async def export_lines(
    db: AsyncSession, user_id: str, options: ExportOptions, anonymizer: Optional[Anonymizer] = None
) -> AsyncIterator[str]:
    """The dataset, one JSONL line at a time, task by task."""
    if options.anonymize and anonymizer is None:
        anonymizer = await build_anonymizer(db, user_id)
    since = period_start(options.period, zone=options.zone)
    emitted = 0
    for task_id in await task_ids(db, user_id, options):
        exchanges = await load_task(db, user_id, task_id)
        samples = await anyio.to_thread.run_sync(task_samples, exchanges, options, anonymizer, since)
        for sample in samples:
            yield json.dumps(sample, ensure_ascii=False) + "\n"
            emitted += 1
            if options.limit and emitted >= options.limit:
                return
