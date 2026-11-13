# R3-11: vscode-e2e README + opt-in provider suites

Audit item: `ai_plans/simplification_round3_audit_2026-10-02.md`, finding 11 —
"e2e suite: non-hermetic and undocumented". Branch:
`chore/r3-11-e2e-readme-optin-providers`.

## Scope (from the audit)

- (a) A short README for `apps/vscode-e2e/`: how to run, what needs `.env.local`,
  which suites are smoke vs provider.
- (b) Provider suites (`src/suite/providers/`) made opt-in via "a naming/marker
  convention the runner can filter". **No test changes.**

## Mechanism

The workspace is Mocha inside `@vscode/test-electron`, not vitest — the audit's
"runner" is `src/suite/index.ts`, and its existing filter seam is the
`TEST_GREP`/`TEST_FILE` environment variables. So:

- **Marker = the `providers/` directory** (already the naming convention).
- **Filter = new `TEST_PROVIDERS` env var.** `suite/index.ts` passes
  `ignore: ["**/providers/**"]` to its glob unless `TEST_PROVIDERS=1`
  (only when no `TEST_FILE` is named — a named file always wins, so
  `TEST_FILE=zai.test` still works, matching the README).
- `runTest.ts` forwards `--providers` / `TEST_PROVIDERS` into the host.
- `package.json` gains `test:providers` = `TEST_PROVIDERS=1 pnpm test:run`.

## Files

- `apps/vscode-e2e/README.md` — new; suites table (smoke vs provider, what
  each needs), prerequisites (bundle + webview build, `.env.local`, xvfb),
  run commands, CI notes.
- `apps/vscode-e2e/src/suite/index.ts` — providers glob ignore unless opted in.
- `apps/vscode-e2e/src/runTest.ts` — forward the flag; comment updated.
- `apps/vscode-e2e/package.json` — `test:providers` script.
- `apps/vscode-e2e/.env.local.sample` — add `ZAI_API_KEY` (zai suite reads it).
- `.github/workflows/vscode-e2e.yml` — set `TEST_PROVIDERS: "1"` in the manual
  job so its executed set is unchanged (it relies on the hermetic
  `providers/zai.test`; deepseek keeps self-skipping without its key).

## Verification (no real keys used)

1. `tsc -p tsconfig.json --noEmit`, `tsc -p tsconfig.esm.json --noEmit`,
   `eslint src --max-warnings=0` — all pass.
2. Glob proof with the runner's exact pattern from compiled `out/`:
    - DEFAULT → 4 smoke files, no `providers/`;
    - `TEST_PROVIDERS=1` → 6 files including both provider suites;
    - `TEST_FILE=zai.test` → still selects the provider file (bypass by name).
3. Real default run (`xvfb-run -a pnpm test:run`, dummy `.env.local`, no keys):
   prints "Provider suites excluded (opt-in)", discovers only the 4 smoke
   suites, 1 passing (extension.test) + 6 pending (OpenRouter-dependent skip
   themselves), exit 0. Note: needed `env -u ELECTRON_RUN_AS_NODE` because the
   terminal is a VS Code-integrated one — pre-existing environment quirk, not
   touched.
4. Opt-in proof (`TEST_PROVIDERS=1 TEST_GREP="DeepSeek V4"`): the DeepSeek
   suite is discovered and self-skips (4 pending) without `DEEPSEEK_API_KEY`.
   No provider test with real credentials was executed.
5. CI: the only e2e workflow is `vscode-e2e.yml` (manual dispatch); the change
   pins `TEST_PROVIDERS: "1"` so the executed set there is byte-for-byte what
   it was before the gate.
6. `pnpm knip` — only the two known pre-existing findings (zoo-prs.mjs ×2) and
   the `.css` configuration note.

## Deviations from the audit text

- The audit says "marker/tag"; it does not name one. Chosen: the `providers/`
  directory as marker + `TEST_PROVIDERS=1` as the runner filter — this fits the
  Mocha/test-electron runner and its existing `TEST_*` convention (a vitest
  `--tag` CLI does not exist here; the task brief's "vitest config" wording does
  not apply to this workspace).
- The workflow edit goes one line beyond "README + marker": without it the
  manual CI job would silently lose its only hermetic provider coverage
  (zai). Flagged as a deliberate deviation to keep the default CI path
  unchanged, which the task brief explicitly requires.
