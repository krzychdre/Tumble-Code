# Zoo PR #182 — Harden checkpoint git env isolation + simple-git 3.36 template config

- **Upstream:** Zoo-Code #182, commit `0d3c35e18`, merged 2026-05-26 18:39:53Z, author Elliott de Launay.
- **Branch:** `feature/zoo-182-checkpoint-env-hardening` (off `main`).
- **Credit:** `Co-authored-by: Elliott de Launay <edelauna@gmail.com>`.

## Problem

`createSanitizedGit` (the helper behind every shadow-checkpoint git instance) only
stripped seven _location-override_ env vars (GIT*DIR, GIT_WORK_TREE, …). It left
\_code-execution* vectors — GIT*EDITOR, GIT_SSH_COMMAND, GIT_PAGER, PREFIX, EDITOR,
PAGER, etc. — inherited from the user's environment, which simple-git ≥3.36's
`blockUnsafeOperationsPlugin` treats as unsafe when passed via `.env()`. Bumping
simple-git (a step the fork's security-bump practice will eventually take) would
also start \_rejecting* the existing `git.init({ "--template": "" })` call, breaking
checkpoints. This PR fixes both axes together.

## Dependency bump (integral, not separable)

`simple-git ^3.27.0 → ^3.36.0` in `src/package.json` (+ lockfile). Required because:

- the new `unsafe: { allowUnsafeTemplateDir: true }` option does not exist in 3.27's
  types (would be a compile error), and
- 3.36 introduces `blockUnsafeOperationsPlugin`, which would reject `--template=""`
  and the blocked env vars unless we opt out / strip them.

The bump and the code change must land together to keep checkpoints working.

## Fix (product — `src/services/checkpoints/ShadowCheckpointService.ts`)

1. Export a `BLOCKED_ENV_KEYS` Set covering both categories (location-override +
   code-execution vectors: GIT_EDITOR, GIT_SEQUENCE_EDITOR, GIT_ASKPASS, GIT_SSH,
   GIT_SSH_COMMAND, GIT_PAGER, GIT_PROXY_COMMAND, GIT_EXEC_PATH, GIT_EXTERNAL_DIFF,
   GIT_CONFIG\*, GIT_CONFIG_COUNT, PREFIX, EDITOR, PAGER, SSH_ASKPASS, …). Stripping
   `GIT_CONFIG_COUNT` neutralises the whole GIT_CONFIG_KEY_n/VALUE_n family.
2. Add a lowercased `BLOCKED_ENV_KEYS_LOWER` for case-insensitive matching (the
   plugin lowercases internally, so `Git_Editor` would otherwise slip through).
3. Rewrite the env-filter loop in `createSanitizedGit` to skip any key whose
   lowercase form is in the set (tracking `removedKeys` for the debug log).
4. Add `unsafe: { allowUnsafeTemplateDir: true }` to `SimpleGitOptions` so the
   existing `git.init({ "--template": "" })` (axis-1 defence) survives 3.36's
   blockUnsafeOperationsPlugin.

## Tests (`src/services/checkpoints/__tests__/ShadowCheckpointService.spec.ts`)

- Import `BLOCKED_ENV_KEYS`; in `beforeAll`/`afterAll` save+strip then restore those
  keys (so a dev with GIT_EDITOR/etc. set globally still passes; safe under vitest's
  default `forks` pool).
- Add `await git.addConfig("commit.gpgSign", "false")` after each repo init (5 sites)
  so tests don't fail on machines with global commit signing.
- New e2e case: "isolates checkpoint operations from simple-git blocked environment
  variables" — sets `process.env.PREFIX`, runs save/getDiff/restore, asserts the
  checkpoint round-trips, cleans up PREFIX + temp dirs in `finally`.

## Scope / skip

No changeset (fork port workflow omits them). Product + tests + dependency bump.

## Verification

- `npx vitest run services/checkpoints/__tests__/ShadowCheckpointService.spec.ts` (from `src/`).
- Build gate: `pnpm install:vsix -y --editor=code` must be green before push.
