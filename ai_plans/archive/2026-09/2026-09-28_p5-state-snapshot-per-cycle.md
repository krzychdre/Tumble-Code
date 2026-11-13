# P5 — one state snapshot per request cycle

Roadmap item P5 from `ai_plans/2026-09-27_simplification-roadmap.md`:

> **`getState()` runs six to eight times per request cycle** (request cycle, attempt, both retry paths, request builder, context manager), each reading custom modes, cloud facts and command lists.
> Fix: **Build one state snapshot per cycle and pass it down.**

This is a performance refactor: the same data must reach each consumer, but the
call count changes by design. Base: `main` @ `51b709e7f`.

## 1. Call-site inventory (file:line at 51b709e7f)

What one `getState()` costs — `ProviderStateBuilder.getState()`
(`src/core/webview/ProviderStateBuilder.ts:285`): reads all settings values,
**awaits `getCustomModes()`** (file read + parse), **awaits `readCloudFacts()`**
(7 cloud service calls, 3 awaited), resolves the **allowed/denied command lists**
(two `vscode.workspace.getConfiguration().inspect()` reads), applies
`resolveSettings`. So each call is a settings read + file I/O + cloud queries.

The request-cycle path (one iteration of the `while (stack.length > 0)` loop in
`recursivelyMakeClineRequests`), in execution order:

| #   | Site                                                                                                                    | What it consumes                                                                                                                                                                                                                        | Reads per cycle                                                                                                                  |
| --- | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `RetryHandler.maybeWaitForProviderRateLimit` — `RetryHandler.ts:293`                                                    | `apiConfiguration.rateLimitSeconds` (via `providerRateLimitDelaySeconds`)                                                                                                                                                               | 1 (per attempt: called from `executeApiRequestCycle:507` **and** again inside `attemptApiRequest` when `!skipProviderRateLimit`) |
| 2   | `TaskApiLoop.executeApiRequestCycle` — `TaskApiLoop.ts:518`                                                             | `showRooIgnoredFiles`, `includeDiagnosticMessages`, `maxDiagnosticMessages` (mentions), `customModes` (slash-command mode switch)                                                                                                       | 1                                                                                                                                |
| 3   | `getEnvironmentDetails` (called from `prepareUserContent:641` and from context manager) — `getEnvironmentDetails.ts:60` | `maxWorkspaceFiles`, `maxOpenTabsContext`, time/cost/todo flags                                                                                                                                                                         | 1                                                                                                                                |
| 4   | `TaskApiLoop.attemptApiRequest` — `TaskApiLoop.ts:1233`                                                                 | `apiConfiguration`, `autoApprovalEnabled`, `requestDelaySeconds`, `autoCondense*`, `profileThresholds`, `customSupportPrompts.CONDENSE`, plus the whole `state` handed to context management / auto-approval limits / `buildToolsArray` | 1 (per attempt)                                                                                                                  |
| 5   | `ApiRequestBuilder.buildSystemPrompt` — `ApiRequestBuilder.ts:125`                                                      | `mcpEnabled` gate (`isMcpEnabledForPrompt`)                                                                                                                                                                                             | 1                                                                                                                                |
| 6   | `ApiRequestBuilder.buildSystemPrompt` — `ApiRequestBuilder.ts:144`                                                      | the full state → `buildSystemPromptInput` (custom modes, custom instructions, experiments, command lists, cloud facts …)                                                                                                                | 1                                                                                                                                |
| 7   | `TaskApiLoop.handleEmptyAssistantResponse` — `TaskApiLoop.ts:1053`                                                      | `autoApprovalEnabled`                                                                                                                                                                                                                   | only on empty response                                                                                                           |
| 8   | `TaskApiLoop.handleStreamError` (mid-stream backoff branch) — `TaskApiLoop.ts:1184`                                     | `autoApprovalEnabled`                                                                                                                                                                                                                   | only on stream failure                                                                                                           |
| 9   | `RetryHandler.backoffAndAnnounce` — `RetryHandler.ts:264`                                                               | `requestDelaySeconds`, `apiConfiguration.rateLimitSeconds`                                                                                                                                                                              | only on retry                                                                                                                    |
| 10  | `TaskContextManager.handleContextWindowExceededError` — `TaskContextManager.ts:402`                                     | `profileThresholds`, `apiConfiguration`, custom modes/tools/prune flags                                                                                                                                                                 | only on context-window error                                                                                                     |

