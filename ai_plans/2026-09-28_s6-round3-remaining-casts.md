# S6 round 3: the remaining `as any` casts in `src`

Continuation of [S6 round 2](2026-09-28_s6-round2-src-type-safety.md), whose
"Remaining" list this round works through. Branch
`refactor/s6-round3-remaining-casts`, from `origin/main` at `996fd30db`.

Scope: `src/` non-spec files. Left alone on purpose: `src/core/config`
migrations and `src/core/task-persistence/apiMessages.ts` (another helper
works there), and the five casts round 2 already justified.

## How the numbers were counted

The same TypeScript-compiler-API counter as rounds 1 and 2 (not grep), over
every `.ts` file under `src/` except `__tests__/`, `node_modules`,
`*.spec.ts`, `*.test.ts` and `.d.ts`:

- **as any**: an `AsExpression` whose type is exactly `any`.
- **empty catch**: a `catch` clause with no statements, plus a
  `.catch(() => {})` callback with an empty body, split into "bare" (nothing
  in the body) and "commented".

## Counts (whole `src`, non-spec)

| Category                                    | Before (`996fd30db`) | After |
| ------------------------------------------- | -------------------: | ----: |
| `as any`                                    |                   29 |     9 |
| empty catch, all kinds                      |                   82 |    81 |
| of which `.catch(() => {})` with no comment |                    2 |     1 |
| `error: any` parameters in `RetryHandler`   |                    4 |     0 |
| `error: any` parameters in `TaskApiLoop`    |                    1 |     0 |

`as any` before, per file: `ClineProvider` 6, `lite-llm` 4, `openrouter` 2,
`xai` 2, `openai-format` 6, plus the 9 that stay. Round 2 counted 35 on
`86ca2492b`; main dropped to 29 in between (`extension/api.ts`).

The 9 left:

- The 5 justified in round 2: `openai-native` x2 and `openai-codex` x1
  (`client.responses.create(body)`, TS2769 without the cast) and
  `extension/bridge.ts` x2 (untyped bridge key/value pairs).
- `__mocks__/fs/promises.ts` x4: test infrastructure.

The remaining bare `.catch` is `memoryTaskIntegration.ts:57`, explained by
the comment block right above it (round 2 left it for that reason).

## What changed

### `ClineProvider.ts` (6 casts, 1 bare `.catch`)

- `emit` forwarding for the delegation host and the task-event forwarding
  host (`this.emit(event as any, ...(args as any))`) and the `on`/`off`
  overrides (`listener as any`). Cause: Node's `EventEmitter<T>` types its
  parameters with a conditional type (`K extends keyof T ? T[K] : never`)
  that TypeScript cannot resolve for a generic key `K`, so a correctly typed
  `K` plus `TaskProviderEvents[K]` is still rejected (TS2345, verified).
  Fix without a cast:
    - a private getter `untypedEmitter: EventEmitter` returns `this` (a plain
      assignment, no cast) and both hosts emit through it;
    - `on`/`off` call `EventEmitter.prototype.on/off.call(this, ...)` and
      return `this` (what `super.on` did). They cannot use `untypedEmitter`,
      which would dispatch back into the override.
- `DelegationHost.emit` is now typed
  `emit<K extends keyof TaskProviderEvents>(event: K, ...args: TaskProviderEvents[K])`,
  so the three `DelegationService` call sites are checked against the event
  table (they already matched).
- `subagentRegistry`'s webview push: `.catch(() => {})` logs at
  `logger.debug` (the round 2 convention).

### Vendor fields on OpenAI messages (`lite-llm`, `openrouter`, `openai-format`)

- `openai-format.ts` exports `AssistantMessageWithReasoning` (OpenAI
  assistant message + `reasoning_details?: ReasoningDetail[]`) and has a
  local `MessageParamWithReasoning` (a stored Anthropic message that may
  carry `reasoning_details`). `sanitizeGeminiMessages` and
  `convertToOpenAiMessages` read the fields through them; the role check
  already narrows `msg`, so `tool_calls`, `content` and `tool_call_id` need
  no cast at all. `sanitizedMsg: any` became `AssistantMessageWithReasoning`.
- `openrouter.ts`: the Gemini fake-encrypted-block injection uses the same
  type; the fake block is a `ReasoningDetail`.
- `lite-llm.ts`: `ToolCallWithProviderFields` (tool call +
  `provider_specific_fields`) for the Gemini thought signature, and a
  `withEphemeralCache(part)` helper that returns
  `{ ...part, cache_control: { type: "ephemeral" } }` (same keys in the same
  order as the three object literals it replaces).

### `xai.ts` (2 casts)

`requestBody` is already `Record<string, any>`, so neither the
`tool_choice` cast nor the `responses.create({...requestBody, stream: true} as any)`
cast was needed: tsc accepts both without them.

### `error: any` in `RetryHandler` and `TaskApiLoop`

`calculateBackoffDelay`, `buildErrorHeaderText`, `backoffAndAnnounce`,
`handleApiRequestError` and `TaskApiLoop.handleStreamError` take
`error: unknown`. The reads go through narrow local shapes
(`GoogleRetryInfoError`, `{ status?, message? }`) with the same optional
chaining as before. The duplicated
`error.message ?? JSON.stringify(serializeError(error), null, 2)` is one
exported helper, `apiErrorDisplayText`, used by both files.

## Findings (reported, not fixed)

- `apiErrorDisplayText` (like the code it replaces) reads `.message` without
  a null check: a caught `null`/`undefined` would throw a `TypeError` in the
  `api_req_failed` path. No provider throws `null`, so this is latent; kept
  identical on purpose.
- `calculateBackoffDelay` honours Google's RetryInfo only when the error has
  `status === 429`, not `statusCode` or the other fields
  `getApiErrorStatus` knows. RetryInfo is a Google-only field and Google
  errors use `status`, so it is not a bug; pinned by a test.
- `xai.ts` sends Chat Completions' `tool_choice` to the Responses API. The
  shapes differ only for a named-function choice, and every caller passes
  `"auto"` (`TaskApiLoop`, `TaskContextManager`), so nothing breaks today.

No real bug found.

## Tests

- Commit 1 (characterization, passes on main unchanged):
    - `RetryHandler.error-shapes.spec.ts` (new, 14 tests): header text for
      each error shape, RetryInfo backoff (429 only, whole seconds only,
      `status` only), the `api_req_failed` text (message, else serialized).
    - `openrouter.spec.ts` +2: the Gemini fake encrypted block is appended
      to a tool-call message without one and not to one that has it.
    - `ClineProvider.spec.ts` +2: `provider.on`/`off` round trip for a
      forwarded task event; the delegation host's `emit` reaches provider
      listeners.
- Commit 2: the casts removed, the same specs green.
- Run with `--maxWorkers=2`: `lite-llm`, `openrouter`, `xai`,
  `openai-format`, `RetryHandler*`, `TaskApiLoop*`, `grace-retry-errors`,
  `ClineProvider*` (17 files), `DelegationService`, `taskEventForwarding`,
  `SubagentRegistry`: 36 files, 653 tests, all green. tsc clean, eslint
  clean on touched files.
