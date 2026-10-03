# R3-4c: deduplicate SkillMetadata/SkillContent (one canonical definition)

Date: 2026-10-03 · Branch: `chore/r3-4c-skillmetadata-dedup` · Base: main @ `ee25b804f` (post R3-4b, PR #770)

## Scope (from the audit)

`ai_plans/simplification_round3_audit_2026-10-02.md`, finding 4, bonus sub-item: the
`SkillMetadata`/`SkillContent` interface duplication itself (`src/shared/skills.ts` vs
`packages/types/src/skills.ts`) — one copy should import or re-export the other so the two
cannot drift.

## Why the duplication existed (investigation)

- `git log --follow` on both files shows they were born together in upstream commits
  (`#10913`/`#11084` skills rework, re-applied in `#11475`) — the same interfaces were pasted
  into the new `packages/types` package while the original `src/shared` copy stayed. Not a
  deliberate layering boundary.
- Layering rules (docs/architecture.md): `packages/types` is a leaf that everyone may import;
  `src` already declares `"@tumble-code/types": "workspace:^"` (src/package.json:517) and
  imports it in dozens of files. Nothing points up the graph, so making `src` consume the
  types copy adds no edge.
- Consumer census before the change:
    - `packages/types/src/skills.ts` `SkillMetadata`: webview (`SkillsSettings.tsx`,
      `ExtensionStateContext.tsx`, `extensionStateReducer.ts`, specs) and
      `skillsMessageHandler.ts` — all already importing `@tumble-code/types`.
    - `src/shared/skills.ts`: only 5 src files (SkillsManager, skillInvocation + spec,
      `core/mentions/index.ts`, `prefix-determinism.spec.ts`). The webview never imported it.
    - `SkillContent` existed ONLY in the `src/shared` copy.
- Conclusion: `packages/types` is the canonical home (it also owns `validateSkillName` and the
  skills constants there); dedup does not break any boundary. No STOP condition.

## Changes

1. `packages/types/src/skills.ts`: added the missing `SkillContent` interface
   (extends `SkillMetadata`, `instructions: string`) right after `SkillMetadata` — shape
   identical to the deleted copy, post-R3-4b (no `mode`).
2. Deleted `src/shared/skills.ts` entirely. A re-export shim was attempted first, but with all
   consumers rewired it had zero importers and knip flagged it as an unused file — deleted
   instead (same treatment as the R3-4a backoff shim).
3. Rewired the 5 src import sites from `../../shared/skills` to `@tumble-code/types`:
    - `src/services/skills/SkillsManager.ts` (also re-exports the types, unchanged)
    - `src/services/skills/skillInvocation.ts`
    - `src/core/mentions/index.ts`
    - `src/services/skills/__tests__/skillInvocation.spec.ts`
    - `src/core/prompts/sections/__tests__/prefix-determinism.spec.ts`

Public type shape unchanged everywhere (type-only change; no runtime behavior).

## Verification

- `grep -rn "shared/skills" src webview-ui packages apps` → no import hits (only unrelated
  `/shared/skills` fixture path strings in SkillsManager.spec.ts).
- Touched suites green (CPU-friendly, only touched suites):
    - src: 21 files / 241 tests (services/skills, prompts sections, mentions, skillsMessageHandler,
      skillTool, runSlashCommandTool, command-mentions)
    - webview-ui: SkillsSettings.spec.tsx 23 tests
    - packages/types: extension-host message/surface specs 9 tests
- `npx tsc --noEmit`: packages/types clean, src clean.
- `pnpm knip`: exits 1 with ONLY the two pre-existing findings (zoo-prs.mjs twins) + the known
  `.css` configuration hint. (The interim re-export shim appeared as a third unused file and was
  removed.)
- `node scripts/find-test-only-exports.mjs --check`: exit 0.

## Deviations

- The task suggested "make the other re-export or type-alias it"; the re-export was implemented
  first, but knip correctly reported the shim as an unused file once all consumers pointed at
  `@tumble-code/types` directly, so the shim was deleted rather than kept. One definition
  remains, which satisfies the audit's intent ("the two cannot drift").
