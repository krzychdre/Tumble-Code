# Phase 0: safety net

Goal: after this phase a green run means "nothing regressed" and a red run means "something regressed". Today
neither holds: main is red for unrelated flaky tests, some tests never run, and the Python suite depends on the
developer's private `.env`. All items are size S and change tests, CI or test configuration only.

## TEST-1 Stabilize the load-sensitive tests

**Evidence:**

- `apps/cli/src/ui/components/autocomplete/__tests__/AutocompleteInput.test.tsx`: failed in the local full run
  ("keeps delivering keystrokes to the prompt while the picker is open", `Error: picker state was never reported`
  at line 103) and in CI run 35987131490 on windows ("moves the highlight with the arrow keys while the picker is
  open"). Passes alone (5/5). `McpPanel.test.tsx` fails CI the same way (arrow key not registered before the frame
  is read).
- `src/__tests__/extension.spec.ts:246` "does not call dotenvx.config when optional .env does not exist": timed
  out at 20 s in the full local run, passes alone in 2.6 s. The test calls `vi.resetModules()` and re-imports the
  whole extension module graph, which is slow when all workers compete for CPU.
- 9 of the last 10 `code-qa` runs on main failed in `platform-unit-test`.

**Change:**

- Ink tests: replace fixed waits with polling on the observable (`await vi.waitFor(() =>
expect(lastFrame()).toContain(...))`, or wait for the picker-state callback) after each simulated keypress.
- `extension.spec.ts`: mock the heavy imports the test does not assert on, or give this file an explicit
  per-test timeout with a comment explaining the module-graph reload.

**Acceptance:** each fixed file passes 20 consecutive runs while the full suite runs in parallel
(`for i in $(seq 20); do npx vitest run <file> || break; done` alongside `pnpm turbo test`), and three
consecutive green `code-qa` runs on the PR.

## TEST-2 Run the orphaned webview tests

**Evidence:** `webview-ui/vitest.config.ts:15` includes only `src/**/*.spec.ts(x)`. Three files never run:
`src/utils/__tests__/path-mentions.test.ts` (17 cases), `src/components/settings/utils/__tests__/headers.test.ts`
(8), `src/components/settings/utils/__tests__/organizationFilters.test.ts` (9). Running them through a temporary
config (verified) adds 34 tests; one fails:
`path-mentions.test.ts:61` expects ``"/src/file\\ with\\ spaces & $ HOME `cmd`.txt"`` (only spaces escaped) but the
code also escapes `&`, `$` and the spaces around them.

**Change:**

1. Rename the three files to `.spec.ts` (keeps one convention; the `src` workspace accepts both, the webview
   only `.spec`).
2. Decide the failing case against the grammar the extension actually parses: read the mention regex in
   `src/shared/context-mentions.ts` and check which escapes it undoes. If the parser does not unescape `\&` and
   `\$`, the code is wrong (a path with `&` would not resolve); if it does, update the test. Either way the
   decision is written into the test comment.

**Acceptance:** webview test count rises from 1,570 to 1,604, all green.

**How the orphaned files were run without touching the repo** (useful to re-check before renaming): a temporary
config in `/tmp` that merges the webview config and adds `src/**/*.test.ts` to `include`, run with
`cd webview-ui && npx vitest run --config /tmp/orphan-vitest.config.mts --root .`. A config outside the repo must
import `vitest/config` by absolute path (`<repo>/webview-ui/node_modules/vitest/dist/config.js`), otherwise Node
cannot resolve the package.

## TEST-3 Quiet the test output

**Evidence:** the full `src` run prints hundreds of structured JSON log lines from the Bedrock provider logger
(`{"l":"error","m":"GENERIC error in createMessage","c":"bedrock",...}`) with full stack traces, which buries the
real failure summary. Cause: `src/utils/logging/index.ts:25` is inverted relative to its own comment,
`logger = process.env.NODE_ENV === "test" ? new CompactLogger() : noopLogger`. The real logger runs only under
test and writes with `process.stdout.write` (`CompactTransport.ts:98`), bypassing the `console` filter in
`src/utils/vitest-verbosity.ts`; in production all 65 `logger.*` calls are no-ops.

**Change:** one item together with owner decision 6: under test, use the no-op logger unless `VITEST_VERBOSE` is
set; in production, write to the extension's output channel at `info`. Tests that assert on logging inject a
logger explicitly.

**Acceptance:** the full run output fits on a screen when green; a failing test still prints its own logs;
provider errors appear in the Tumble Code output channel.

## TEST-4 Isolate the cloud API tests from the developer's `.env`

**Evidence:** `self-hosted-cloudapi/config/settings.py:19` loads `.env` from the working directory and `:160`
builds `Settings()` at import time. `tests/conftest.py:11-21` sets only 9 variables. A `.env` containing only
`WEB_ALLOWED_NETWORKS=192.168.50.0/24` makes 57 of 233 tests fail (probe in a copy); the real `.env` sets that key.

