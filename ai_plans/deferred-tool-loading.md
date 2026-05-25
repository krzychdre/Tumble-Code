# Deferred MCP & Custom Tool Loading — Implementation Plan

**Branch:** `feat/deferred-tool-loading`
**Companion diagnosis:** `ai_plans/tool-registry-analysis.md` (Section A, ★★★).
**Scope:** Port Claude Code's `defer_loading` / ToolSearch idea into Roo Code as a
userland-emulated meta-tool, so heavy MCP / custom-tool installs stop burning
15k–40k prompt tokens per turn and stop tripping VS Code's "too many tools
enabled" warning.

---

## 1. Problem (verified)

The full universe of tools is emitted into **every** model request with no
schema deferral. Concretely:

- `buildNativeToolsArrayWithRestrictions` returns `[native, mcp, custom]` —
  `src/core/task/build-tools.ts:82-169`.
- MCP tools are enumerated with `description` + JSON schema verbatim —
  `src/core/prompts/tools/native-tools/mcp_server.ts:55-65`.
- Static native list rebuilt every request — `src/core/prompts/tools/native-tools/index.ts:42-72`.
- No deferred-loading mechanism exists anywhere in `src/`. `grep -r
"defer_loading\|shouldDefer\|alwaysLoad\|ToolSearch" src/` returns nothing
  (confirmed in `tool-registry-analysis.md:222-223`).

A user with 4 MCP servers × 12 tools = ~48 tool entries × ~300–800 tokens =
**15k–40k tool-section tokens per request**. Most aren't called on most turns.
VS Code's "many tools" UI warning is a downstream symptom of the same bloat.

## 2. Design — userland ToolSearch port

Mirror Section A's recommendation (`tool-registry-analysis.md:238-282`) with
two modifications justified by Roo Code's multi-provider model:

1. **No provider-side `defer_loading` flag** in v1. The `advanced-tool-use`
   Anthropic beta path is intentionally deferred to v2 (see §7). All provider
   adapters get the same shrunk tool array — no per-provider divergence.
2. **MCP servers fully expanded, not just names.** The advertised payload for
   a deferred MCP tool is `{server, name, brief}` (brief = first sentence of
   the description), grouped by server. This matches Roo Code's existing
   prompt convention (`use_mcp_tool` already groups by server) and is cheap.

### Mechanism

- New optional metadata flag on the per-tool config: `shouldDefer?: boolean`
  (extends the `OpenAI.Chat.ChatCompletionTool` we already build). The static
  native list keeps `shouldDefer` undefined → never deferred.
- MCP tools default to `shouldDefer: true`. Custom tools (filesystem-loaded)
  also default to `shouldDefer: true`. Both can be force-loaded via a future
  per-tool opt-out (`alwaysLoad`), but v1 ships only the default.
- `ALWAYS_AVAILABLE_TOOLS` (`src/shared/tools.ts:317-325`) is treated as the
  implicit `alwaysLoad` whitelist (never deferred). They're built-in and tiny.
- A new native tool `tools_load` is **always** in the tools array (it's the
  escape hatch the model uses to materialize deferred schemas).
- A new function `applyDeferralStrategy(tools, ctx)` runs at the bottom of
  `buildNativeToolsArrayWithRestrictions`. It splits tools into
  `{ active, deferred }`, attaches the deferred catalog to a side channel
  (`BuildToolsResult.deferredCatalog`), and returns the active set.
- The deferred-catalog text is injected into the **system prompt** (not the
  tools array) by a new prompt section `deferred-tools.ts`, formatted as:

    ```text
    # Deferred tools (load on demand)
    Use the `tools_load` tool to fetch the full schema for any of these.

    ## mcp:weather  (3 tools)
    - mcp--weather--get_current  Get current weather for a city.
    - mcp--weather--get_forecast  Get N-day forecast.
    - mcp--weather--list_stations Enumerate observation stations.

    ## custom  (2 tools)
    - my_jira_search  Search Jira issues by JQL.
    - my_pager_page   Page on-call via PagerDuty.
    ```

