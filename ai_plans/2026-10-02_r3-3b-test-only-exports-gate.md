# R3-3b: find-test-only-exports gate (--check + allowlist) + cleanup

Date: 2026-10-02 · Branch: `chore/r3-3b-test-only-exports-gate` · Item 3b of
`ai_plans/simplification_round3_audit_2026-10-02.md` (follows R3-1 #762, R3-2 #763,
R3-3a #764, R3-10 #766).

Owner decision (binding): "Dodaj --check i allowlistę tylko dla świadomie
zostawionych eksportów; pozostałe sprzątnij."

## What changed

### 1. `scripts/find-test-only-exports.mjs` — a real verdict

- `--check` flag (mirrors `find-unused-i18n-keys.mjs --check`): exit 1 on any
  gate-scope finding, exit 0 otherwise. The bare list and `--json` / `--unreferenced`
  behavior is unchanged; `--json` additionally carries the gate result.
- New exported `gateFindings(result, inScope, entries)` computes the gate scope:
  **exports no production file mentions AND that their own file does not use
  either**, plus whole files only their spec keeps alive (whose exports are not
  all allowlisted/own-used). Rationale: knip runs with
  `ignoreExportsUsedInFile: true`, so the 350 own-used findings are exactly the
  class knip consciously exempts (the repo's `...Access` / `*ForTests` seam
  convention, Phase 4 / S1-S3). The gate covers only what knip cannot see **by
  construction**: a spec import counts as usage in knip, so a not-own-used
  export that only its spec imports is invisible to it. The bare list still
  reports own-used items for manual review.
- Stale-allowlist detection: an entry that matches nothing the scan reports
  anymore also fails `--check`, so reasons cannot rot.

### 2. `scripts/test-only-exports-allowlist.mjs` — new

31 entries, each with a one-line justification comment, in three groups:
state-reset/inspect seams (`resetModelCacheForTests`, `resetAutoDreamState`,
`_inFlight*Count`, `resetMemoryPaths`, `resetGlobalApiRequestTime`,
`clearPanels`, `setMinComponentLines`, `resetRateLimitGates`,
`resetLoggerForTests`, `resetOsInfoCacheForTests`, `clearWorkspaceFileListCacheForTests`
— renamed from `clearWorkspaceFileListCache`), runtime-consumed public API
(`defineCustomTool` — user-authored tool files compiled by esbuild-runner
outside the repo), and protocol/contract surfaces pinned by characterization
specs (vscode-extension-host channel types, cloud organization settings types,
provider-registry derived tables, `taskEventSchema`, `providerSettingsSchemaDiscriminated`,
`keylessProviders`, ...).

### 3. Cleanup — 27 findings deleted (of the 58 gate-scope findings)

Deleted exports (+ their helpers and spec blocks where the test existed only
for them): `createMockClient` (moved to `apps/cli/src/agent/__tests__/helpers.ts`,
a shared test fixture, imported by 2 specs), `getDefaultCliTaskStoragePath`,
`getStaticMessages`, `serializeCustomTools` (specs use `tools.map(serializeCustomTool)`),
`generateImageWithImagesApi` (+ `ImagesApiOptions`/`ImagesApiResponse`),
`convertToAnthropicRole`, `extractSpillNotice`, `isWriteToolAction` (spec asserts
the write category via `getToolActionApprovalCategory`), `importSettingsFromFile`
(spec rewires to `importSettingsFromPath`), `memoryFreshnessNote`,
`isToolAllowedInMode` (gating behavior stays covered through
`filterNativeToolsForMode` / `applySlimToolset` specs), `isSameToolInvocation`,
`processBackspaces`, `processCarriageReturns` (+ the benchmark file and the
`processLineWithCarriageReturns` helper), `getBuiltInCommandNames`,
`formatMarkdownCaptures`, `injectEnv` (spec wraps `injectVariables`),
`isProxyEnabled` (spec derives `enabled && isDebugMode` from `getProxyConfig`),
`singleCompletionHandler` (spec uses `singleCompletionWithUsage(...).text`),
`isThemeLoaded`, `flattenExtensionStore` (production inlines it in
`buildContextValue`; spec defines the 3-line flattening locally),
`formatDate`, `formatTimeAgo` (stale vi.mock entries in 4 other specs removed),
`parseStackTrace`, `TooManyToolsWarning` (whole file + spec — the chat renders
`TooManyToolsWarningRow`, McpView uses the hook directly), and the whole
`packages/types/src/context-management.ts` module (+ spec + index re-export —
zero production consumers of `ContextManagementEvent`).

### 4. CI

`.github/workflows/code-qa.yml`, knip job: new step
`node scripts/find-test-only-exports.mjs --check` right after the R3-3a
unused-i18n-keys step, same style, with a comment explaining what the gate
covers and where deliberate exceptions live.

## Verification

- `node --test 'scripts/__tests__/*.test.mjs'`: 43/44 pass — the one failure
  (`check-settings-defaults`, TerminalSettings `terminalCommandDelay ?? 50`) is
  **pre-existing on main** (verified with `git stash`); new tests for
  `gateFindings` (allowlist exemption, own-used exclusion, whole-file verdicts,
  stale entries, allowlist format) all pass.
- Touched suites green: src (10 suites incl. importExport, approvalMatrix,
  filter-tools/slim-toolset, extract-text, markdownParser, file-search,
  image-generation, vscode-lm-format, spillPolicy, memoryAge, config,
  enhance-prompt, networkProxy, toolAskIdentity, built-in/symlink/frontmatter
  commands), apps/cli (4 suites), packages/core custom-tools (2), webview-ui
  (8 suites incl. highlighter, format, sourceMapUtils, extensionStateReducer,
  TaskItem/TaskGroupItem/TaskItemFooter, primitives).
- `pnpm check-types`: 11/11 tasks green. `pnpm lint`: 11/11 green.
- `pnpm knip`: only the two known pre-existing findings (zoo-prs.mjs local
  skill, .css config hint) — unchanged.
- `node scripts/find-test-only-exports.mjs --check` on the full repo: exit 0.

## Deviations from the brief

- The gate scope is narrower than "every finding the script prints": own-file-used
  exports are excluded because knip's `ignoreExportsUsedInFile: true` already
  exempts exactly that class, and the audit item's purpose is the knip-invisible
  gap. Allowing 350 seam-convention items onto an allowlist (or deleting live
  seam members to satisfy a wider gate) would defeat the owner's
  "only consciously kept" rule.
- `clearWorkspaceFileListCache` was renamed `clearWorkspaceFileListCacheForTests`
  (a deliberate state-reset seam) and allowlisted, per the `*ForTests` convention.