Additionally `TaskAskSay.ask()` (`TaskAskSay.ts:112`) reads state for
auto-approval decisions — deliberately **excluded** (see §2).

Happy-path count today (first attempt, no errors): sites 1(×2: once at 507 with
`skipProviderRateLimit` still calling `getState` first, once at 1233 → the 507
call passes `skipProviderRateLimit: true` to the generator, so the generator's
site-1 read is skipped; net 1), 2, 3, 4, 5, 6 = **6 reads per cycle**, plus 1
more whenever `condenseContext`/`manageContextIfNeeded` call
`getEnvironmentDetails` again. On retries, error paths add sites 7–10. That
matches the roadmap's "six to eight".

## 2. Volatility classification (evidence)

The rule from S3 (`isBackground` must stay a live getter): **do not snapshot
anything that can legitimately change mid-cycle**. Who writes each field and
when:

### (a) Cycle-stable — snapshot once at cycle start

- **Settings values** (`showRooIgnoredFiles`, `includeDiagnosticMessages`,
  `maxDiagnosticMessages`, `maxWorkspaceFiles`, `maxOpenTabsContext`,
  `includeCurrentTime/Cost`, `requestDelaySeconds`, `autoApprovalEnabled`,
  `autoCondenseContext(Percent)`, `profileThresholds`, `customSupportPrompts`,
  `disabledTools`, `webToolsEnabled`, `experiments`, command lists, `mcpEnabled`,
  prune flags, `rateLimitSeconds` …): written only by user actions in the
  Settings webview / mode selector / webview messages. All of those go through
  `ContextProxy` and `postStateToWebview` **on the UI side**; a change arrives
  at the earliest as a _new user turn_ or an ask answer — both of which end or
  interrupt the current streamed response (ask = blocking; settings change
  mid-stream only affects the _next_ cycle, exactly as today: sites 5/6 already
  re-read after the MCP wait, and any change landing between site 2 and site 6
  today yields a torn read anyway — different reads see different states).
- **`customModes`**: written by Modes webview / `updateCustomModes`, same
  user-action boundary. Also re-read on purpose **after a slash-command mode
  switch** (see (c)).
- **Cloud facts** (`cloudIsAuthenticated`, `sharingEnabled`, …): read from
  `CloudService`, cached/async; no writer inside a cycle. Nothing in the cycle
  path consumes them except through the snapshot-able state hand-off
  (`buildSystemPromptInput` gets the whole state but only reads settings-ish
  keys).
- **`apiConfiguration`**: one caveat — `handleModeSwitch` /
  `setProviderProfile` (user actions, `Task.submitUserMessage:1257-1275`) can
  change the active profile. Those run **between** cycles (they complete before
  the user message that triggers the cycle is submitted). Within one cycle the
  only state writer is the mode switch in `prepareUserContent` itself — covered
  by the refresh rule in (c).

### (b) Volatile — stay live reads (NOT in the snapshot)

- **`abort`, `abandoned`, `isBackground`, `abortReason`**: flipped by user Stop,
  `cancelCurrentRequest`, specs post-construction (S3 lesson, pinned in
  `TaskApiLoop.ts:269-279` comments). Already live getters on the Access seams.
- **Post-stream decisions** (`handleEmptyAssistantResponse` site 7,
  `handleStreamError` site 8): these run _after the response streamed_, possibly
  minutes after cycle start, and their question is "what does the user want
  NOW" (`autoApprovalEnabled` may have been flipped while the user stared at a
  failed request). The ask answer path (`api_req_failed` → user clicks Retry)
  _is_ a user action that changes state; the backoff branch reads
  `autoApprovalEnabled` to decide whether to ask or back off — a stale snapshot
  would answer the wrong question. → **live**.
