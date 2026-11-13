# knip: clean unused exports and types, raise every rule to "error"

Follow-up of `ai_plans/2026-09-28_d6-dead-code-cli-cloud.md` ("knip `exports` / `types` rules: left
at `warn`"). Branch `chore/knip-unused-exports`, based on main after #597 and rebased onto #599.

## Why

`knip.jsonc` had `exports`, `types`, `nsExports`, `nsTypes`, `duplicates` and `enumMembers` at
`"warn"`. A warning does not change the exit code, so `pnpm knip` (and CI) stayed green while new
dead exports piled up. The roadmap asked to raise the rules to `"error"`.

## Counts (symbols, `knip --reporter json`)

| Rule          | Before (main 3e17bc5c4) | After |
| ------------- | ----------------------- | ----- |
| `exports`     | 134 (33 files)          | 0     |
| `types`       | 116 (29 files)          | 0     |
| `duplicates`  | 8 files                 | 0     |
| `nsExports`   | 0                       | 0     |
| `nsTypes`     | 0                       | 0     |
| `enumMembers` | 0                       | 0     |

## Method

The `ignore: ["**/__tests__/**"]` entry only hides issues _reported in_ spec files; knip still
walks the specs as vitest entry files, so an export imported by a spec counts as used. Checked by
running knip once with the ignore removed: the finding list was identical. So every finding was
unused in production code and in specs alike (and, because `ignoreExportsUsedInFile` is on, unused
inside its own file too, except for re-export barrels where the original is used directly).

Decision per finding:

- **Barrel re-export nobody imports through the barrel**: drop it from the barrel (the module's
  own files and specs import the original file directly). `src/core/memory/index.ts`,
  `src/core/context-management/ledger/index.ts`, `src/core/tools/apply-patch/index.ts`,
  `src/core/mentions/index.ts`, `src/core/task-persistence/index.ts`,
  `src/core/webview/messageHandlers/index.ts`, `src/core/webview/worktree/index.ts`,
  `src/core/condense/index.ts`, `src/services/mcp/McpHub.ts` (`DisableReason`), the legacy
  `src/shared/*` stubs (`experiments`, `parse-command`, `getApiMetrics`, `WebviewMessage`,
  `tools`), the CLI barrels (`commands/cli/stdin-stream.ts`, `lib/utils/provider.ts`,
  `types/types.ts`, `ui/components/autocomplete/{index,AutocompleteInput,triggers/index}.ts`,
  `ui/components/tools/index.ts`, `ui/hooks/index.ts`) and `packages/vscode-shim/src/vscode.ts`.
- **Symbol unused anywhere**: deleted. CLI `MetricsDisplay` component (its `formatCost` helper
  moved into `InputFooter`, the only user), `resetOnboarding`, `ASCII_ROO`,
  `resolveVsCodeProviderConfig`, `truncateText` / `formatDiffStats` / `formatPath`, the flat theme
  aliases `bashBorder` / `diffAddedDimmed` / `diffRemovedDimmed` and the `Theme` type;
  `getSingleCommandDecision` (superseded by `getAnalyzedCommandDecision`); the default `read_file`
  tool constant; memory `ENTRYPOINT_NAME` alias in `paths.ts`, `SELECTOR_SYSTEM_PROMPT`,
  `getMemoryMtime`; the unused shadcn wrappers `DialogTrigger`, `DialogClose`, `CommandDialog`,
  `SelectLabel`, `DropdownMenu` / `DropdownMenuTrigger` / `DropdownMenuGroup` /
  `DropdownMenuPortal` / `DropdownMenuRadioGroup`, `PopoverAnchor`; `packages/build` schema types
  `Commands`, `MenuItem`, `Submenus`, `ConfigurationProperty`, `Contributes`; `vscode-shim`
  `types.ts` interfaces `TextDocument`, `TextLine`, `WorkspaceFolder`, `WorkspaceConfiguration`,
  `CancellationToken` (the used ones live in `interfaces/`); `CachePoint`, `MessageQueueState`,
  `ICodeIndexManager`, code-index `ValidationError`, `CustomSupportPrompts` (the real one is in
  `@roo-code/types`).
- **Used only inside its own file**: `export` dropped (`RESUME_THIN_TAIL_MAX_CHARS`, which was
  also the `duplicates` finding because it is `= RESUME_SNAPSHOT_MIN_CHARS`).
- **Duplicate default + named export**: kept the named export, removed `export default`, switched
  the default imports to named: `ErrorRow`, `WarningRow`, `TranslationProvider` (also the three App
  specs that mocked `default`), `ProfileViolationWarning`, `GenericTool`, `ToolBlock`,
  `TooManyToolsWarning`.
- A spec with a dead namespace import (`import * as surfacing` in `relevance.spec.ts`) lost it.

## Ignore list

None. No finding was intentional public API: `packages/types` had no findings (its surface is
consumed across the workspace), and no temporary ignore was needed for the files another helper
was editing (they had no findings before or after rebasing onto #598 / #599).

## Config change

`knip.jsonc` `rules`: all six rules set to `"error"`. The `"classMembers": "off"` entry was
removed: knip 6 has no such issue type and printed `Ignored unknown issue type "classMembers"` on
every run.

## Left for later

- `TooManyToolsWarning` (webview) is imported only by its own spec; production renders the
  too-many-tools warning through `TooManyToolsWarningRow` and `McpView`. It could be deleted with
  its spec in a separate item.
- `ToolBlock` is imported only by its spec because it is the brand-new UI primitive from #577,
  waiting for adoption; left as is.

## Verification

- `pnpm knip` exits 0 with every rule at `"error"` (after rebasing onto origin/main).
- `tsc --noEmit`: `src`, `webview-ui`, `apps/cli`, `packages/build`, `packages/vscode-shim`.
- eslint `--max-warnings=0` on every touched file; the pre-commit `turbo lint` passed, React
  Compiler bailouts unchanged (8 known).
- Specs of the touched modules (`--maxWorkers=2`): `apps/cli` 21 files / 466 tests, `src` 30 files
  / 531 tests, `webview-ui` 38 files / 270 tests, all green.
