# Zoo PR #657 — rules management UI — DEFERRED (dedicated feature session)

Upstream: Zoo-Code-Org/Zoo-Code PR #657, commit `f75b64e28`, merged 2026-06-26.
Author: Ivan Ramadhan Arifin. Credit on port:
`Co-authored-by: Ivan Ramadhan Arifin <…>` (resolve email from `zoo-prs show 657`).

## Why deferred

- **34 files / 3217 insertions** — the largest item in the batch. A complete new
  rules-management subsystem, far beyond a safe autonomous loop tick.
- **New backend**: `src/services/rules/rules.ts` (+408), `src/core/webview/rulesMessageHandler.ts`
  (+170), `packages/types/src/rules.ts` (+34). Our fork has **no** `src/services/rules`
  dir today — rules loading lives in `src/services/roo-config/index.ts` and
  `src/core/prompts/sections/custom-instructions.ts`. The new service must be
  reconciled with that existing loader (and our `useAgentRules` / AGENTS.md support)
  to avoid two competing rules pipelines.
- **New UI**: `RulesSettings.tsx` (+207), `CreateRuleDialog.tsx` (+218), wired through
  `SettingsView.tsx`, `ExtensionStateContext.tsx`, `vscode-extension-host.ts`.
- **~1466 lines of new tests** across 6 files (rules.spec, rulesMessageHandler.spec,
  webviewMessageHandler.spec, CreateRuleDialog.spec, RulesSettings.spec,
  ExtensionStateContext.spec) + 18 locale `settings.json` updates.

## Dedicated-session checklist

1. Add `packages/types/src/rules.ts` + export from `index.ts`; extend `ExtensionState`
   in `vscode-extension-host.ts`.
2. Port `src/services/rules/rules.ts` — **first audit `src/services/roo-config/index.ts`**
   for overlap; decide whether the new service wraps or replaces our loader, and keep
   AGENTS.md / `.roo/rules` behavior intact (do not regress `useAgentRules`).
3. Port `rulesMessageHandler.ts` and wire its cases into `webviewMessageHandler.ts`.
4. Port `RulesSettings.tsx` + `CreateRuleDialog.tsx`; wire into `SettingsView.tsx`
   and `ExtensionStateContext.tsx` (re-anchor against our divergence).
5. Port the 6 test files; add the 18 locale strings.
6. Verify: types + src + webview typecheck; run the 6 new specs; manual smoke of the
   Rules settings tab.