- When the model calls `tools_load({ names: [...] })`, the handler returns
  the full `{name, description, parameters}` triple(s) as a JSON block. The
  _next_ assistant turn includes those tools in the active set (state on the
  `Task` instance: `materializedDeferredTools: Set<string>`).

### Blast radius (mandatory mapping)

| Component                                           | Impact                                                                                                      | Mitigation                                                                                |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `buildNativeToolsArrayWithRestrictions` callers     | Shape change: returns extra optional fields                                                                 | Optional fields; existing callers keep working                                            |
| Native-tool dispatch (`presentAssistantMessage.ts`) | New tool name in switch                                                                                     | Add explicit case; the default→customTool fallback still works otherwise                  |
| MCP tool execution                                  | Model calls tools by canonical name after materialize                                                       | No change — execution path keys on `block.name` already                                   |
| Provider adapters (Anthropic/OpenAI/Bedrock/Gemini) | Receive smaller `tools` array                                                                               | None — array is just shorter                                                              |
| `includeAllToolsWithRestrictions` (Gemini path)     | Must keep deferred names in `allowedFunctionNames` so the model is _allowed_ to call them once materialized | `applyDeferralStrategy` returns `allowedNames` superset including deferred + `tools_load` |
| Custom-tool experiment flag                         | When `customTools` experiment is off, custom tools were absent — same after deferral                        | No regression                                                                             |
| MCP off / no servers                                | `deferredCatalog` empty → `tools_load` description says "no deferred tools yet"                             | `tools_load.isEnabled` returns false when nothing to defer                                |
| Webview "Prompts" view counters                     | None                                                                                                        | View reads from `TOOL_GROUPS`, not from the runtime array                                 |

## 3. File changes (RFC-Lite)

| Action | Path                                                    | Purpose                                                                            |
| :----- | :------------------------------------------------------ | :--------------------------------------------------------------------------------- |
| MOD    | `packages/types/src/tool.ts`                            | Add `"tools_load"` to `toolNames`                                                  |
| MOD    | `packages/types/src/experiment.ts`                      | Add `deferredTools` experiment id                                                  |
| MOD    | `src/shared/experiments.ts`                             | Add `DEFERRED_TOOLS` constant (default off in v1)                                  |
| MOD    | `src/shared/tools.ts`                                   | Add `tools_load` to `TOOL_DISPLAY_NAMES` and `ALWAYS_AVAILABLE_TOOLS`              |
| NEW    | `src/core/prompts/tools/native-tools/tools_load.ts`     | Schema for `tools_load({ names: string[] })`                                       |
| MOD    | `src/core/prompts/tools/native-tools/index.ts`          | Register `tools_load`                                                              |
| NEW    | `src/core/task/deferred-tools.ts`                       | Pure logic: `applyDeferralStrategy`, `formatDeferredCatalog`, `isAlwaysLoad`       |
| MOD    | `src/core/task/build-tools.ts`                          | Call `applyDeferralStrategy` at the tail; return `deferredCatalog`                 |
| NEW    | `src/core/tools/toolsLoadTool.ts`                       | Runtime handler — materializes schemas, persists on `Task`                         |
| MOD    | `src/core/assistant-message/presentAssistantMessage.ts` | Wire `tools_load` case                                                             |
| MOD    | `src/core/task/Task.ts`                                 | New field `materializedDeferredTools: Set<string>`                                 |
| MOD    | `src/core/task/ApiRequestBuilder.ts`                    | Re-expand materialized deferred tools back into the active set on subsequent turns |
| NEW    | `src/core/prompts/sections/deferred-tools.ts`           | Prompt section emitting the deferred-tools catalog                                 |
| MOD    | `src/core/prompts/system.ts`                            | Splice catalog section after the capabilities section                              |
| NEW    | `src/core/task/__tests__/deferred-tools.spec.ts`        | Unit tests for the pure logic                                                      |
| NEW    | `src/core/tools/__tests__/toolsLoadTool.spec.ts`        | Unit tests for the handler                                                         |

