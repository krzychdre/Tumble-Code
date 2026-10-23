"""Task, TaskMessage, TaskShare and TaskImage models."""

import uuid
from sqlalchemy import (
    Column,
    String,
    Text,
    Float,
    Integer,
    Boolean,
    ForeignKey,
    DateTime,
    BigInteger,
    Index,
    LargeBinary,
)
from sqlalchemy.orm import relationship
from datetime import datetime, timezone

from src.models.base import Base, TimestampMixin, generate_id


class Task(Base, TimestampMixin):
    """Task model for tracking shared tasks."""

    __tablename__ = "tasks"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(
        String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    organization_id = Column(
        String, ForeignKey("organizations.id", ondelete="SET NULL"), nullable=True
    )
    # Absolute path of the VS Code workspace folder (worktree root) the task was
    # attached to, captured from the bridge's extension:register `workspacePath`
    # or the share/backfill payload. Nullable: legacy rows and tasks created
    # while the bridge was offline (and the client sent nothing) have no value.
    workspace_path = Column(String, nullable=True)
    # The client that ran the task, "vscode" or "cli" (services/client_kind).
    # "vscode" doubles as "nothing said otherwise yet": the bridge creates the
    # row from a message, which names no client, so the row starts as
    # "vscode" and the first record of the task from the CLI (a telemetry
    # event, a backfill) turns it to "cli". Never back: a task lives in one
    # client's storage only. See telemetry_service.stamp_task_client.
    client_kind = Column(
        String, nullable=False, default="vscode", server_default="vscode"
    )

    # The task that spawned this one, when it is a subtask. Denormalized from
    # task_relations (which is written from telemetry, often before either task
    # row exists) so the list and detail views can render the hierarchy without
    # a lookup per row. ON DELETE SET NULL: deleting a parent orphans its
    # children rather than cascading their conversations away. Named like
    # migration a7b8c9d0e1f2 names it, so its downgrade finds the key on a
    # create_all database too.
    parent_task_id = Column(
        String,
        ForeignKey("tasks.id", ondelete="SET NULL", name="fk_tasks_parent_task_id"),
        nullable=True,
        index=True,
    )

    # --- denormalized display summary -------------------------------------
    # Maintained by services/task_summary.refresh_task_summary() on every write
    # so the task list renders from one indexed query instead of re-parsing the
    # whole message corpus per page view. Nullable/zero-defaulted: rows written
    # before this existed are filled by the migration's backfill.
    title = Column(String, nullable=True)
    # The opening user query, capped (services/task_summary.PROMPT_MAX) — what
    # the title is a single truncated line of. Stored rather than read from the
    # first message because that message is the largest row in the conversation
    # (it carries the extension's <environment_details> appendix), and the list
    # shows it on every row's hover.
    prompt_excerpt = Column(String, nullable=True)
    message_count = Column(Integer, nullable=False, default=0, server_default="0")
    tokens_in = Column(BigInteger, nullable=False, default=0, server_default="0")
    tokens_out = Column(BigInteger, nullable=False, default=0, server_default="0")
    cache_reads = Column(BigInteger, nullable=False, default=0, server_default="0")
    cache_writes = Column(BigInteger, nullable=False, default=0, server_default="0")
    cost = Column(Float, nullable=False, default=0.0, server_default="0")
    # ClineMessage.ts of the first/last stored message. Kept as the endpoints
    # rather than only their difference so an incremental refresh can widen the
    # span without re-reading the conversation.
    first_ts = Column(BigInteger, nullable=True)
    last_ts = Column(BigInteger, nullable=True)
    # Distinct model ids this task ran on, most-used first, comma-joined — the
    # one thing the stored conversation cannot say (`api_req_started` carries no
    # model). Derived from LLM Completion telemetry; see
    # services/model_attribution. NULL when no completion event is known.
    models = Column(String, nullable=True)

    # --- session quality ---------------------------------------------------
    # Counts of deterministic markers in the conversation (services/
    # session_quality), rolled up the same way as the token totals so a list can
    # grade a run without reading it. Tokens say what a run cost; these say
    # whether it went well.
    q_requests = Column(Integer, nullable=False, default=0, server_default="0")
    q_errors = Column(Integer, nullable=False, default=0, server_default="0")
    q_retries = Column(Integer, nullable=False, default=0, server_default="0")
    q_interventions = Column(Integer, nullable=False, default=0, server_default="0")
    q_completion_replies = Column(
        Integer, nullable=False, default=0, server_default="0"
    )
    q_condense = Column(Integer, nullable=False, default=0, server_default="0")
    q_tools = Column(Integer, nullable=False, default=0, server_default="0")
    # Total and distinct (tool, path) pairs; their difference is repeated work.
    q_tool_paths = Column(Integer, nullable=False, default=0, server_default="0")
    q_distinct_tool_paths = Column(
        Integer, nullable=False, default=0, server_default="0"
    )
    q_completed = Column(Boolean, nullable=False, default=False, server_default="0")

    messages = relationship(
        "TaskMessage", back_populates="task", cascade="all, delete-orphan"
    )
    shares = relationship(
        "TaskShare", back_populates="task", cascade="all, delete-orphan"
    )

    # The list is always "this user's tasks, newest first" — a composite index
    # makes that an index-ordered scan of just the page being shown, instead of
    # sorting every row the user owns on each request.
    __table_args__ = (Index("ix_tasks_user_updated", "user_id", "updated_at"),)


class TaskMessage(Base):
    """Task message model for backfill."""

    __tablename__ = "task_messages"

    id = Column(String, primary_key=True, default=lambda: generate_id("msg_"))
    task_id = Column(
        String, ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False, index=True
    )
    message_data = Column(Text, nullable=False)
    # ClineMessage.ts of the stored message. Lets the live bridge upsert a
    # streaming message in place (created → partial updates → final) instead of
    # appending duplicate rows. Nullable for legacy/backfilled rows.
    message_ts = Column(BigInteger, nullable=True, index=True)
    created_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    # --- per-message token/cost contribution -------------------------------
    # Parsed once from `message_data` at write time (services/task_summary.
    # message_metrics) so the task rollup is a numeric SUM over an index rather
    # than a JSON parse of the whole conversation. Zero for the vast majority of
    # messages — only `api_req_started` and `condense_context` carry figures.
    tokens_in = Column(BigInteger, nullable=False, default=0, server_default="0")
    tokens_out = Column(BigInteger, nullable=False, default=0, server_default="0")
    cache_reads = Column(BigInteger, nullable=False, default=0, server_default="0")
    cache_writes = Column(BigInteger, nullable=False, default=0, server_default="0")
    cost = Column(Float, nullable=False, default=0.0, server_default="0")

    # --- quality marker ----------------------------------------------------
    # What this message says about how the run is going: request / error /
    # retry / intervention / completion_reply / condense / tool / completion,
    # or NULL
    # for the majority that say nothing (see services/session_quality). Indexed
    # because the task rollup counts by it.
    q_kind = Column(String, nullable=True, index=True)
    # For a tool message, the "<tool>:<path>" it touched. Counting these against
    # their distinct values is how repeated work is measured.
    tool_path = Column(String, nullable=True)

    # The bridge upserts a streaming message in place via ON CONFLICT on this
    # pair. NULL message_ts stays distinct, so legacy/backfilled rows still
    # append. Declared as the unique INDEX migration d4e5f6a7b8c9 creates (not a
    # UniqueConstraint), so a fresh database built by create_all and a migrated
    # one hold the same object. ON CONFLICT must name the columns
    # (index_elements), never constraint="uq_task_messages_task_ts": Postgres
    # accepts ON CONFLICT ON CONSTRAINT only for a constraint, not for an index.
    __table_args__ = (
        Index("uq_task_messages_task_ts", "task_id", "message_ts", unique=True),
    )

    task = relationship("Task", back_populates="messages")


class TaskShare(Base):
    """Task share model."""

    __tablename__ = "task_shares"

    id = Column(String, primary_key=True, default=lambda: generate_id("sh_"))
    task_id = Column(
        String, ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False, index=True
    )
    visibility = Column(String, default="organization")
    share_url = Column(String, nullable=True)
    manage_url = Column(String, nullable=True)
    expires_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    # One share row per task, ever. POST /api/extension/share used to be a
    # non-atomic select-then-insert, so two concurrent requests both inserted
    # and every scalar_one_or_none() reader of a task's share (shared_view_access
    # et al.) started raising MultipleResultsFound. Declared as the unique INDEX
    # (not a UniqueConstraint) exactly like uq_task_messages_task_ts above, so a
    # fresh create_all database and a migrated one hold the same object, and the
    # service can upsert with ON CONFLICT naming index_elements.
    __table_args__ = (Index("uq_task_shares_task_id", "task_id", unique=True),)

    task = relationship("Task", back_populates="shares")


class TaskImage(Base):
    """An image file a task's message points to by path.

    The CLI and the extension write Markdown like ``![chart](monitoring/x.png)``
    with a path into the user's workspace; the cloud only ever receives the
    text, so the client uploads the file itself (POST /api/tasks/{id}/images)
    and the task page asks for it by the message's ts and the path as written.
    See ai_plans/2026-10-12_18-00_cloud-web-task-images.md.
    """

    __tablename__ = "task_images"

    id = Column(String, primary_key=True, default=lambda: generate_id("img_"))
    task_id = Column(String, ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False)
    # ClineMessage.ts of the message whose text holds the reference.
    message_ts = Column(BigInteger, nullable=False)
    # The reference target exactly as the Markdown wrote it, not the resolved
    # absolute path: that is what the page has in hand when it asks.
    path = Column(String, nullable=False)
    # Sniffed from the bytes at upload (services/task_images), never the
    # declared type.
    mime = Column(String, nullable=False)
    size = Column(Integer, nullable=False)
    sha256 = Column(String, nullable=False)
    data = Column(LargeBinary, nullable=False)
    created_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    # One image per (task, message, path); a re-upload replaces it through ON
    # CONFLICT on these columns. A unique INDEX like uq_task_messages_task_ts,
    # for the same reason. Its leading task_id also serves the per-task delete.
    __table_args__ = (
        Index(
            "uq_task_images_task_ts_path", "task_id", "message_ts", "path", unique=True
        ),
    )
