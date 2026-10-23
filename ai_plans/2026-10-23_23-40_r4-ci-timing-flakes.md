# R4: two CI timing flakes and the ripgrep download token after the final verification

**Status:** done.
**Related plans:** `2026-10-23_17-20_maintenance-audit-round-4.md`, `2026-10-23_21-57_r4-final-green.md`.
**Touched files:** `apps/cli/src/ui/components/__tests__/Spinner.test.tsx`,
`src/core/tools/__tests__/RunParallelTasksTool.spec.ts`, `.github/actions/setup-node-pnpm/action.yml`, the audit
doc.

## Problem

The Code QA run on `main` for #997 failed twice (the second attempt was a `gh run rerun --failed`):

1. Ubuntu, CLI: `Spinner > shows the time of the whole turn and of the current step` saw the old clock
   (`total 16m 16s`) after `advanceTimersByTimeAsync(1000)`. The spinner's timers update state, and React renders
   those updates through its scheduler on a real macrotask (it captured `setImmediate` before the fake timers were
   installed). Fake timers never run that task; the test passed only when the real event loop happened to run it
   before the assertion. Proof: with `vi.advanceTimersByTime(1000)` the frame stays unchanged every time.
2. Windows, src: `settled()` in `RunParallelTasksTool.spec.ts` waited for `endFanOut` with the 1 s default of
   `vi.waitFor` (1 test red, then 9 on the rerun). Each finished subagent writes the sidecar under a file lock;
   subagents that end together contend for it, and the lock retries back off 100, 200, 400, 800 and 1000 ms.
   Locally the wait already reaches 350 ms (two backoff steps); the Windows runner is several times slower.
3. The first run of this PR failed in `pnpm install` (compile job): `@vscode/ripgrep` 1.17, pinned again in #997,
   downloads `rg` from the GitHub API in its postinstall, and unauthenticated runners hit the rate limit (HTTP 403).
   #991 had removed the action's `GITHUB_TOKEN` because 1.18 has no install script.

## Change

1. The Spinner tests render, rerender and advance the clock inside `act()` (with `IS_REACT_ACT_ENVIRONMENT`
   stubbed for the describe), so React renders every update before the assertion. The tests are synchronous now.
2. `settled()` waits up to 10 s; it still returns as soon as the fan-out ends.
3. The composite action passes `GITHUB_TOKEN` (input `github-token`, default `github.token`) to `pnpm install`
   again; the postinstall sends it to GitHub hosts only.

## Tests

- `Spinner.test.tsx` 16/16 and `RunParallelTasksTool.spec.ts` 65/65, repeated.
- Mutation checks: `advance()` without `act()` turns two Spinner tests red on every run; shifting `total` by one
  second in `Spinner.tsx` turns three red.
