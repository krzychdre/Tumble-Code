# Fix truncated/cut conversation blocks on the web task view (reasoning shows only the first partial)

**Date:** 2026-06-21
**Branch:** `feature/self-hosted-remote-task-control`
**Symptom (user's words):** "After clicking reasoning block — I want to see it whole but the content is
cut. Fix it everywhere, where content is cut when user expands block."

The screenshot is the self-hosted **web task viewer** (`self-hosted-cloudapi/src/web`): a 💭 REASONING
block, expanded, whose body is just `The user says` — the first few words of a 5.2 s reasoning trace.

---

## Root cause (proven against the live DB, not assumed)

The renderer does **not** clip: `render.js` renders `md(m.text)` into `.msg-body` with no `max-height`,
`line-clamp`, or `overflow` cap (`app.css`), and `<details>`/`.msg` grow freely. `md()` never truncates.
So the body literally contains only the text that was **persisted**. The cut is in the data.

Queried live Postgres `stork_code.task_messages` directly:

```
created 2026-06-21 10:43:40  ts 1782038620519  partial True  len 13   "The user says"   <-- the screenshot
created 2026-06-21 10:43:27  ts 1782038606981  partial True  len 38   "The user wants a summary of the recent"
created 2026-06-21 10:36:33  ts 1782038193126  partial False len 161  "We need to see the rest of the output..."
created 2026-06-21 10:36:10  ts 1782038170129  partial True  len 16
```

- `alembic_version = d4e5f6a7b8c9` — the unique-ts migration **has** run.
- **0 duplicate `(task_id, message_ts)` groups**; `uq_task_messages_task_ts` present. So the
  `ON CONFLICT DO UPDATE` upsert is live and correctly collapses to one row per ts.
- **Yet** reasoning rows are frozen at short, early partials (`len 13`, `partial:true`) — the fuller
  partials and the `partial:false` finalize never won. One row (`len 161`) _did_ finalize. The outcome
  is **non-deterministic** across messages.

Non-determinism is the signature of a **commit-order race**. `upsert_task_message()` runs
`INSERT … ON CONFLICT (task_id, message_ts) DO UPDATE SET message_data = EXCLUDED.message_data`
**unconditionally**, each bridge event in its own `async_session_factory()` session. Streaming reasoning
emits many `say("reasoning", <accumulated text>, partial=true)` Message events back-to-back
(`TaskStreamProcessor.ts:186-195` — text accumulates, full value sent each chunk), plus a final
`partial:false`. python-socketio dispatches each `on_task_event` as a concurrent asyncio task; the
concurrent `DO UPDATE`s serialize on the unique-index row lock, and **whichever transaction commits last
wins** — which is non-deterministically an early, short partial. The row freezes at truncated text +
`partial:true`, and the viewer shows exactly that.

The previous fix (migration `d4e5f6a7b8c9`) removed duplicate _rows_ but left the **which-payload-wins**
ordering unguarded, so the truncation survived.

This is not reasoning-specific: every streamed `say` (text, command_output, tool, mcp, api_req) upserts
through the same path, so any of them can freeze at an early partial. That is the "everywhere" the user
means — one shared persistence bug, all block types.

## Fix — make the upsert monotonic (race-proof, payload-ordered)

`telemetry_service.upsert_task_message()`: keep the `ON CONFLICT DO UPDATE` but make it **monotonic** so a
row can only advance toward its most-complete form — an early/short partial committing late can never
clobber a fuller payload or the finalize:

```python
is_final = not message.get("partial")
base = _insert(TaskMessage).values(task_id=task_id, message_data=payload, message_ts=ts)
on_conflict = dict(
    index_elements=["task_id", "message_ts"],
    set_={"message_data": base.excluded.message_data},
)
if not is_final:
    on_conflict["where"] = func.length(base.excluded.message_data) >= func.length(TaskMessage.message_data)
stmt = base.on_conflict_do_update(**on_conflict)
```

Two cases, because length alone is _not_ a clean monotonic key across the partial→final boundary:

- A **final** message (`partial` falsy) is **authoritative and always wins** — there is exactly one per
  `ts` and it holds the full accumulated text. It bypasses the length check on purpose: dropping the
  `"partial":true"` flag can make the final JSON a few bytes _shorter_ than the last partial despite longer
  text (this is exactly what broke the first length-only attempt: the `…upsert_is_idempotent_by_ts` test's
  final payload is ~6 bytes shorter than its preceding partial).
- A **partial** may only overwrite when its `message_data` is `>=` the stored one. Streamed `partial:true`
  chunks carry the _accumulated_ text (`_reasoningMessage += chunk`) with a constant `"partial":true`
  flag, so their JSON length grows monotonically — a late, short partial is rejected.

`is_final` is known in Python (no JSON-in-SQL needed), so the guard stays dialect-agnostic; both
`postgresql.insert` and `sqlite.insert` support `on_conflict_do_update(..., where=…)` with `excluded`. The
`ts is None` append path is unchanged.

## Out of scope / notes

- **Already-corrupted historical rows** (`The user says`, etc.) cannot be repaired from the DB — the full
  text was never stored; only the extension's own `clineMessages` still hold it. Re-sharing such a task
  re-runs `backfill_messages()` (full replace from the extension's complete messages), which heals it.
- No front-end change: the renderers (web `render.js`, VS Code `ReasoningBlock.tsx`) were reviewed and do
  not clip expanded content.

## Verification

- `uv run pytest tests/test_bridge.py` green; existing idempotent + reasoning-collapse tests still pass
  (sequential calls always end at the longest/finalize).
- **New test** `test_task_event_upsert_never_regresses_to_shorter_partial`: deliver the long/final payload
  first, then a short early partial for the same ts → row keeps the full text (short partial rejected).
  Fails on the unguarded upsert, passes with the guard.
- Manual: drive a live reasoning task, reload the finished task → the reasoning block expands to the full
  trace, not just its opening words.
