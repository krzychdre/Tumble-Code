# R3-2: memory/dream defaults into SETTINGS_DEFAULTS

Item R3-2 of the round-3 simplification audit
(`ai_plans/simplification_round3_audit_2026-10-02.md`). Branch:
`refactor/r3-2-memory-dream-defaults`.

## What

The five memory/dream settings had inline literal defaults at every call
site, forking the "one table" invariant of `SETTINGS_DEFAULTS`
(CORE-R1/D2):

| Key                    | Default |
| ---------------------- | ------- |
| `autoMemoryEnabled`    | `true`  |
| `memoryRecallEnabled`  | `true`  |
| `autoDreamEnabled`     | `true`  |
| `autoDreamMinHours`    | `24`    |
| `autoDreamMinSessions` | `5`     |

This moves them into the table and makes every call site read the table.
Pure refactor of where the defaults live — no value changes.

## How (strict order, per the audit item)

1. **Table first**: the five keys added to `packages/types/src/settings-defaults.ts`
   in a memory block next to the condense settings, plain literals like
   the rest of the table.
2. **Call sites** (both workspaces), all now `?? SETTINGS_DEFAULTS.<key>` /
   `default: SETTINGS_DEFAULTS.<key>`:
    - `webview-ui/src/components/settings/schema.ts` — the five rows; also
      fixed the FALSE comment claiming ContextProxy migrates these keys
      (it only passes them through).
    - `src/core/task/TaskLifecycle.ts` — the dream config gate.
    - `src/core/task/Task.ts` — the memory-recall coordinator gate.
    - `src/core/memory/paths.ts` — the master enable gate
      (`return true` → `?? SETTINGS_DEFAULTS.autoMemoryEnabled`).
    - Plus the other webview fallbacks the guard would flag once it scans
      webview-ui: `MemorySettings.tsx` (dropped the now-unused local
      `DEFAULT_DREAM_HOURS`/`DEFAULT_DREAM_SESSIONS`), `MemoryActivityBadge.tsx`,
      `extensionStateReducer.ts` initial state.
    - `src/core/webview/ProviderStateBuilder.ts`: the five keys removed from
      `PASSTHROUGH_SETTING_KEYS` — they are `SETTINGS_DEFAULT_KEYS` now, so
      `pick(settings, SETTINGS_DEFAULT_KEYS)` already carries them (resolved).
      This makes a never-set key arrive in the webview state as its default
      instead of `undefined`, the same consequence D2 accepted for every
      other table key; comment corrected there too.
3. **Guard**: `scripts/check-settings-defaults.mjs` now scans `webview-ui`
   too (`SCAN_DIRS`), and its two duplicated scan bodies were collapsed
   into one `scan(keys, rootDir)`. The widened scan surfaced 39
   pre-existing webview literal fallbacks on OTHER table keys; those were
   fixed the same D2 way (literal → `SETTINGS_DEFAULTS.<key>`) where the
   literal matched the table value, and 5 genuine non-default fallbacks
   went to the guard's `ALLOWED` list with reasons:
    - `ApiConfigManager.tsx:29`, `:135` and `ComposerToolbar.tsx:53` —
      `""` display/optional-prop guards (not the default config name
      `"default"`).
    - `TerminalSettings.tsx:339` — stale display literal (`50` vs table `0`);
      changing what the label shows is a UI change, out of scope.
    - `ExtensionStateContext.tsx` / `useAutoApprovalState.ts` /
      `App.tsx` / reducer etc. — exact-value literals, replaced.

`pruneBeforeCondense` stays out of the table (resolved via
`isPruneBeforeCondenseEnabled`, documented design) — untouched, as
instructed. Its `schema.ts` row already used `PRUNE_CONDENSE_DEFAULTS`.

## Tests

- `packages/types`: `settings-defaults.spec.ts` gained a block asserting
  the five values (11/11 pass).
- `scripts`: guard test gained a webview-ui scan case; 7/7 pass
  (`node --test`). `node scripts/check-settings-defaults.mjs` exits 0
  ("clean (73 table keys checked)").
- `src`: `core/memory` 322 pass; `ClineProvider.stateBuilder.spec.ts` +
  `TaskLifecycle.abort-memory-writers.spec.ts` 33 pass; the 4 golden
  snapshots updated via `-u` — the diff is exactly
  `undefined → true/24/5` for the five keys in the "empty ContextProxy"
  and "missing CloudService" cases.
- `webview-ui`: MemorySettings/SettingsView/checkbox specs 43 pass;
  `src/context` 157 pass.
- `tsc --noEmit` clean in `src`, `webview-ui`, `packages/types`.
- `pnpm knip` from root: only the known pre-existing failures
  (zoo-prs.mjs ×2, the .css note) — nothing new.

## Known follow-up

`TerminalSettings.tsx:339` shows "50ms" for an unset `terminalCommandDelay`
although the table default is 0 — ALLOWED-listed, needs a deliberate UI
decision.
