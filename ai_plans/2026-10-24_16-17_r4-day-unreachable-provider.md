# r4-day: CLI silent on an unreachable provider

Status: done (branch `fix/r4-day-cli-unreachable-provider`)

Related plans: `ai_plans/2026-10-23_17-20_maintenance-audit-round-4.md` (day wave)

## Touched files

- `src/api/providers/utils/error-handler.ts` (+ spec), `src/api/providers/__tests__/openai-unreachable-host.spec.ts`
- `packages/core/src/backoff.ts` (`UNATTENDED_MAX_API_RETRIES`), `src/core/task/RetryHandler.ts`
- `apps/cli/src/agent/api-retry.ts` (+ test), `transcript-reducer.ts`, `transcript-printer.ts`, `extension-host.ts`,
  `apps/cli/src/commands/cli/run.ts`, print-mode characterization scenario "automatic retry"

## Problem

`tumble -p` against an OpenAI-compatible base URL that cannot be reached wrote nothing to stdout or stderr and
never exited. Evidence (installed CLI, temp HOME, `--debug` log with timestamps):

- Closed port (`http://127.0.0.1:59999/v1`): the SDK fails in about 1.3 s per request (its own 2 retries), the core
  answers with `api_req_retry_delayed` countdowns of 5, 10, 20, 40, 80 s... The waits ran exactly on that ladder.
- Blackhole (`http://10.255.255.1:11111/v1`): undici's 10 s connect timeout fires, the SDK retries twice and throws
  `Request timed out.` after about 33 s, then the same countdowns. So a connect timeout exists; nothing hangs in
  the network layer.
- `RetryHandler` retries a foreground task with auto-approval forever (only background tasks are capped).
- Print mode printed nothing for `api_req_retry_delayed` (the printer only writes answer, reasoning, command output,
  error and completion rows), so the whole retry loop was invisible.
- The error text was only `OpenAI completion error: Connection error.`: the SDK keeps the socket error
  (`connect ECONNREFUSED 127.0.0.1:59999`, `Connect Timeout Error (attempted address: ..., timeout: 10000ms)`) in
  `error.cause.cause`, and `handleProviderError` dropped it. The TUI showed that bare line as an assistant bullet.

## Change

- `handleProviderError` appends the innermost `cause` message unless the message already contains it. This covers
  every provider that throws through it.
- The CLI transcript reducer turns an `api_req_retry_delayed` say into a faint system row
  `API request failed: <error> - retrying in N s` (`retrying now` once the countdown ends). The TUI renders it
  live; print mode writes it to stderr once per retry as `[retry] ...`.
- The background retry cap moves to `@tumble-code/core/backoff` as `UNATTENDED_MAX_API_RETRIES` (6). An
  unattended print or JSON run (`ExtensionHostOptions.unattended`, formerly `exitOnApiRequestFailed`) fails
  `runTask` at the 7th failed attempt of one request (`UnattendedRetryCap`: a new `api_req_started` restarts the
  count, a 429 never counts, like in the core), so the CLI exits 1. At the default 5 s base a closed port gives up
  after about 325 s, a blackhole after about 9.5 min. A host that connects but never answers is bounded by the
  existing stream idle timeout (`apiRequestTimeout`, default 600 s) per attempt.

## Tests

- `error-handler.spec.ts` "network failure cause": refused, connect timeout, cause already in the message.
- `openai-unreachable-host.spec.ts`: real OpenAI SDK, stubbed `fetch` failing like undici, fake timers.
- `api-retry.test.ts`: retry text, cap at the 7th attempt, update of one retry counted once, reset on a new
  request, 429 not counted. `extension-host.test.ts`: an unattended run rejects at the 7th attempt and not before.
- Print-mode characterization "automatic retry": the stderr line.
- Mutations (each turned a test red, then restored): no root cause append; no duplicate check; cap `<` instead of
  `<=`; 429 counted; no reset on a new request; printer branch removed; reducer keeps raw text; host wiring off.
- Real runs of the worktree CLI (no model server): print mode prints the retry lines with the timestamps of the
  ladder and exits 1 after the 7th attempt; the TUI under `script` shows the row with its countdown.

## Notes

- JSON output still skips retry messages (`SKIP_SAY_TYPES`); its run fails the same way through `runTask`.