- **`TaskAskSay.ask()` auto-approval reads**: an ask blocks on the user;
  auto-approval settings can change while the task waits at an earlier ask
  (e.g. `api_req_failed` answered with "Retry" after toggling auto-approve).
  → **live** (no change).
- **`RetryHandler.backoffAndAnnounce` (site 9)**: reads
  `requestDelaySeconds`/`rateLimitSeconds` seconds-to-minutes after cycle start
  (a 429 backoff can be 600 s). A user editing the retry delay during a long
  countdown must affect the _next_ backoff computation; more importantly the
  state here is re-read _per retry attempt_ inside the countdown loop, and each
  `retryRequest` re-entry re-enters `attemptApiRequest` (site 4) which re-reads
  anyway. Keeping site 9 live preserves per-retry freshness at zero cost (it
  only runs on failure). → **live**.
- **`handleContextWindowExceededError` (site 10)**: runs after a failed request;
  `profileThresholds` and the mode's tools may legitimately have been touched
  while the user looked at the error. Runs once per context-window retry, not
  per cycle. → **live**.

### (c) The one legitimate mid-cycle writer: slash-command mode switch

`prepareUserContent` (`TaskApiLoop.ts:630-639`) calls
`provider.handleModeSwitch(slashCommandMode)` when the user's message carries a
slash command with a `mode:` frontmatter. `handleModeSwitch` updates provider
state (mode, per-mode API config). The subsequent `attemptApiRequest` MUST see
the post-switch state — pinned by `build-tools-slim-toolset.spec.ts:77-83`:
"the per-request state read in `TaskApiLoop.attemptApiRequest` is the only
input" that carries the new mode's profile into the tool set.

**Refresh rule**: after `handleModeSwitch` returns, re-snapshot. The snapshot is
built once at cycle start and rebuilt at the two points where the cycle itself
mutates provider state (this is the only one in the cycle path — verified by
grepping `handleModeSwitch|setMode|setProviderProfile|updateCustomModes` inside
`core/task`).

## 3. Design

`CycleState` = one `ProviderState` object (the existing type — no new projection
type to keep in sync), built **once** in `executeApiRequestCycle` right before
`prepareUserContent`, passed down as an explicit parameter through the existing
call chain. No Access-interface member changes needed for the hot path: the
sites are method calls on the loop/builder, not live reads off Access.

- `executeApiRequestCycle`: `const cycleState = provider ? await provider.getState() : undefined`
  at today's site-2 position (`TaskApiLoop.ts:518`), i.e. after the rate-limit
  wait. Ordering vs site 1 is unchanged: the wait at `:507` runs before and
  keeps its own live read inside RetryHandler (see residuals).

