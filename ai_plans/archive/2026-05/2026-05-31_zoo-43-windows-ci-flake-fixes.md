# Zoo PR #43 — Windows CI flake fixes & test stabilization

**Upstream:** Zoo-Code PR #43 (`fix/windows-chatview-scroll-flake-...`), merged 2026-05-10
**Branch:** `feature/zoo-43-windows-ci-flake-fixes` (off `main`)
**Type:** Test-infra / flake stabilization. No product behavior change.
**Triage was SKIP; user checked `[x] PORT` — porting per approval.**

## What the upstream PR does

A bundle of independent CI-stability fixes:

1. **`.github/workflows/code-qa.yml`** — append `${{ github.sha }}` to the turbo cache
   key so the unit-test cache doesn't stay cold/poisoned.
2. **`src/vitest.config.ts`** — on Windows CI (`win32` + `CI=true`), force
   `poolOptions.forks.singleFork = true` to stop cross-worker flakes.
3. **`gemini-handler.spec.ts` / `vertex.spec.ts`** — mock `@roo-code/telemetry`'s
   `TelemetryService.instance.captureException` so real telemetry calls don't fire/flake;
   clear the mock in `beforeEach`.
4. **`executeCommandTool.spec.ts`** — `vitest.useRealTimers()` in `beforeEach`/`afterEach`
   to stop fake-timer leakage between tests.
5. **`WorkspaceTracker.spec.ts`** — minor stabilization (file absent in our fork).
6. **glob specs** (`file-watcher`, `gitignore-integration`, `gitignore-test`,
   `list-files-limit`, `list-files`) — rewrite timing-sensitive assertions to be
   deterministic on Windows.
7. **`ChatView.scroll-debug-repro.spec.tsx`** — replace real `setTimeout`/`waitFor`
   polling with `vi.useFakeTimers()` + `advanceTimersByTimeAsync`, deterministic chevron
   helpers, and `afterEach` timer cleanup.

## Scope in our fork (verified by content hash vs upstream pre-image `5eb7d6fec`)

| File                                   | State                                          | Action                                    |
| -------------------------------------- | ---------------------------------------------- | ----------------------------------------- |
| `gemini-handler.spec.ts`               | == upstream PRE                                | copy post-image                           |
| `vertex.spec.ts`                       | == upstream PRE                                | copy post-image                           |
| `executeCommandTool.spec.ts`           | == upstream PRE                                | copy post-image                           |
| `glob/gitignore-integration.spec.ts`   | == upstream PRE                                | copy post-image                           |
| `glob/gitignore-test.spec.ts`          | == upstream PRE                                | copy post-image                           |
| `glob/list-files-limit.spec.ts`        | == upstream PRE                                | copy post-image                           |
| `glob/list-files.spec.ts`              | == upstream PRE                                | copy post-image                           |
| `src/vitest.config.ts`                 | DIVERGED (no coverage block)                   | manual: add `isWindowsCI` + `poolOptions` |
| `ChatView.scroll-debug-repro.spec.tsx` | DIVERGED by +9 lines (our cloud-upsell mocks)  | apply PR hunks, preserve our mock block   |
| `WorkspaceTracker.spec.ts`             | **MISSING in fork**                            | out of scope                              |
| `glob/file-watcher.spec.ts`            | **MISSING in fork**                            | out of scope                              |
| `.github/workflows/code-qa.yml`        | DIVERGED — no turbo `.turbo/cache` step at all | N/A, skip (cache key doesn't exist here)  |

Tumble naming: `@roo-code/telemetry` is an internal package id (stays). No user-facing
strings touched.

## Plan

1. Copy the 7 clean-apply files verbatim from upstream post-image (`bd06cd5bb`).
2. Edit `src/vitest.config.ts`: add `const isWindowsCI = process.platform === "win32" &&
process.env.CI === "true"` and the `poolOptions: isWindowsCI ? { forks: { singleFork:
true } } : undefined` entry in the `test` block.
3. Port `ChatView.scroll-debug-repro.spec.tsx`: take upstream post-image, re-insert our
   9-line cloud-upsell mock block (CloudUpsellDialog + useCloudUpsell) at the same spot.
4. Skip `code-qa.yml`, `WorkspaceTracker.spec.ts`, `file-watcher.spec.ts` (N/A — log it).

## Verification

- Run the affected specs with vitest (core + webview) — all green.
- Build gate: `pnpm install:vsix -y --editor=code` — must be green before push.

## Credit

Co-authored-by: Hannes Rudolph <49103247+hannesrudolph@users.noreply.github.com>
Co-authored-by: Roomote <roomote@roocode.com>
