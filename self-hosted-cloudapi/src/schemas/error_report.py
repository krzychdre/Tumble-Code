"""The wire contract of POST /api/error-reports.

Fixed with the extension (camelCase, every field but four optional). Unknown
fields are ignored rather than refused, so a newer extension can add one
without its reports bouncing off an older server; for the same reason an
unknown ``category`` is accepted and stored (the page shows it as
Unclassified). The length limits are the ones the extension truncates to; a
report past them is refused, not cut, because only a broken client sends one.
"""

from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

# The categories the extension sends today. Not enforced: see the docstring.
KNOWN_CATEGORIES = (
    "api_error",
    "empty_response",
    "context_overflow",
    "invalid_tool_call",
    "tool_error",
    "diff_error",
    "mistake_limit",
    "exception",
)

SUMMARY_MAX = 500
TEXT_MAX = 8000


class _Wire(BaseModel):
    model_config = ConfigDict(
        populate_by_name=True, alias_generator=to_camel, serialize_by_alias=True, extra="ignore",
        # NaN and Infinity are not JSON; a client that sends them is broken.
        allow_inf_nan=False,
    )


class ReportMessage(_Wire):
    role: Literal["user", "assistant", "system", "tool"]
    content: str


class ReportRequest(_Wire):
    system_prompt_chars: Optional[int] = None
    system_prompt_sha256: Optional[str] = None
    tool_names: Optional[list[str]] = None
    params: Optional[dict[str, Any]] = None
    messages: Optional[list[ReportMessage]] = None


class ReportToolCall(_Wire):
    id: Optional[str] = None
    name: str
    arguments: str


class ReportResponse(_Wire):
    text: Optional[str] = None
    reasoning: Optional[str] = None
    tool_calls: Optional[list[ReportToolCall]] = None
    stop_reason: Optional[str] = None
    error_body: Optional[str] = None
    usage: Optional[dict[str, Any]] = None


class ErrorReportRequest(_Wire):
    """Body of POST /api/error-reports."""

    id: str = Field(min_length=1, max_length=64)
    # Epoch milliseconds, by the extension's clock.
    occurred_at: float = Field(ge=0, le=4_102_444_800_000)  # up to 2100-01-01
    category: str = Field(min_length=1, max_length=64)
    summary: str = Field(max_length=SUMMARY_MAX)
    error_message: Optional[str] = Field(None, max_length=TEXT_MAX)
    task_id: Optional[str] = None
    mode: Optional[str] = None
    app_version: Optional[str] = None
    editor_name: Optional[str] = None
    # "vscode" or "cli". Any other text is accepted and read as the editor name
    # says (services/client_kind), like an unknown category.
    client_kind: Optional[str] = None
    # The CLI's package version (the CLI only); kept in the payload.
    client_version: Optional[str] = None
    platform: Optional[str] = None
    provider: Optional[str] = None
    model_id: Optional[str] = None
    context_window: Optional[float] = None
    max_output_tokens: Optional[float] = None
    context_tokens: Optional[float] = None
    message_count: Optional[int] = None
    tool_name: Optional[str] = None
    http_status: Optional[int] = None
    retry_attempt: Optional[int] = None
    request: Optional[ReportRequest] = None
    response: Optional[ReportResponse] = None
    tool_result: Optional[str] = Field(None, max_length=TEXT_MAX)
