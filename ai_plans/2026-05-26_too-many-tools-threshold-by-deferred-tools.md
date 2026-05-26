# Too-Many-Tools Warning: Conditional Threshold by `deferredTools` Experiment - Implementation Plan

**Date:** 2026-05-26
**Branch:** `feat/too-many-tools-threshold-by-deferred-tools` (stacked on `feat/ui-horizontal-scroll`)
**Status:** Draft

## 1. Objective

The "too many MCP tools" warning currently fires at a fixed threshold of 60 enabled tools. When the `deferredTools` experiment is enabled, MCP tools are no longer emitted on every turn (`ai_plans/deferred-tool-loading.md`), so the model is exposed to far fewer concurrent tools and the warning fires too eagerly. Raise the warning ceiling to **120** when `deferredTools` is on; keep **60** otherwise.

## 2. Evidence (Current Behavior)

- Constant: [packages/types/src/mcp.ts:7](packages/types/src/mcp.ts#L7) — `export const MAX_MCP_TOOLS_THRESHOLD = 60`.
- Backend trigger: [src/core/task/TaskLifecycle.ts:425-438](src/core/task/TaskLifecycle.ts#L425-L438) — emits the `too_many_tools_warning` message when `enabledToolCount > MAX_MCP_TOOLS_THRESHOLD`, with no awareness of experiments.
- Backend tool count: [src/core/task/TaskContextManager.ts:243-265](src/core/task/TaskContextManager.ts#L243-L265) — `getEnabledMcpToolsCount()`; calls `provider.getState()` which already exposes `experiments` ([src/core/webview/ClineProvider.ts:2539](src/core/webview/ClineProvider.ts#L2539)).
- Frontend hook: [webview-ui/src/hooks/useTooManyTools.ts:33-57](webview-ui/src/hooks/useTooManyTools.ts#L33-L57) — uses `MAX_MCP_TOOLS_THRESHOLD` directly; does not read experiments.
- Frontend warning component: [webview-ui/src/components/chat/TooManyToolsWarning.tsx](webview-ui/src/components/chat/TooManyToolsWarning.tsx) — pure consumer of the hook, no change needed.
- Experiment id: [packages/types/src/experiment.ts:14](packages/types/src/experiment.ts#L14) — `"deferredTools"` is already in `experimentIds` and validated by `experimentsSchema`.
- Webview state experiments: [webview-ui/src/context/ExtensionStateContext.tsx:217](webview-ui/src/context/ExtensionStateContext.tsx#L217) — `experiments: experimentDefault` is part of the global webview state and reachable via `useExtensionState()`.
- Existing tests: [webview-ui/src/components/chat/**tests**/TooManyToolsWarning.spec.tsx](webview-ui/src/components/chat/__tests__/TooManyToolsWarning.spec.tsx) — 9 tests pin the 60-threshold behaviour via `MAX_MCP_TOOLS_THRESHOLD`.

## 3. Target Behavior

| `deferredTools` | Threshold | Warning fires when... |
| --------------- | --------- | --------------------- |
| `false` / unset | 60        | enabled tools > 60    |
| `true`          | 120       | enabled tools > 120   |

All other behaviour (counting only enabled+connected servers, ignoring disabled tools, message template, "Open MCP Settings" link) is unchanged. The threshold value is interpolated into the message verbatim, so the user sees "Try to keep it below 120" only when the experiment is enabled.

## 4. Tech Strategy

- **Single source of truth.** Add `MAX_MCP_TOOLS_THRESHOLD_DEFERRED = 120` next to the existing constant in [packages/types/src/mcp.ts](packages/types/src/mcp.ts), plus a thin pure helper `getMaxMcpToolsThreshold(deferredToolsEnabled: boolean)`. Keep `MAX_MCP_TOOLS_THRESHOLD` exported and unchanged (default behaviour). No backwards-compat shim required — call sites are explicit.
- **Backend wiring.** In `TaskLifecycle.startTask`, read `experiments?.deferredTools` from the provider state (already fetched elsewhere via `provider.getState()`), pass through `getMaxMcpToolsThreshold`, and compare/serialize using that value. `TaskContextManager.getEnabledMcpToolsCount()` itself is unchanged — counting is independent of the threshold.
- **Frontend wiring.** Extend `useTooManyTools` to read `experiments` from `useExtensionState()` and pick the threshold via the same helper. `TooManyToolsWarning.tsx` already consumes the hook's `threshold` so no changes there.
- **No new experiment.** This rides the existing `deferredTools` flag — when deferred-tool loading is on, the model never sees the full universe at once, so the higher ceiling is the right gate.
- **Type safety.** Helper accepts a primitive `boolean` (not the whole `Experiments` object) so it stays usable from both packages without dragging type imports across boundaries.

## 5. File Changes

| Action | File Path                                                               | Brief Purpose                                                                                    |
| :----- | :---------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------- |
| MOD    | `packages/types/src/mcp.ts`                                             | Add `MAX_MCP_TOOLS_THRESHOLD_DEFERRED = 120` and `getMaxMcpToolsThreshold(deferredEnabled)`.     |
| MOD    | `src/core/task/TaskLifecycle.ts`                                        | Read `experiments?.deferredTools` from provider state; pick threshold via helper before warning. |
| MOD    | `webview-ui/src/hooks/useTooManyTools.ts`                               | Read `experiments` from `useExtensionState()`; pick threshold via helper.                        |
| MOD    | `webview-ui/src/components/chat/__tests__/TooManyToolsWarning.spec.tsx` | Mock `experiments` in `useExtensionState` mock; add a test for the deferred-mode 120 threshold.  |

Blast radius: contained. The constant `MAX_MCP_TOOLS_THRESHOLD` remains exported for any external consumer (no breakage), and the helper is purely additive.

## 6. Risks

- **Provider state availability.** `provider.getState()` may, in principle, return without `experiments`. Defaulting to `false` (i.e. the conservative 60 threshold) is the safe fallback — same as the existing `experiments?.deferredTools !== true` pattern in [src/core/prompts/sections/deferred-tools.ts:28](src/core/prompts/sections/deferred-tools.ts#L28).
- **Stale memoization.** `useTooManyTools` memoizes count, not threshold. Adding `experiments?.deferredTools` to the threshold calculation outside `useMemo` keeps it reactive to experiment toggles without re-running the count.
- **i18n.** Message template already substitutes `{threshold}`; no string changes needed. Existing translations stay valid.

## 7. TDD Steps

1. **Baseline.** Run `pnpm --filter webview-ui test TooManyToolsWarning` and `pnpm --filter @roo-code/types test` (if present) → all green.
2. **Extend types.** Add constant + helper in `mcp.ts`. No behavioural change yet.
3. **Extend webview test.** Mock `experiments: { deferredTools: true }` in `ExtensionStateContext` mock; assert that 61 tools does **not** render the warning, but 121 does. Run suite → new test fails (expected).
4. **Update the hook.** Read `experiments` and pick the threshold via the helper. Re-run → suite green.
5. **Update backend.** In `TaskLifecycle.startTask`, fetch `experiments` from `provider.getState()` and pick threshold via helper. If a backend unit test exists for `TaskLifecycle.startTask` warning emission, extend it; otherwise leave as integration-only.
6. **Lint + typecheck** for both `src/` and `webview-ui`.

## 8. Verification Commands

- `pnpm --filter webview-ui test TooManyToolsWarning`
- `pnpm --filter webview-ui lint`
- `pnpm --filter webview-ui check-types`
- `pnpm --filter roo-cline check-types` (backend)

All four must exit 0 before commit.