Total new files: 5. Total modified files: 9. Within the 5-file "shotgun"
threshold for the new code surface (types/shared are configuration touch-ups).

## 4. Execution sequence (TDD, phased)

Each phase ends with `turbo check-types` and the targeted test run staying
green. No phase mixes test and impl — RED, GREEN, then move on.

### Phase 0 — Foundation types (no behaviour change)

- Add `tools_load` to `toolNames` and `TOOL_DISPLAY_NAMES`.
- Add `deferredTools` experiment id + default `false`.
- Add to `ALWAYS_AVAILABLE_TOOLS` so the tool is always in scope.
- Tests: existing type assertions in `packages/types` cover this.
- Verify: `pnpm --filter @roo-code/types check-types`.

### Phase 1 — Pure deferral logic (TDD)

- RED: write `deferred-tools.spec.ts` covering:
    1. native tools never deferred (happy path)
    2. MCP tools deferred by default
    3. custom tools deferred by default
    4. `ALWAYS_AVAILABLE_TOOLS` never deferred even if `shouldDefer: true`
    5. `materializedDeferredTools` set re-promotes a deferred tool back to active
    6. empty MCP/custom → empty `deferredCatalog`
    7. catalog formatter groups by `mcp:<server>` and `custom`
    8. catalog formatter strips description to first sentence (≤ 200 chars)
- GREEN: implement `applyDeferralStrategy` + `formatDeferredCatalog` in
  `deferred-tools.ts`. Pure functions, no I/O.
- Verify: target test file passes; `check-types` clean.

### Phase 2 — Wire into build-tools (TDD)

- RED: extend `native-tools-filtering.spec.ts` (or new
  `build-tools-deferral.spec.ts`) — assert that with the experiment ON,
  the returned `tools` array shrinks and `deferredCatalog` is populated.
  With experiment OFF, the behaviour matches v0 exactly.
- GREEN: call `applyDeferralStrategy` in
  `buildNativeToolsArrayWithRestrictions` only when the experiment is enabled.
  Extend `BuildToolsResult` with `deferredCatalog?: DeferredCatalog`.
- Verify: full `src/core/task` vitest pass.

### Phase 3 — `tools_load` schema + handler (TDD)

- RED: `toolsLoadTool.spec.ts` —
    1. invalid `names` → error result, no state mutation
    2. unknown name → error mentioning the bad name
    3. one known deferred MCP tool → result is a `<functions>` JSON block
       containing `{name, description, parameters}`
    4. mark in `task.materializedDeferredTools`
    5. selecting an `alwaysLoad` tool is a no-op success
- GREEN: implement `toolsLoadTool.handle()` and the schema file.
- Verify: target file passes.

### Phase 4 — Re-expansion on next turn

- RED: a spec that runs `buildNativeToolsArrayWithRestrictions` twice on the
  same `Task`; the second call (after `materializedDeferredTools.add(...)`)
  returns a tools array that _includes_ the materialized tool's full schema.
- GREEN: in `ApiRequestBuilder` (or directly in `build-tools.ts` via an
  injected `materializedSet`), re-promote materialized names before deferral.
- Verify: targeted spec + `Task.spec.ts` baseline.

### Phase 5 — Prompt section + system prompt wiring

- RED: a snapshot-ish test for `getDeferredToolsSection(catalog)` covering
  empty / single-server / multi-server cases.
- GREEN: implement `sections/deferred-tools.ts`; splice into `system.ts`
  after `getCapabilitiesSection`.
- Verify: prompts vitest + `Task.spec.ts`.

### Phase 6 — End-to-end manual smoke

- Run with `experiments.deferredTools: true` + an MCP server registered.
- Verify the tools array sent to the provider lacks the MCP schemas, the
  system prompt contains the catalog, and `tools_load` round-trips a known
  MCP tool.

