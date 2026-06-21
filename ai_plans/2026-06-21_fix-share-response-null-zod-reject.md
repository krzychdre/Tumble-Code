# Fix: "Failed to share task" on HTTP 200 (share response serializes `error: null`)

**Date:** 2026-06-21
**Branch:** `feature/self-hosted-remote-task-control`

## Symptom (user's words)

> "I got 'Failed to share task' despite the backend returns 200 and I can see the
> task on backend webview."

## Root cause (proven with evidence)

A Zod-rejects-`null` mismatch — the **same class of bug** already fixed for the
settings endpoint (see `project_self_hosted_settings_exclude_none` memory /
`ai_plans/2026-06-20_fix-share-button-disabled-null-settings.md`).

Chain:

1. `CloudAPI.shareTask` parses the 200 body with `shareResponseSchema.parse(data)`
   (`packages/cloud/src/CloudAPI.ts:117`). A `ZodError` makes the call throw.
2. `webviewMessageHandler.ts:873-875` catches any throw and shows
   `common:errors.share_task_failed` = **"Failed to share task."**
3. `shareResponseSchema` (`packages/types/src/cloud.ts:223-229`) marks every
   optional field with `.optional()`. Zod `.optional()` accepts `undefined` but
   **rejects `null`**.
4. Backend `ShareResponse` (`self-hosted-cloudapi/src/schemas/share.py`) has
   `error: Optional[str] = None` and **no `exclude_none`**. On the success path it
   serializes `"error": null` (plus camelCase via `serialize_by_alias`). The route
   `@router.post("/share")` (`routers/extension.py:22`) lacked
   `response_model_exclude_none=True`, unlike `/api/extension-settings`
   (`routers/settings.py:29`, which carries a comment documenting exactly this).
5. `"error": null` → Zod parse throws → catch → "Failed to share task".

Why the task is still visible on the webview: the `404 → /api/events/backfill →
re-share` pipeline already persisted the `Task`/`TaskMessage`/`TaskShare` rows. Only
the **final share response fails to parse on the client** — the user sees an error
for an operation that actually succeeded server-side.

### Ruled out

- Not an HTTP status problem (it's a 200) and not the auth/`exclude_none` settings
  bug from 06-20 (that disabled the button; here the button works and the request
  reaches the server). Distinct endpoint, same null-vs-`.optional()` contract.

## Fix

`self-hosted-cloudapi/src/routers/extension.py`: add
`response_model_exclude_none=True` to the `/share` route decorator, mirroring
`routers/settings.py`. One-line change + explanatory comment. No client change —
keeps the existing Zod contract intact.

## Verification

- Regression test in `tests/test_web_and_share.py`: share an existing task →
  assert 200 and that the JSON body contains **no `null` values** and omits the
  `error` key entirely on success, so the client Zod schema parses it.
- Full `uv run pytest`.

## Risk / rollback

Additive serialization flag, scoped to one route; revert the decorator to roll back.

## Status — 2026-06-21: FIXED & VERIFIED

- `routers/extension.py`: `/share` route now `response_model_exclude_none=True` + comment.
- `tests/test_web_and_share.py`: added `test_share_existing_task_response_has_no_null_fields`.
- Proof the test catches the regression: with the flag removed it fails with
  `found: ['.error']` (the `error: null` that breaks the client Zod parse); with the
  flag it passes. Full suite **52 passed** (was 51).
- **Restart the backend** to pick up the change (FastAPI route is read at import).
