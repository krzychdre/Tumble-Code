# R3-4a: Remove the packages/cloud backoff shim (2026-10-02)

Implements finding 4(a) of `ai_plans/simplification_round3_audit_2026-10-02.md`. 4(b) (dead
`SkillMetadata.mode`) and 4(c) (interface duplication) are separate tasks and are NOT touched here.

## Problem

`packages/cloud` was historically forbidden from importing `@tumble-code/core`, so it got its own
backoff shim: `packages/cloud/src/backoff.ts`, a 2-line re-export of
`backoffDelayMs` / `BackoffOptions` from `@tumble-code/core/backoff` (the helper consolidated in
D1/PR #546). The dependency restriction was resolved by the R3-1/#762 alias work, so the shim is
now a pure extra import hop with no seam value.

## Pre-flight verification (done before any edit)

- `packages/cloud/package.json` declares `"@tumble-code/core": "workspace:^"` in `dependencies` —
  the cloud→core dependency direction is allowed at the package-manager level.
- `knip.jsonc` has no `ignoreDependencies` entry hiding `@tumble-code/core` in the
  `packages/cloud` workspace; the import is legitimately visible to knip.
- The shim itself already imported from `@tumble-code/core/backoff`, confirming the direction was
  de-facto in use since the D1 consolidation.
- Grep confirmed nothing imports `backoffDelayMs`/`BackoffOptions` via `@tumble-code/cloud`
  (the `index.ts` re-export had zero external consumers).

## Changes

1. `packages/cloud/src/RefreshTimer.ts` — import `backoffDelayMs` from
   `@tumble-code/core/backoff` (was `./backoff.js`).
2. `packages/cloud/src/bridge/BridgeOrchestrator.ts` — same repoint (was `../backoff.js`).
3. `packages/cloud/src/retry-queue/RetryQueue.ts` — same repoint (was `../backoff.js`).
4. `packages/cloud/src/index.ts` — dropped the `backoffDelayMs`/`BackoffOptions` re-exports
   (no external consumers).
5. Deleted `packages/cloud/src/backoff.ts` (the shim).
6. Deleted `packages/cloud/src/__tests__/backoff.spec.ts` — per the audit it is a strict subset of
   `packages/core/src/__tests__/backoff.spec.ts`, so it is deleted, not redirected. The core
   spec (untouched) remains the single coverage home for `backoffDelayMs`.

## Verification

- `packages/cloud` touched suites green: RefreshTimer.test.ts, RefreshTimer.backoff.spec.ts,
  BridgeOrchestrator.rearm.spec.ts, RetryQueue.test.ts, RetryQueue.per-item-backoff.spec.ts —
  5 files, 59 tests passed.
- `packages/cloud` `tsc --noEmit` clean.
- `pnpm knip` from root: only the two known pre-existing findings
  (`.claude/.../zoo-prs.mjs`, `.roo/.../zoo-prs.mjs` — by design) plus the `.css` configuration
  hint; nothing new.
- `node scripts/find-test-only-exports.mjs --check` exits 0.
- `grep -rn "backoff" packages/cloud/src` shows only `@tumble-code/core/backoff` imports —
  no shim references remain.
- `packages/core/src/backoff.ts` was NOT touched, so its test suite is unchanged (verified
  untouched by the diff).

## Out of scope (per audit and task instructions)

- R3-4b: dead `mode?: string` on `SkillMetadata` (both copies) — separate task.
- R3-4c/bonus: `SkillMetadata`/`SkillContent` interface duplication — separate task.
- The `frontmatter.mode` read in `SkillsManager.ts` — real backward compatibility, stays.
