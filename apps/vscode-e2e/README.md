# VS Code e2e tests

Integration tests that load the built extension in a real VS Code instance
(downloaded by `@vscode/test-electron`) and drive it through its API. The
test framework inside VS Code is Mocha (`tdd` UI); there is no vitest here.

## Suites

| File                                      | Kind              | Needs credentials?                                                                              |
| ----------------------------------------- | ----------------- | ----------------------------------------------------------------------------------------------- |
| `src/suite/extension.test.ts`             | smoke             | no                                                                                              |
| `src/suite/task.test.ts`                  | smoke             | `OPENROUTER_API_KEY` (self-skips without it)                                                    |
| `src/suite/modes.test.ts`                 | smoke             | `OPENROUTER_API_KEY` (self-skips without it)                                                    |
| `src/suite/markdown-lists.test.ts`        | smoke             | `OPENROUTER_API_KEY` (self-skips without it)                                                    |
| `src/suite/providers/deepseek-v4.test.ts` | provider (opt-in) | `DEEPSEEK_API_KEY`, or `AIMOCK_URL` for a mock server (self-skips without either)               |
| `src/suite/providers/zai.test.ts`         | provider (opt-in) | no — a fetch interceptor answers; `ZAI_API_KEY` switches it to passthrough against the real API |

Everything under `src/suite/providers/` is **opt-in**: the default run excludes
it because the provider suites talk to (or emulate) real provider APIs and the
DeepSeek one needs a real key.

## Prerequisites

1. `pnpm install` at the repo root.
2. A built extension and webview: `pnpm test:ci` builds both first
   (`pnpm -w bundle` + webview build) and then runs the tests. If you build
   manually, run those two steps before `pnpm test:run`.
3. Credentials in `apps/vscode-e2e/.env.local` (copy from `.env.local.sample`):
    - `OPENROUTER_API_KEY` — for the three model-backed smoke suites.
    - `DEEPSEEK_API_KEY`, `ZAI_API_KEY` — only for the opt-in provider suites.
      The file is loaded by `dotenvx`; keys left out simply cause the dependent
      suites to skip.
4. Linux without a display: run under `xvfb-run -a` (see
   `.github/workflows/vscode-e2e.yml`).

## Running

```bash
# Default: smoke suites only (providers/ excluded)
pnpm test:run

# Opt in to the provider suites (providers/ included)
pnpm test:providers
# or equivalently:
TEST_PROVIDERS=1 pnpm test:run
pnpm test:run -- --providers
```

Subsets and other knobs (see `src/runTest.ts`):

```bash
TEST_FILE="task.test" pnpm test:run       # one file (name or path suffix)
TEST_GREP="apply-diff" pnpm test:run      # tests whose title matches
VSCODE_VERSION="1.102.0" pnpm test:run    # pin the VS Code version
```

`TEST_FILE` bypasses the providers filter — naming a provider file directly
still runs it, with or without `TEST_PROVIDERS`.

## CI

`.github/workflows/vscode-e2e.yml` is manual-dispatch only (no secrets are
passed in). It sets `TEST_PROVIDERS=1` so the hermetic `providers/zai.test`
keeps running there; `providers/deepseek-v4.test` self-skips without its key,
and the smoke suites that need OpenRouter skip themselves.