## 5. Test plan (commands)

```bash
pnpm --filter roo-cline test -- src/core/task/__tests__/deferred-tools.spec.ts
pnpm --filter roo-cline test -- src/core/tools/__tests__/toolsLoadTool.spec.ts
pnpm --filter roo-cline test -- src/core/task/__tests__/native-tools-filtering.spec.ts
pnpm --filter roo-cline test -- src/core/prompts
pnpm --filter @roo-code/types check-types
pnpm --filter roo-cline check-types
```

Acceptance: every targeted test passes; no regression in
`src/core/task/__tests__/Task.spec.ts`.

## 6. Rollback

The whole feature is gated on the `deferredTools` experiment (defaults
`false`). Disabling the experiment restores v0 behaviour byte-for-byte —
`applyDeferralStrategy` is a no-op when the flag is off, and the prompt
section returns the empty string. Reverting is a single `git revert` on the
branch tip.

## 7. Out of scope (v2 candidates)

- Provider-native `defer_loading` flag for Anthropic's
  `advanced-tool-use` beta — saves provider-side cache invalidations.
- Keyword-search mode of `tools_load` (`tools_load({ query: "send" })`) —
  Claude Code uses it, but v1 ships the `names: []` form only.
- Per-tool `alwaysLoad` opt-out for MCP — let users pin specific MCP tools.
- A `toolSchemaCache` analogue. The analysis doc rates it ★★ medium; defer.

---

## 8. Hardening for weak models (v1.1)

**Trigger:** A GLM-4.7-FP8 trace emitted `tools_load` with literal empty
`input: {}` — and _also_ emitted other tools (e.g. `read_file`) with empty
input. That confirms the failure mode is **structured-tool-args reliability**
on weak/cheap models, not a misunderstanding of the deferred protocol per se.
The protocol must therefore become "tolerance-first": every failure shape we
can predict gets converted into actionable model guidance instead of a hard
error that the model can't recover from.

All hardening changes are gated on `experiments.deferredTools`. With the
experiment OFF, behaviour is byte-identical to today.

### 8.1 — Catalog prompt rewrite + redundant tool description

**Problem.** v1's catalog header is friendly prose ("Use the `tools_load`
tool to fetch the full schema…"). Weak models often miss the imperative or
fail to construct the right JSON shape because they only see the high-level
sentence, never a literal example.

**Change.**

- `src/core/task/deferred-tools.ts` / `formatDeferredCatalog` — rewrite the
  header to an explicit two-step procedure with a literal JSON example
  (`tools_load({"names": ["mcp_..."]})`) and three bullet rules. Quote tool
  names in the listing (`- "<name>" — <brief>`) so the model pattern-matches
  the call site against the listing.
- `src/core/prompts/tools/native-tools/tools_load.ts` — duplicate the
  worked-example JSON into the tool's `description`. Redundancy across
  system prompt + tool description protects against models that weight one
  channel over the other.
- Tests updated in
  `src/core/task/__tests__/deferred-tools.spec.ts` and
  `src/core/prompts/sections/__tests__/deferred-tools.spec.ts` to lock the
  new copy.

### 8.2 — Tolerant `tools_load`

**Problem.** v1 throws on missing/empty `names`; the throw is caught by the
generic `missing nativeArgs` validator at
`src/core/assistant-message/presentAssistantMessage.ts:430`. Result: an
"Invalid tool call" tool_result that the model can't act on.

**Change.**

- `src/core/tools/ToolsLoadTool.ts` — override `handle()` so the generic
  `nativeArgs === undefined` path no longer throws. Instead the handler
  detects four shapes and produces a structured guidance tool-result:
    1. `{}` / no `nativeArgs` / `names` missing → guidance with the current
       deferred-tools list + a literal JSON call example.
    2. `{ names: "single_string" }` → coerce to `["single_string"]`.
    3. `{ name: "foo" }` (singular) → coerce to `{ names: ["foo"] }`.
    4. `{ names: [] }` → guidance (already covered in v1, but the message
       now includes the current list + a JSON example).
