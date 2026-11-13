# R3-4b: remove dead `mode?` field from both `SkillMetadata` copies

Date: 2026-10-02 · Branch: `chore/r3-4b-skillmetadata-dead-mode` · Source: `ai_plans/simplification_round3_audit_2026-10-02.md` §4(b)

## Goal

`SkillMetadata` exists in TWO identical copies (`src/shared/skills.ts` and `packages/types/src/skills.ts`). Both carry a `@deprecated mode?: string` that is assigned on every skill load but read by NO code. Delete the field, its assignment, and its test fixtures; keep the real backward-compat path (`frontmatter.mode` legacy read in `SkillsManager.ts` lines 194-196) intact.

## Collision residue check (step 0)

- `git status --porcelain` showed 3 modified leftovers from a parallel session: `scripts/check-settings-defaults.mjs`, `webview-ui/src/components/settings/TerminalSettings.tsx`, its spec.
- `git fetch && git diff origin/main -- <files>` → EMPTY: content-identical to main (equivalent fixes landed via PR #769, squash 4f4f6c5b4). The local branch was simply behind.
- Plain `git pull` refused (would "overwrite" the local edits); resolved by backing the 3 files up to `/tmp/r3-4b-residue-backup/`, `git checkout --` them, then fast-forward pull. Post-pull `diff` against the backups: **identical** — provably lossless. Tree clean, live-tree work continued (no /tmp worktree needed).

## Audit-claim verification (before deleting)

- Grepped all files importing/typing `SkillMetadata` for `.mode` reads: the only matches were webview `state.mode` (UI mode, unrelated) and `frontmatter.mode` (the legacy SKILL.md frontmatter read that stays). No code reads `SkillMetadata.mode`. Audit confirmed correct.
- R3-4c (SkillMetadata/SkillContent dedup) explicitly NOT done here — separate follow-up.

## Changes

1. `src/shared/skills.ts` — deleted the `@deprecated mode?: string` field + doc comment.
2. `packages/types/src/skills.ts` — same deletion in the second copy.
3. `src/services/skills/SkillsManager.ts` (was line 212) — deleted `mode: primaryMode,` from the `target.set(...)` construction. `primaryMode` local KEPT (still used by `getSkillKey` at line 205). `frontmatter.mode` legacy read (194-196) untouched.
4. `src/core/webview/__tests__/skillsMessageHandler.spec.ts:80` — removed `mode: "code"` fixture field.
5. `src/services/skills/__tests__/SkillsManager.spec.ts` — 3 assertions (`skills[0].mode`/`testSkill?.mode` → now `.modeSlugs`) converted to assert `modeSlugs: ["code"]`. These verify real mode-specific discovery behavior, so they were migrated to the live field rather than deleted.

## Verification

- Touched suites green (from correct workspace dirs):
    - `src`: `SkillsManager.spec.ts` + `skillsMessageHandler.spec.ts` (66), plus the 6 other skill-touching suites `roo-directory-precedence`, `skillTool`, `runSlashCommandTool`, `system-prompt-parity`, `prompts/sections/skills`, `prefix-determinism` (55). Total 121 passed / 8 files.
- `tsc --noEmit` exit 0 in `src`, `packages/types`, `webview-ui`.
- `pnpm knip` → only the two known pre-existing findings (`zoo-prs.mjs` ×2, `.css` note). Acceptable per task definition.
- `node scripts/find-test-only-exports.mjs --check` → exit 0.
- `node scripts/check-settings-defaults.mjs` → exit 0 (clean, 73 table keys).

## Deviations from the audit text

- Audit named `SkillsManager.ts:212` — file lives at `src/services/skills/SkillsManager.ts` (audit omitted the path prefix), same line.
- Audit only named the fixture at `skillsMessageHandler.spec.ts:80`; grep additionally found 3 assertions in `SkillsManager.spec.ts` reading `.mode`. Migrated to `.modeSlugs` (they assert real discovery behavior that survives).