- `prepareUserContent(state → cycleState)`: already receives `state` as a
  parameter (site 2's read just stops being re-done). After
  `handleModeSwitch`, `cycleState` is **rebuilt**:
  `cycleState = await provider.getState()` (local `let`), then handed onward.
- `getEnvironmentDetails(this.access as any, includeFileDetails)` → add optional
  `state` param: `getEnvironmentDetails(cline, includeFileDetails, state?)` —
  when provided, use it instead of reading. Called from the cycle with the
  snapshot; the condense/context-manager callers keep the live read (they run
  post-stream, same volatility argument as (b)).
- `attemptApiRequest(retryAttempt, options)` → `options` gains
  `cycleState?: ProviderState`. When present, use it instead of site 4's read.
  When absent (direct calls: Task.spec.ts harnesses, RetryHandler's
  `retryRequest` re-entry), fall back to a live read — **retry re-entries get a
  fresh snapshot** (they may come minutes later, after
  `handleContextWindowExceededError` mutated history; a fresh read there is
  both correct and required by (b)).
- `ApiRequestBuilder.buildSystemPrompt()` → optional `state?: ProviderState` and
  `mcpEnabled` gate param. Signature:
  `buildSystemPrompt(cycleState?: ProviderState)`. When `cycleState` is
  provided: the `isMcpEnabledForPrompt` gate (site 5) uses it, and after the
  MCP-connect wait the post-wait read (site 6) **also** uses it — BUT only if no
  MCP wait happened (see below).
- `getSystemPrompt()` on TaskApiLoop/Task: add optional passthrough param
  (Task's public `getSystemPrompt()` keeps working standalone for
  `condenseContext` and the webview preview with a live read).

**The MCP-wait exception** (site 6's comment at `ApiRequestBuilder.ts:143`:
"Read after the MCP wait above, so settings changed meanwhile are current"):
the MCP wait can take up to 10 s. Settings changed during those 10 s must be
seen — that is a user action racing the prompt build, and the current code
deliberately re-reads. Compromise that keeps both properties:

- If **no** MCP wait ran (`mcpEnabled` false → no `pWaitFor`), the snapshot is
  used for both reads (sites 5+6 collapse to 0 reads).
- If the MCP wait ran (mcp enabled and connecting), keep today's post-wait live
  read (site 6). The gate read (site 5) still uses the snapshot.

That preserves the documented invariant ("settings changed meanwhile are
current" across the 10 s window) at the cost of one live read only when MCP is
enabled and connecting. Normal cycles with MCP off or already connected
(`!mcpHub.isConnecting` → no meaningful wait) use the snapshot throughout.

Hmm — `pWaitFor` runs even when `isConnecting` is false (resolves immediately).
The wait is only "long" when connecting. The exception therefore triggers only
when the wait actually spent time: keep it simple and conservative — **when the
gate passes and a hub exists, keep the post-wait live read**. That leaves one
live read per cycle for MCP users (site 6), zero for MCP-off users, and never
regresses the documented freshness. Recorded as a residual with the option to
tighten later.

**What the snapshot is NOT**: it is not memoized across cycles, not stored on
the Task, not a getter on Access. It's a local `let` in
`executeApiRequestCycle`, passed as arguments. Volatile fields (abort,
isBackground, ask answers) are untouched — they stay live through the existing
Access getters.

### Retry paths

- `retryHandler.handleApiRequestError(... retryRequest ...)`: the `retryRequest`
  closure re-enters `attemptApiRequest(nextAttempt, nextOptions)` WITHOUT
  `cycleState` → fresh live read per retry attempt (matches (b): a retry can
  come after a 600 s backoff or a context-window truncation).
- `maybeWaitForProviderRateLimit` (site 1): takes the cycle snapshot via an
  optional `cycleState` param (it only reads `rateLimitSeconds`, which is
  cycle-stable). It returns the seconds it actually waited; when the countdown
  blocked, the loop re-snapshots afterwards (pre-P5 the cycle read ran after
  the wait, so settings changed during a long countdown were seen — kept).
  Retry re-entries (from inside `attemptApiRequest`) omit the param and read
  live.

### Result

Happy-path `getState()` reads per cycle (MCP off, no rate-limit window):
**6 → 1**. With MCP enabled: one extra live read (the post-connect prompt
build). When the rate-limit countdown actually waited: one extra re-snapshot.
Plus `getEnvironmentDetails` re-reads during condense passes stay live
(post-stream, (b)).

## 4. Test plan

New spec `src/core/task/__tests__/TaskApiLoop.cycle-state-snapshot.spec.ts`,
modeled on `TaskApiLoop.no-auto-retry-auth-errors.spec.ts` / `request-signal.spec.ts`:

1. **Call-count (the P5 regression)**: build a full-cycle harness (real
   `executeApiRequestCycle` via `recursivelyMakeClineRequests`, real
   `getEnvironmentDetails` — `vscode` is mocked in `src` vitest, real
   `ApiRequestBuilder` with `buildToolsArray`/`getSystemPrompt` spied only where
   they hit the provider), spy `provider.getState`, run one full cycle
   successfully, assert `getState` was called **exactly once**. (Before the
   change this harness yields ≥ 6; the spec will be written red first to record
   the before-number, then turned into the assertion of 1.)
2. **Same data reaches consumers**: with a fresh state object per read, assert
   the state the system prompt was built with, the state `getEnvironmentDetails`
   used, and the `apiConfiguration` handed to `createMessage`'s metadata/tools
   all come from the FIRST `getState()` result (same object identity where the
   API allows, or field equality).
3. **Slash-command mode switch refresh**: `processUserContentMentions` returns a
   `mode:` → `handleModeSwitch` → the request build uses the POST-switch state
   (e.g. profile change visible in `buildToolsArray`'s `apiConfiguration`).
   Pins the (c) refresh rule.
4. **Retry freshness**: first-chunk failure with auto-approve → backoff → retry
   re-reads state (call count grows past 1; the retried request's
   `apiConfiguration` reflects a state mutated between attempts).
5. **Post-stream paths stay live**: empty-assistant path reads state at decision
   time (mutate `autoApprovalEnabled` after the stream ends; the decision
   follows the new value).
6. **MCP-wait exception**: with `isMcpEnabledForPrompt` true, the post-wait
   read still happens (call count 2 for an MCP-on cycle).

Existing suites that must stay green (they pin the surrounding contracts):
`TaskApiLoop.no-auto-retry-auth-errors.spec.ts`, `RetryHandler.rate-limit-abort.spec.ts`,
`TaskApiLoop.request-signal.spec.ts`, `build-tools-slim-toolset.spec.ts`,
`Task.spec.ts` (drives `attemptApiRequest(0)` directly — the fallback live read
must keep it green), `grace-retry-errors.spec.ts`, `autocompact-circuit-breaker.spec.ts`,
`microcompact-oscillation.spec.ts`, `TaskContextManager.*.spec.ts`,
`getEnvironmentDetails.spec.ts`, plus the full `core/task` suite.

## 5. Measurement (recorded)

The red run of the spec harness against `main` (`51b709e7f`) measured **5
`getState()` reads per happy cycle** with `getEnvironmentDetails` mocked; the
real module adds its own read, so the true before-count is **6** (matching the
roadmap's "six to eight"). With a slash-command mode switch: **6** in the
harness (**7** real). After the change the same harness measures **1** read
per happy cycle (**2** with a mode switch — the deliberate post-switch
re-snapshot). Two further deliberate live reads can appear per cycle: the
post-MCP-connect prompt read, and the re-snapshot after a rate-limit countdown
that actually waited (added during implementation to preserve the pre-P5
freshness of the cycle read, which ran after the wait). Retry attempts re-read
live per attempt, unchanged. `perfCounters` also counts `getState`
(`ProviderStateBuilder.getState:286`) for a debug-mode cross-check if needed.

## 6. Residuals / deliberate live reads

- Site 1 (`maybeWaitForProviderRateLimit`) — live (runs pre-snapshot; cheap
  field; retry-path reuse).
- Sites 7, 8, 10 + condense-path `getEnvironmentDetails` — live (post-stream
  volatility, §2b).
- Site 9 (`backoffAndAnnounce`) — live (per-retry freshness).
- Site 6 with MCP on — live (documented 10 s freshness invariant).
- `TaskAskSay.ask` — live (user can act during a blocking ask).
- `Task.submitUserMessage` / `TaskLifecycle` / `Task.ts:1272` — outside the
  cycle; untouched.

## 7. Docs

`docs/03-task-agent-loop.md` mentions the request loop; if it describes the
per-attempt state read, add one line that the cycle takes a single state
snapshot at cycle start (refreshed after a slash-command mode switch), with
volatile decisions (abort, post-stream retries, asks) still reading live.
