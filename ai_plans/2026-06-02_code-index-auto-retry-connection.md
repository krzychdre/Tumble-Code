# Auto-retry codebase indexing on connection errors

Date: 2026-06-02
Branch: `fix/code-index-auto-retry-connection`
Primary file: `src/services/code-index/manager.ts`
Supporting: `src/services/code-index/state-manager.ts`, `src/services/code-index/shared/validation-helpers.ts`

## Symptom

When the embedder backend (e.g. a local `llama.cpp` / OpenAI-compatible server) is
intermittently unavailable, codebase indexing enters the `Error` state and **stays
there permanently**. The only way to recover today is the manual loop:

> disable indexing → save → enable indexing → trigger indexing again.

In a local dev environment the embedder is frequently down, so the user is forced to
do this by hand every time the connection drops.

## Root cause (proven from code, not assumed)

There is **no automatic recovery** from the `Error` state. Evidence:

1. `manager.recoverFromError()` (manager.ts:278-302) only clears services + sets
   `Standby`. Its own doc comment says: _"Does not restart indexing automatically -
   call initialize() after recovery"_. Nothing calls it on a timer.

2. The `Error` state is set in 5 places, all terminal:

    - `orchestrator.ts:347` — `setSystemState("Error", failedDuringInitialScan)` after the
      scan throws (this is the connection-failure path: embedder/Qdrant unreachable).
    - `orchestrator.ts:101` — no workspace.
    - `orchestrator.ts:409` — clear-collection failure.
    - `manager.ts:405` — `_recreateServices()` when `validateEmbedder()` fails (the
      embedder validation path; connection failures here surface as the localized
      `embeddings:validation.connectionFailed`).
    - `search-service.ts:62` — search failure.

3. Existing retry logic is **only per-batch** inside the scan
   (`scanner.ts` MAX_BATCH_RETRIES=3, exp backoff). Once those 3 are exhausted the
   batch error bubbles up, the orchestrator catches it, sets `Error`, and the whole
   process is done — no outer/connection-level retry exists.

4. How connection failures look in the final `Error` message:
    - Embedder validation: exactly `t("embeddings:validation.connectionFailed")`
      (via `validation-helpers.ts:174-184` matching `ECONNREFUSED`/`ENOTFOUND`/
      `ETIMEDOUT`/`AbortError`/`HTTP 0:`/`No response`).
    - Scan failure: `Failed during initial scan: Indexing failed: Failed to create
embeddings after 3 attempts: <raw>` where `<raw>` carries the network signature
      (OpenAI SDK `Connection error.`, `fetch failed`, `ECONNREFUSED`, …).
    - Qdrant down: `...qdrantConnectionFailed...`.

## Fix

Automate the manual disable/enable/trigger loop **only for connection/transient
errors**, inside `CodeIndexManager`, with exponential backoff.

### 1. Classify connection errors — `validation-helpers.ts`

Add `isTransientConnectionError(message: string): boolean`. Matches:

- raw signatures: `ECONNREFUSED`, `ECONNRESET`, `ENOTFOUND`, `ETIMEDOUT`, `EAI_AGAIN`,
  `ECONNABORTED`, `EPIPE`, `socket hang up`, `fetch failed`, `network`, `timeout`,
  `Connection error`, `HTTP 0:`, `No response`.
- localized strings (current locale, via `t()`): `validation.connectionFailed`,
  `validation.serviceUnavailable`, `vectorStore.qdrantConnectionFailed`.

Case-insensitive substring match. Keeps the retry gated to _recoverable_ failures so a
genuine misconfig (auth 401/403, wrong model/dimension) does **not** spin forever.

### 2. Auto-retry scheduler — `manager.ts`

- Store `_contextProxy` on first `initialize()` so the retry can re-init without the
  webview (it currently must pass `provider.contextProxy`). `recoverFromError()` keeps
  `_contextProxy` (it only clears the 4 service instances).
- Subscribe (in constructor) to `_stateManager.onProgressUpdate`:
    - `systemStatus === "Error"` + feature & workspace enabled + configured +
      `isTransientConnectionError(message)` + no timer pending → `_scheduleAutoRetry()`.
    - `systemStatus === "Indexing" | "Indexed"` → success/progress: reset attempt
      counter + cancel any pending timer.
- `_scheduleAutoRetry()`: single-timer guard; `delay = min(MAX, INITIAL * 2^attempt)`;
  `INITIAL = 5_000`, `MAX = 300_000`; on fire → `attempt++` → `_performAutoRetry()`.
- `_performAutoRetry()`: bail if not enabled / already Indexing-Indexed / no
  contextProxy; else `await recoverFromError()` then `await initialize(_contextProxy)`
  (initialize recreates services and auto-starts indexing via its existing
  `shouldStartOrRestartIndexing` path). Wrap in try/catch — a repeat failure just
  re-enters `Error`, the subscription reschedules with larger backoff.
- Cancel the timer in: `stopIndexing()`, `dispose()`, and `handleSettingsChange()`
  when the feature is disabled. Dispose the subscription in `dispose()`.

### 3. Status feedback (optional, low-risk)

When scheduling, keep state `Error` but augment the message with a retry note so the
user sees "retrying" rather than a dead error. Guarded by the single-timer check so it
does not re-trigger scheduling.

## Tests

`src/services/code-index/__tests__/manager.spec.ts` (or new
`manager.auto-retry.spec.ts`):

- transient `Error` schedules a retry; non-transient (auth) does not.
- backoff doubles up to the cap.
- successful retry (state → Indexing/Indexed) resets attempt + cancels timer.
- `stopIndexing` / disable / dispose cancel a pending retry.
- `validation-helpers` unit tests for `isTransientConnectionError` true/false cases.
  Use fake timers.

## Out of scope

- The file-watcher batch retry already exists; unchanged.
- No UI/settings additions (retry is automatic, always-on for connection errors).