**Change:** `env_file=os.getenv("CLOUDAPI_ENV_FILE", ".env")`; `conftest.py` sets `CLOUDAPI_ENV_FILE=os.devnull`
before importing anything from `src`.

**Acceptance:** `make test` in the real checkout (with the real `.env` present) passes 233/233.

## TEST-5 CI job for the cloud API

**Evidence:** no workflow under `.github/workflows` mentions `self-hosted-cloudapi`. The `Makefile` lists `lint`
and `fmt` targets it never defines (`Makefile:12-13`).

**Change:** a workflow triggered on `self-hosted-cloudapi/**` running `uv sync --frozen --extra dev`,
`uv run pytest`, `uv run ruff check`, and `pip-audit` (advisory at first). Define the missing make targets. The
browser checks skip themselves when Chrome is absent; install Chrome in the job so they run.

## TEST-6 Dependency audit in CI

**Evidence:** no workflow runs `pnpm audit`; 6 critical production advisories went unnoticed.

**Change:** a job running `pnpm audit --prod --audit-level high`, non-blocking at first. After Phase 2 it becomes
blocking with an explicit, commented allowlist of accepted advisories (each with an expiry date).

## TEST-7 One working dependency-update bot

**Evidence:** both `.github/dependabot.yml` and `renovate.json` exist; none of the last 200 PRs came from a bot.
The Renovate GitHub App is most likely not installed on the fork [I].

**Change:** keep Renovate (its config already sets `forkProcessing` and ignores `@vscode/vsce`), install the app,
delete `dependabot.yml`, group updates (types, devtools, provider SDKs, webview) so each PR maps to one gate run.

## TEST-8 Webview bundle guard

**Evidence:** the webview imports `src/shared` through the `@roo/*` alias; `src/shared/modes.ts:1` imports
`vscode` and `:12` imports `src/core/prompts`. It builds only because Vite externalizes `vscode` and tree-shaking
drops the rest. Today's bundle source map contains 14 files from `src/shared`, 4 from `packages/core`, 0 from
`src/core`.

**Change:** a test that parses `src/webview-ui/build/assets/index.js.map` and fails if any source path under
`src/core`, `src/services`, `src/integrations` or the `vscode` module appears. It passes today and locks the
state in before PKG-6 and SVC-16 move code.

## TEST-9 Test-count ratchet (optional, recommended)

**Change:** a small script (`scripts/test-count-ratchet.mjs`) that reads vitest's JSON reporter output per
workspace and compares it with a committed `test-baseline.json`. It fails when a workspace loses tests unless the
baseline file is updated in the same commit, so deleted tests become a visible, reviewed decision.

## Characterization suites the later phases need

Each can be written as soon as Phase 0 is done, independently of the refactor it protects. Writing them early
also surfaces more hidden defects, as the audits did.

| Suite                                                                                                                      | Protects                     | Area item |
| -------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | --------- |
| Golden snapshots of `getState()` and `getStateToPostToWebview()` for empty, full and no-cloud fixtures, plus a parity test | Settings/state builder split | CORE-R1   |
| Routing snapshot: for each of the 149 webview message types, which provider methods run and which messages are posted      | Message-handler split        | CORE-R3   |
| Tool dispatch table: per tool name, which handler runs, whether a checkpoint is taken, the display string                  | Tool descriptors             | CORE-R4   |
| Delegation transition table over an in-memory `TaskHistoryStore`                                                           | Delegation service           | CORE-R2   |
| Recorded SSE chunk sequences replayed through every Chat Completions loop                                                  | Stream adapter               | API-7     |
| One Anthropic event script replayed through anthropic, minimax, anthropic-vertex                                           | Anthropic adapter            | API-2     |
| Responses API fixture events (#11621, #10719) through openai-native and codex                                              | Responses core               | API-13    |
| Per-handler error contract: 429/400/401 keeps `.status`                                                                    | Error contract               | API-1     |
| One golden render per say/ask/tool row kind (about 72)                                                                     | ChatRow split                | WEB-2     |
| Row-pipeline fixture snapshot (ts, type, grouping)                                                                         | ChatView pipeline            | WEB-1     |
| Exact `updatedSettings` payload, full and all-undefined state                                                              | Settings schema              | WEB-3     |
| Ask state machine table (about 25 branches)                                                                                | ChatView hooks               | WEB-8     |
| CLI `App` replay of recorded message sequences with frame snapshots                                                        | CLI state machine            | CLI-9     |
| `compute_user_metrics()` for a seeded dataset with malformed rows                                                          | SQL aggregation              | CAPI-M9   |
