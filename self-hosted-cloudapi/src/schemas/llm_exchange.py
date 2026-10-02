"""The wire contract of POST /api/llm-exchanges and POST /api/llm-exchanges/outcome.

Mirrors packages/types/src/llm-exchange.ts (camelCase, optional fields omitted,
never null). Unknown fields are ignored so a newer extension can add one. The
conversation content (`append`, wire field values) is kept as arbitrary JSON:
it is whatever the provider was sent, and the reconstruction must give it back
unchanged. See ai_plans/2026-10-02_llm-exchange-dataset.md.
"""

from typing import Annotated, Any, Literal, Optional, Union

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

SHA256_PATTERN = r"^[0-9a-f]{64}$"

# Not enforced on purpose: an unknown status or outcome from a newer extension
# is stored and treated as "not clean" by services/exchange_quality.
KNOWN_STATUSES = ("completed", "error", "aborted")
KNOWN_TOOL_OUTCOMES = ("ok", "invalid_tool_call", "tool_error", "diff_error", "mistake_limit", "rejected")


class _Wire(BaseModel):
    model_config = ConfigDict(
        populate_by_name=True, alias_generator=to_camel, serialize_by_alias=True, extra="ignore",
        allow_inf_nan=False,
    )


class BlobRef(_Wire):
    sha256: str = Field(pattern=SHA256_PATTERN)
    text: Optional[str] = None


class ArrayDelta(_Wire):
    keep: int = Field(ge=0)
    append: list[Any]


class WireValueField(_Wire):
    key: str
    kind: Literal["value"]
    value: Any = None


class WireBlobField(_Wire):
    key: str
    kind: Literal["blob"]
    blob: BlobRef


class WireArrayField(_Wire):
    key: str
    kind: Literal["array"]
    delta: ArrayDelta


WireField = Annotated[Union[WireValueField, WireBlobField, WireArrayField], Field(discriminator="kind")]


class WireRequest(_Wire):
    url: str
    format: str
    body_sha256: str = Field(pattern=SHA256_PATTERN)
    body_bytes: int = Field(ge=0)
    fields: Optional[list[WireField]] = None


class ExchangeRequest(_Wire):
    system: BlobRef
    tools: BlobRef
    messages: ArrayDelta
    message_count: int = Field(ge=0)
    params: dict[str, Any]
    wire: Optional[WireRequest] = None


class ToolCall(_Wire):
    id: Optional[str] = None
    name: str
    arguments: str


class Usage(_Wire):
    input_tokens: Optional[float] = None
    output_tokens: Optional[float] = None
    cache_read_tokens: Optional[float] = None
    cache_write_tokens: Optional[float] = None
    total_cost: Optional[float] = None


class ExchangeResponse(_Wire):
    text: Optional[str] = None
    reasoning: Optional[str] = None
    tool_calls: Optional[list[ToolCall]] = None
    finish_reason: Optional[str] = None
    usage: Optional[Usage] = None


class ExchangeError(_Wire):
    message: str
    http_status: Optional[int] = None
    body: Optional[str] = None


class LlmExchangeRequest(_Wire):
    """One exchange as the extension sends it."""

    id: str = Field(min_length=1, max_length=100)
    base_id: Optional[str] = Field(default=None, max_length=100)
    task_id: str = Field(min_length=1, max_length=200)
    parent_task_id: Optional[str] = None
    root_task_id: Optional[str] = None
    sequence: int = Field(ge=0)
    occurred_at: float = Field(ge=0, le=4_102_444_800_000)
    duration_ms: Optional[float] = None
    retry_attempt: int = Field(ge=0)
    mode: Optional[str] = None
    provider: Optional[str] = None
    model_id: str
    app_version: Optional[str] = None
    editor_name: Optional[str] = None
    platform: Optional[str] = None
    workspace_path: Optional[str] = None
    request: ExchangeRequest
    response: ExchangeResponse
    status: str
    error: Optional[ExchangeError] = None


class ToolOutcome(_Wire):
    tool_call_id: Optional[str] = None
    tool_name: str
    status: str
    note: Optional[str] = Field(default=None, max_length=2000)


class LlmExchangeOutcomeRequest(_Wire):
    exchange_id: str = Field(min_length=1, max_length=100)
    task_id: str
    tool_results: list[ToolOutcome]
    usage: Optional[Usage] = None