- Validation moved **inside** the handler (option (b) from the dispatch),
  so the generic `missing nativeArgs` guard at line 430 is left intact for
  every other tool. The dispatcher gains a tight allow-list of tools whose
  empty `nativeArgs` must reach their handler (`tools_load` is currently
  the only entry).
- Tests added to `src/core/tools/__tests__/ToolsLoadTool.spec.ts` covering
  each tolerated shape.

### 8.3 — Auto-materialize on direct call

**Problem.** Some models skip `tools_load` entirely and call a deferred
tool name directly (e.g. emit `tool_use` for `mcp--github--get_issue`).
v1 routes this through the unknown-tool default branch → `Unknown tool`
error → wasted turn.

**Change.**

- New helper `src/core/task/deferred-tools-resolver.ts` exporting
  `tryMaterializeDirectCall(task, blockName, nativeArgs, options)`.
  Behaviour:
    1. If `experiments.deferredTools !== true` → return `null` (no-op).
    2. Cross-reference `blockName` against `task.deferredToolDirectory`. If
       not present → return `null` (fall through to the existing dispatcher
       paths so typos still get the standard "unknown tool" error).
    3. If present, add it to `task.materializedDeferredTools` so subsequent
       turns include the schema in the active set.
    4. Validate `nativeArgs` against the freshly-materialized JSON Schema.
        - Valid → return `{ kind: "ready" }` so the dispatcher can continue
          to the normal MCP-tool path (the call can run _this turn_).
        - Invalid (or empty) → return
          `{ kind: "guidance", result: <tool result with schema + retry hint> }`.
- Wire the helper into `presentAssistantMessage.ts`:
    - Just before the "Invalid tool call: missing nativeArgs" guard at
      line ~425, call `tryMaterializeDirectCall` for the **direct-call**
      case (block name is a deferred tool, args empty/invalid). Return
      the guidance result.
    - At the unknown-tool default branch (~line 933), call the helper
      again for the **valid-args** case so a deferred name with proper
      args succeeds on its first emission.
- Tests in `src/core/task/__tests__/deferred-tools-resolver.spec.ts`:
  (a) direct call with valid args materializes + reports ready, (b)
  direct call with invalid args returns guidance containing the schema,
  (c) name that isn't deferred returns `null` so the existing
  "unknown tool" error path takes over, (d) experiment OFF → `null`
  immediately, no state mutation.

### 8.4 — Test plan

```bash
pnpm --filter roo-cline test -- --run src/core/task/__tests__/deferred-tools.spec.ts
pnpm --filter roo-cline test -- --run src/core/tools/__tests__/ToolsLoadTool.spec.ts
pnpm --filter roo-cline test -- --run src/core/prompts/sections/__tests__/deferred-tools.spec.ts
pnpm --filter roo-cline test -- --run src/core/task/__tests__/deferred-tools-resolver.spec.ts
pnpm --filter roo-cline check-types
pnpm --filter roo-cline lint
```

### 8.5 — Blast radius

| Component                                   | Impact                                                              | Mitigation                                                   |
| ------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------ |
| `formatDeferredCatalog` text                | Snapshot-ish tests update                                           | Tests updated in same commit                                 |
| `tools_load` description text               | Slightly larger system-prompt tool entry                            | Acceptable; description still < 1k tokens                    |
| Dispatcher tool-allow-list                  | New explicit "tools that may pass with empty nativeArgs" set        | Hard-coded, single entry, gated by experiment                |
| Direct-call materialization                 | New code path entered ONLY when name resolves in deferred directory | Returns `null` early when experiment off / name not deferred |
| Existing tools that emit empty `nativeArgs` | Unchanged — still hit the generic "missing nativeArgs" error path   | Tools_load is the only exception                             |
