# Rebrand: built-in mode personas Roo → Tumble

**Date:** 2026-06-08
**Branch:** `rebrand/built-in-mode-personas` (off `main`)
**Parent plan:** [[2026-05-26_rebrand-roo-to-tumble-code]]

## Why

The master rebrand plan ([2026-05-26_rebrand-roo-to-tumble-code.md](2026-05-26_rebrand-roo-to-tumble-code.md))
covers manifest, NLS, README, locales, cloud URLs, icons — but never enumerated the
**system-prompt persona**. Every built-in mode's `roleDefinition` opens with
`"You are Roo, …"`, which is shipped verbatim to the model on every request. That is a
public-/model-facing brand string (guiding rule 1 of the master plan: _public-facing
string → change_), not an internal identifier (rule 2 keeps class names like `RooHandler`,
config keys `roo-cline.*`, `.roo/` dirs). So the persona name is in scope for the rebrand
and this branch closes that gap.

## Scope

Source of truth for built-in modes is `DEFAULT_MODES` in
[packages/types/src/mode.ts](../packages/types/src/mode.ts). Five role definitions changed:

| Mode         | Line             |
| ------------ | ---------------- |
| architect    | `roleDefinition` |
| code         | `roleDefinition` |
| ask          | `roleDefinition` |
| debug        | `roleDefinition` |
| orchestrator | `roleDefinition` |

`"You are Roo, …"` → `"You are Tumble, …"` (literal Roo→Tumble; the short persona name,
matching the display brand "Tumble Code").

### Custom project modes — `.roomodes`

Per user direction ("**all** 'You are Roo' → Tumble; Roo may only appear in lineage/history"),
the persona rename also covers the custom project modes in [.roomodes](../.roomodes). Five
`roleDefinition`s renamed:

| Mode (slug)        | `.roomodes` line | Original opener                                                       |
| ------------------ | ---------------- | --------------------------------------------------------------------- |
| translate          | 4                | `You are Roo, a linguistic specialist…`                               |
| pr-fixer           | 36               | `You are Roo, a pull request resolution specialist…`                  |
| merge-resolver     | 47               | `You are Roo, a merge conflict resolution specialist…`                |
| docs-extractor     | 79               | `You are Roo Code, a codebase analyst…` (the lone "Roo Code" variant) |
| issue-investigator | 101              | `You are Roo, a GitHub issue investigator…`                           |

All → `You are Tumble, …`. After this, `.roomodes` contains **no** "Roo" token at all.

**Not touched** (out of scope / internal per master rule 2, or owned by other rebrand branches):

- `description` / `whenToUse` fields — verified no "Roo" present.
- Other built-in prompt sections (`src/core/prompts/sections/*`, `tools/*`) — only internal
  identifiers there (`getAllRooDirectoriesForCwd`, `.roo/` dirs), no brand prose.
- Product/brand "Roo Code" in package docs (e.g. `packages/ipc/README.md`) — these are doc
  strings owned by the master plan's README/docs branch (§4.6), not persona prompt text.

## Test fallout (handled in this branch)

- `src/shared/__tests__/modes.spec.ts:615,636` — hardcoded debug `roleDefinition` assertion
  updated to "You are Tumble, …".
- Active file snapshots regenerated via `vitest run -u`:
  `add-custom-instructions/{architect,ask,mcp-server-creation-disabled}-mode-prompt.snap`,
  `system-prompt/{consistent-system-prompt,with-mcp-hub-provided,with-undefined-mcp-hub}.snap`.
- Removed **5 orphaned** file snapshots that no test references
  (`system-prompt/with-diff-enabled-{false,true,undefined}.snap`,
  `with-computer-use-support.snap`, `with-different-viewport-size.snap`) — left behind by an
  earlier refactor (last touched in #11031), still carrying the stale "You are Roo" string.
  Verified unreferenced by repo-wide grep before deletion.

## Validation

- `npx vitest run core/prompts/__tests__ shared/__tests__/modes.spec.ts -u` → 130 passed.
- Repo-wide `grep "You are Roo"` clean across `packages/types` and `src` (excl. build artifact
  `src/dist/extension.js` and `.claude/worktrees/`).

## Follow-ups

- `.roomodes` persona rename (custom modes) — separate branch if the project wants it.
- The stale `src/dist/extension.js` still contains the old string; it is a build output and
  regenerates on next `pnpm bundle`.
