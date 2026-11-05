# Max concurrent requests counts every request to the model

**Status:** done on `feat/model-request-limit-global` (stacked on `feat/subagents-max-20-no-limit`)
**Related plans:** `2026-11-05_19-40_subagents-max-20-no-limit.md`
**Touched:**

- `src/api/model-request-limiter.ts` (new): `ModelRequestLimiter`, `limitModelRequests()`
- `src/api/index.ts`: `buildApiHandler` routes every handler through `limitModelRequests`
- `src/api/__tests__/model-request-limiter.spec.ts` (new), `runtime-provider-registry.spec.ts` (mock handlers get `createMessage`)
- `webview-ui/src/i18n/locales/*/settings.json`: `providers.maxConcurrentRequests.description`
- comments and docs: `packages/types/src/provider-settings.ts`, `MaxConcurrentRequestsControl.tsx`,
  `apps/cli/src/types/types.ts`, `apps/cli/src/lib/utils/model-settings.ts`, `apps/cli/README.md`,
  `docs/04-tools-and-providers.md`

## Request

Each model (especially one served locally) has a fixed context and so serves a fixed number of
sessions at once. The per-model setting must be global: every request to the model counts, and it
stays above the subagent count. Works in the VS Code profile GUI and in the CLI JSON.

## What was happening

`maxConcurrentRequests` (PR #912) only capped subagents, in `SubagentSlotPool`, which belongs to
one `ClineProvider` (one panel). The main tasks were not counted beyond "the parent takes one",
and nothing was shared between panels: three editor tabs on one local model with a limit of 2
could send 6 requests at once; detached tasks and side queries (condense, memory writer, enhance)
were not counted at all.

## Fix

- Every request handler comes from `buildApiHandler`. It now wraps the handler's `createMessage`
  (held for the whole stream, released in `finally`, so an early `iterator.return()` frees it)
  and its one-shot completion. One process-wide `ModelRequestLimiter` counts requests in flight
  per `provider:modelId`; a request whose model already runs `maxConcurrentRequests` of them
  waits, first in, first out among those that fit.
- Requests of profiles without a limit are counted too, so a limited profile sees them.
- Only `completePromptWithUsage` is wrapped when a provider has it: every provider's
  `completePrompt` calls it, and wrapping both would take two slots for one request and, with a
  limit of 1, wait for itself. `completePrompt` is wrapped only when it is the sole method.
- A waiting request honours the request's abort signal (Stop) and rejects with
  `ModelRequestWaitAbortedError` without taking a slot.
- The subagent arithmetic (`subagentSlotsForProfile`) stays: it refuses a fan-out that could
  never start and keeps a slot for the parent's next request.

No deadlock with a parent waiting for subagents: tool calls run while the stream is read, and the
parent's stream ends on its own, so a parent waiting in `wait_for_subagents` holds no slot.

## Failure surface (before/after)

| Scenario                                                   | Before                    | After                           |
| ---------------------------------------------------------- | ------------------------- | ------------------------------- |
| 3 editor tabs, same local model, limit 2                   | up to 6 requests at once  | at most 2, the rest wait        |
| Detached task + foreground task + condense on one model    | not counted               | counted                         |
| Profile without a limit and a limited profile on one model | unlimited one not counted | counted against the limited one |
| Stop while waiting for a slot                              | n/a                       | rejects at once, no slot taken  |
| Two CLI processes on one server                            | not shared                | still not shared (per process)  |

## Tests

`model-request-limiter.spec.ts`: wait at the limit across handlers and request kinds; an
unlimited profile counts against a limited one; another model is not blocked; `completePrompt`
takes one slot (no self-wait at limit 1); early `return()` frees the slot; abort while waiting;
`buildApiHandler` wires the limiter (through the `fake-ai` provider).
Verified red by mutation: no release in `finally` (5 red), wrapping both completion methods
(1 red), a key without the model id (4 red).

## Caveats

- The count is per process: one VS Code window, or one CLI run. Separate windows or CLI runs on
  the same server do not share it.
- The key is provider plus model id, not the base URL: two servers of the same provider that
  serve the same model id share one count.
