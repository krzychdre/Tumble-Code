# Fix: `tools_load` arguments silently dropped by NativeToolCallParser

**Date:** 2026-05-25
**Branch:** `fix/native-parser-tools-load-omission` (stacked on `feat/deferred-tool-loading`)
**Status:** In progress
**Related plans:** `deferred-tool-loading.md`, `fix-deferred-tools-i18n.md`

## 1. Symptom

A weak local model (GLM-5.1 via llama.cpp) emits a syntactically and
semantically correct call:

```
tools_load({"names": ["mcp--searxNcrawl--search"]})
```

— verified in `llama-server --verbose` output. Roo Code's tool dispatch then
invokes `ToolsLoadTool.handle` with `input: {}` (no `names`). The handler
returns the "missing names" guidance message. The model repeats with the same
correct args. After three identical correct calls, `ToolRepetitionDetector`
fires and the task fails with _"Roo appears to be stuck in a loop"_.

This blocks every deferred MCP tool on weak local models even though the model
is doing exactly what the system prompt asked.

## 2. Proven root cause (evidence from source)

The model's `arguments` JSON is parsed but never reaches the handler. The drop
happens in `NativeToolCallParser` because **`tools_load` was not added to the
switch when the meta-tool was introduced** (commits 156abd5f0 / aa18d175a).

1. `NativeToolCallParser.parseToolCall()` at
   `src/core/assistant-message/NativeToolCallParser.ts:704-995` switches on
   `resolvedName`. There is **no `case "tools_load":`** — grep confirms zero
   matches in the whole file.
2. Falls into the `default:` branch at line 989. `customToolRegistry.has("tools_load")`
   is false (it's a native always-available tool listed in
   `ALWAYS_AVAILABLE_TOOLS` at `src/shared/tools.ts:319-328`), so `nativeArgs`
   stays `undefined`.
3. Line 999-1005 throws `Invalid arguments for tool 'tools_load'`.
4. The throw is swallowed by the catch at line 1026-1032; `parseToolCall`
   returns `null`.
5. `TaskStreamProcessor.ts:308-326` treats `null` as "malformed/missing args"
   and keeps the already-streamed **partial** ToolUse block alive (created by
   `createPartialToolUse` at line 373 — which **also has no `tools_load`
   case**, so the partial block has `nativeArgs: undefined` and empty `params`).
   The block gets `partial: false` and is passed to `presentAssistantMessage`.
6. `presentAssistantMessage.ts:454` has an explicit allow-list:
   `allowsEmptyNativeArgs = stateExperiments?.deferredTools === true &&
block.name === "tools_load"`. This was added so the
   `tools_load`-with-empty-args case could reach the handler for guidance —
   it now also lets the parser-dropped case through.
7. `ToolsLoadTool.handle` → `coerceToolsLoadArgs(undefined)` → `{names: []}` →
   guidance message. Loop.

The defensive layers `coerceToolsLoadArgs`, `allowsEmptyNativeArgs`, and
the worked-example guidance (commits ccc2916e3 / 7a33323df) were all
designed for _"weak model genuinely emits `{}`"_. The runtime symptom of
**"parser dropped the args"** is byte-identical to that case, so every
component-level unit test passes individually — the bug is invisible at every
boundary and only surfaces end-to-end.

## 3. Why no existing test caught this

- `NativeToolCallParser.spec.ts` (346 lines) only covers **`read_file`**. No
  parametrised "every registered tool can be parsed" test exists. Adding a new
  tool name to the codebase does not require adding a parser case.
- `ToolsLoadTool.spec.ts` constructs `ToolUse<"tools_load">` blocks with
  pre-populated `nativeArgs` and calls `tool.handle(...)`. The handler is
  unit-tested in isolation; the parser → handler integration is not exercised.
- `presentAssistantMessage`'s allow-list test (`deferred-tools.spec.ts`)
  asserts that empty `nativeArgs` reaches the handler. That assertion is
  satisfied by the parser-dropped path too, so it does not distinguish the
  bug from the intended fallback.

## 4. Fix

### 4.1 Parser changes (the actual bug)

Add a `tools_load` case to **both** switches in
`src/core/assistant-message/NativeToolCallParser.ts`:

```ts
// parseToolCall — before the default: at line 989
case "tools_load":
    nativeArgs = {
        names: Array.isArray(args?.names)
            ? args.names.filter((n: unknown): n is string => typeof n === "string")
            : [],
    } as NativeArgsFor<TName>
    break

// createPartialToolUse — before the default: at line ~640
case "tools_load":
    if (partialArgs?.names !== undefined) {
        nativeArgs = {
            names: Array.isArray(partialArgs.names)
                ? partialArgs.names.filter((n: unknown): n is string => typeof n === "string")
                : [],
        } as NativeArgsFor<TName>
    }
    break
```

Both cases filter to string entries defensively — the JSON could in theory
contain non-strings. The `coerceToolsLoadArgs` defensive layer in
`ToolsLoadTool.ts` stays unchanged: it is still useful for genuinely
malformed inputs and is now exercised only on its intended path.

### 4.2 Regression test (catches this **and** future omissions)

A new `describe` block in
`src/core/assistant-message/__tests__/NativeToolCallParser.spec.ts`
parametrised over every registered native tool. For each tool name it
constructs a minimal valid `arguments` payload and asserts that
`parseToolCall` returns a non-null result with **populated** `nativeArgs`.

Test design:

- **Source of truth for "every native tool":** `TOOL_DISPLAY_NAMES` from
  `src/shared/tools.ts` — the canonical list. Excludes `custom_tool` (handled
  via the customToolRegistry path, not the switch).
- **Minimal valid args fixture per tool:** a small `Record<ToolName, object>`
  inline in the test file. Each entry is the smallest payload that should
  parse — `{ path: "x" }` for `read_file`, `{ names: ["x"] }` for
  `tools_load`, etc. The fixture is co-located with the test so adding a new
  tool requires adding a fixture entry in the same PR.
- **Assertion:** `expect(result?.nativeArgs).toBeDefined()` and at least one
  representative field round-trips. The point is not to test schema validation
  but to prove the switch has a case for the tool.

The test, by construction, will fail loudly if anyone adds a new tool to
`TOOL_DISPLAY_NAMES` without also adding a parser case. That is exactly the
seam that broke for `tools_load`.

## 5. Out of scope

- The `createPartialToolUse` switch still has gaps for `access_mcp_resource`,
  `read_command_output`, `custom_tool` — these don't manifest as bugs today
  (their `final-parse` paths fix things up) so they are left alone here.
  Followup ticket if anyone wants symmetry.
- The `allowsEmptyNativeArgs` allow-list and `coerceToolsLoadArgs` stay. With
  the parser fixed, they are no longer load-bearing for the common case, but
  removing them would regress the genuine-empty-call path that weak models
  also occasionally hit.

## 6. Verification

- Parametrised parser spec fails for `tools_load` before the fix; green after.
- Full `NativeToolCallParser.spec.ts` and `ToolsLoadTool.spec.ts` suites stay
  green.
- Manual: GLM-5.1 + the bug repro (`find weather for Szubin`) — model's
  `tools_load({"names":["mcp--searxNcrawl--search"]})` now reaches the
  handler with `names: ["mcp--searxNcrawl--search"]`, search tool gets
  materialised, model uses it on turn 2.
