# Share always uploads the full local task history

**Date:** 2026-06-22
**Branch:** `fix/share-always-backfill-full-task` (stack off current `fix/cloudapi-authentik-back-channel-host`)
**Status:** proposed

## Symptom (user report)

> I ran my task prior to the backend running and shared the task afterwards.
> All I can see on the web is "Untitled task", tokens in/out and cost — not the
> conversation. I want the task synced to the backend _in whole_ in such cases.

## Root cause (code-traced)

The shared/web task views are rendered **entirely from the `task_messages`
table**:

- title → `_derive_title(messages)` — `web.py:106`
- tokens/cost → `_compute_metrics(messages)` (client-side in `render.js`, same
  source) — `web.py:131`
- conversation body → `messages_json` — `web.py:419`, `web.py:427`

`task_messages` has exactly two writers:

1. `backfill_messages(...)` — uploads the full `task.json` and **replaces** all
   rows for the task (`telemetry_service.py:42`). Triggered by the extension via
   `POST /api/events/backfill`.
2. `upsert_task_message(...)` — the live remote-control **bridge** persisting one
   streamed message at a time (`sio.py:187`, `telemetry_service.py:88`).

Plain telemetry events (`POST /api/events`) only write the **`telemetry_events`**
table — never `task_messages` (`telemetry_service.py:24`).

### Why "Untitled task" + tokens but no conversation

`_derive_title` skips any message whose `text` starts with `{` (JSON), i.e.
`api_req_started` rows (`web.py:115`); `_compute_metrics` reads exactly those
`api_req_started` rows for tokens/cost. So the stored set contained
`api_req_started` rows (→ metrics) but **not** the user's text turn (→ title
falls back to "Untitled task", and the body is near-empty). A _full_ backfill
always carries the opening user message → would produce a real title. Therefore
**backfill never ran**: share returned HTTP 200 because a (partial) task row
already existed, so the `TaskNotFoundError` branch was never entered.

### The flawed gate

`CloudService.shareTask` (`packages/cloud/src/CloudService.ts:315`) backfills the
full local history **only** inside `catch (TaskNotFoundError)` — i.e. only when
the server has _no_ row at all:

```ts
try {
	return await this.shareService!.shareTask(taskId, visibility)
} catch (error) {
	if (error instanceof TaskNotFoundError && clineMessages) {
		await this.telemetryClient!.backfillMessages(clineMessages, taskId)
		return await this.shareService!.shareTask(taskId, visibility)
	}
	throw error
}
```

When a **partial** row already exists (the bridge connected mid-task and captured
only the later messages, while the offline-run opening turns were never
uploaded), share succeeds, backfill is skipped, and the partial copy is what gets
shared. `CloudService.test.ts:511` ("without retry when successful") codifies the
current assumption that a successful share needs no backfill.

Inferred (not observed in a live DB): the specific reason the server copy was
partial is the bridge timing above. The fix is independent of that cause — it
uploads the authoritative full local history regardless of why the server copy
was incomplete.

## Fix

The extension holds the **authoritative, complete** history for its own task
(`provider.getCurrentTask().clineMessages`). `backfill_messages` is idempotent —
it deletes and re-inserts the task's rows — so it is safe to call on every share.

Change `CloudService.shareTask` to **backfill the full local history first**
(when messages are available), then share. Keep the `TaskNotFoundError` retry as
a fallback, since `backfillMessages` swallows its own network errors and may have
silently no-op'd:

```ts
public async shareTask(taskId, visibility = "organization", clineMessages?) {
  this.ensureInitialized()

  // The extension is the source of truth for its own task. The server copy may
  // be absent (task ran while the backend was unreachable) or partial (the live
  // bridge connected mid-task and only captured later messages). Upload the full
  // local history before sharing so the shared view shows the whole conversation
  // and a real title — not just the api_req_started fragments. backfillMessages
  // replaces the task's stored rows, so this is safe on every share.
  if (clineMessages?.length) {
    await this.telemetryClient!.backfillMessages(clineMessages, taskId)
  }

  try {
    return await this.shareService!.shareTask(taskId, visibility)
  } catch (error) {
    if (error instanceof TaskNotFoundError && clineMessages?.length) {
      // backfill above is best-effort (it swallows network errors); retry once.
      await this.telemetryClient!.backfillMessages(clineMessages, taskId)
      return await this.shareService!.shareTask(taskId, visibility)
    }
    throw error
  }
}
```

Behavior when `clineMessages` is not provided (programmatic callers) is unchanged:
no up-front backfill, original 404 path applies.

## Files

- `packages/cloud/src/CloudService.ts` — reorder backfill to run before share.
- `packages/cloud/src/__tests__/CloudService.test.ts` — update the
  "successful share" case to expect one up-front `backfillMessages` call; keep
  the 404-retry and no-messages cases (adjust call counts).

## Trade-off

Every explicit share now uploads the full `task.json` once, even when the server
already had it via live streaming. Acceptable for a user-initiated action, and
the only way to guarantee completeness without an extra "what does the server
have?" round-trip. Correctness over a micro-optimization.

## Verification

- Unit: `pnpm --filter @roo-code/cloud test` (CloudService share suite).
- Manual: run a task with the backend down, start the backend, share → shared
  page shows full conversation + real title (not "Untitled task").
