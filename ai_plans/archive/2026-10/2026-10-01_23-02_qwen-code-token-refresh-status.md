# Qwen Code token refresh: carry the HTTP status, write credentials atomically

Status: done (branch `fix/qwen-code-token-refresh-status`), simplification round 2 item A11.

## Touched files

- `src/api/providers/qwen-code.ts`
- `src/api/providers/__tests__/qwen-code-token-refresh.spec.ts` (new)
- `.changeset/qwen-code-token-refresh-status.md`

## Problem

1. `doRefreshAccessToken` (`src/api/providers/qwen-code.ts:137-140` on origin/main) threw a plain `Error` for a
   failed refresh. The task retry loop decides with `getApiErrorStatus` / `isAutoRetryableApiError`
   (`src/api/apiErrors.ts:57,112`): an error without a numeric `status` is always auto-retried, so a dead refresh
   token made a foreground task retry the same failing refresh forever (and a background task burn its retry
   cap) instead of stopping at the 401 rule that asks the user.
2. The refreshed credentials were written with `fs.writeFile` (line 158), in place. The file
   (`~/.qwen/oauth_creds.json`) is shared with the Qwen Code CLI; a crash mid-write leaves a truncated JSON file
   that both programs then fail to parse.

## Fix

1. The refresh error now carries `status`. Qwen Code's own client
   (`QwenLM/qwen-code`, `packages/core/src/qwen/qwenOAuth2.ts`, the `response.status === 400 || 401` branch)
   treats a 400 from the token endpoint as "refresh token expired or invalid, sign in again", the usual OAuth
   `invalid_grant` answer. Our retry loop retries 400, so a 400 from the token endpoint is reported as 401; every
   other status is passed through unchanged (403 stays 403, 5xx stays retryable). The message keeps the real
   status. Credentials are not cleared (the file belongs to the Qwen CLI too).
2. The write uses `safeWriteJson` from `@roo-code/core/fs`: temp file, fsync, rename, under a lock, and it
   re-applies the existing file mode (so 0600 stays 0600). The JSON is now tab-indented instead of 2 spaces;
   both clients parse it.

Expiry margin: unchanged at 30 s. Codex uses 5 min, but Qwen Code's own `sharedTokenManager.ts` uses
`TOKEN_REFRESH_BUFFER_MS = 30 * 1000`; since both programs share the file, matching the Qwen client is the
convention that matters, and the 401 path still refreshes a token that dies early.

## Tests

`qwen-code-token-refresh.spec.ts` (real temp dir, stubbed `fetch`, mocked OpenAI SDK):

- refresh answered 401 / 400 / 403 / 503: rejection status 401 / 401 / 403 / 503, `isAutoRetryableApiError`
  false except for 503, no chat request made;
- successful refresh: file content updated, mode 0600 kept, inode changed (replaced by rename, not rewritten in
  place), no temp or lock file left.

Both tests fail on origin/main (status undefined; same inode). Existing `qwen-code-native-tools.spec.ts` green.

## Notes

- A refresh answered with HTTP 200 and an `error` field in the body still throws without a status (no HTTP status
  to carry; not observed in practice).
- "No refresh token available" (local file problem) also stays without a status.
