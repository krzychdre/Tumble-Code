# Dependencies: attack surface, upgrades, runtime floor

Phase 2 (DEP-1 to DEP-5) removes what is unused and patches what can be patched without code changes. Phase 11
(DEP-6 to DEP-9) takes the large upgrades once the code they touch is smaller and better tested. Every DEP item is
its own branch; the lockfile diff is part of the review.

## Current state (2026-09-24)

- `pnpm audit`: 267 advisory entries, 10 critical, 121 high. Production trees only (`--prod`): 173 entries,
  6 critical, 88 high. Raw reports: regenerate with `pnpm audit --json` and `pnpm audit --prod --json`.
- `pnpm -r outdated`: 166 outdated, 85 at least one major behind, 4 deprecated
  (`@vscode/webview-ui-toolkit`, `@types/node-cache`, `@types/stacktrace-js`, `@types/diff`).
- Runtime floor: root `engines.node` is `20.20.2` (`.nvmrc`, `.tool-versions`); Node 20 reached end of life on
  2026-04-30. The extension declares `engines.vscode ^1.84.0` (`src/package.json:13`); VS Code runs
  extensions on Node 18 up to 1.89 (release notes: 1.86 ships Node 18.17.1, 1.90 is the first with Node 20), so the
  shipped bundle must still load on Node 18 while many current library majors require Node 20 or 22. Decided:
  raise the floor to `^1.102.0` (DEP-4).
- Types: the root `pnpm.overrides` forces `@types/react 18.3.23` on every workspace, including `apps/cli`, which
  runs React 19 with ink 6.6 (ink requires `@types/react >= 19`; lockfile key `ink@6.6.0_@types+react@18.3.23`).
- Python service: 20 unique advisory IDs in `uv.lock`, vendored DOMPurify 3.1.6 with 20 OSV advisories, floating
  container tags (details in `08-cloudapi.md`).

## Production advisories and their fix path

Grouped by package, worst severity first. "In range" means the declared range already admits the fixed version,
so only the lockfile changes.

| Package (locked)                                                                                       | Severity                                   | Reached through                                                                               | Fix path                                                                                                                                 | Item  |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------ | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| next 16.1.6                                                                                            | critical (2 unauthenticated RCE) + 28 more | `apps/web-evals`                                                                              | delete the app                                                                                                                           | DEP-1 |
| fast-xml-parser 5.2.5                                                                                  | critical                                   | `src > @aws-sdk/client-bedrock-runtime > @aws-sdk/core`                                       | in range: refresh `@aws-sdk/*` (declared `^3.922.0`), or override `>=5.7.0`                                                              | DEP-3 |
| shell-quote 1.8.3                                                                                      | critical                                   | direct in `src` and `webview-ui` (`^1.8.2`)                                                   | in range: 1.9.x                                                                                                                          | DEP-3 |
| tar 7.4.3                                                                                              | critical                                   | `webview-ui > @tailwindcss/vite > @tailwindcss/oxide` (build time only) and `web-evals`       | refresh `@tailwindcss/vite` (declared `^4.0.0`); move it to `devDependencies`                                                            | DEP-3 |
| vitest 3.2.4                                                                                           | critical (dev: UI server file read)        | every workspace                                                                               | in range: 3.2.6+                                                                                                                         | DEP-3 |
| @xmldom/xmldom 0.8.10                                                                                  | high (15 advisories)                       | `src > mammoth`                                                                               | refresh `mammoth`, else override to the patched 0.8.x                                                                                    | DEP-3 |
| axios 1.16.1                                                                                           | high (10)                                  | direct in `webview-ui` (`^1.16.1`)                                                            | in range: 1.18+ (the extension already declares `^1.18.0`)                                                                               | DEP-3 |
| js-yaml 3.14.1                                                                                         | high                                       | `src > gray-matter`                                                                           | override to the patched 3.x                                                                                                              | DEP-3 |
| jws 4.0.0                                                                                              | high                                       | `src > google-auth-library`                                                                   | in range: 4.0.1                                                                                                                          | DEP-3 |
| form-data 4.0.4                                                                                        | high                                       | `src > @anthropic-ai/sdk > @types/node-fetch`                                                 | existing override `>=4.0.4`: refresh to 4.0.6                                                                                            | DEP-3 |
| tmp 0.2.4, underscore 1.13.7                                                                           | high                                       | `exceljs`, `mammoth`                                                                          | in range patches                                                                                                                         | DEP-3 |
| ws 8.18.x                                                                                              | high                                       | `@google/genai`, `@lmstudio/sdk`                                                              | in range: 8.21+                                                                                                                          | DEP-3 |
| socket.io-parser 4.2.6                                                                                 | high                                       | `packages/cloud > socket.io-client`                                                           | in range: 4.2.7                                                                                                                          | DEP-3 |
| hono, @hono/node-server, fast-uri, ip-address, path-to-regexp, qs                                      | high/moderate                              | `@modelcontextprotocol/sdk 1.26.0` (pinned exactly in `src` and `packages/agent-interchange`) | bump the MCP SDK pin in both places together; McpHub and agent-interchange suites as gate                                                | DEP-3 |
| mermaid 11.15.0, dompurify 3.4.7                                                                       | moderate                                   | `webview-ui`                                                                                  | in range: mermaid 11.16.1+                                                                                                               | DEP-3 |
| preact, fflate                                                                                         | high/moderate                              | `webview-ui > posthog-js`                                                                     | in range refresh                                                                                                                         | DEP-3 |
| mdast-util-to-hast 13.2.0                                                                              | moderate                                   | `react-markdown`                                                                              | in range: 13.2.1                                                                                                                         | DEP-3 |
| undici 6.27.0                                                                                          | moderate                                   | direct in `src`, root override `^6.27.0`                                                      | in range: 6.28+                                                                                                                          | DEP-3 |
| postcss, nanoid                                                                                        | high                                       | build tooling (`vite`, `styled-components`) and `web-evals`                                   | refresh; the rest goes with DEP-1                                                                                                        | DEP-3 |
| minimatch 3.x/5.x                                                                                      | high                                       | `packages/ipc > node-ipc` and `web-evals > archiver`                                          | DEP-1 (owner decision 1 decided: remove `node-ipc`)                                                                                      | DEP-1 |
| drizzle-orm 0.44.1 (SQL injection), lodash, js-cookie, sharp, brace-expansion, @isaacs/brace-expansion | high                                       | `packages/evals`, `apps/web-evals`                                                            | delete                                                                                                                                   | DEP-1 |
| @ai-sdk/provider-utils                                                                                 | low                                        | `src > @ai-sdk/amazon-bedrock`, `@ai-sdk/deepseek`, `sambanova-ai-provider`                   | these packages have zero importers                                                                                                       | DEP-2 |
| uuid 8.3.2, 9.0.1                                                                                      | moderate                                   | `exceljs`, `gaxios`                                                                           | the fix is a major for those parents: check whether the advisory's code path is used, else accept with an expiry in the TEST-6 allowlist | DEP-3 |

## Phase 2 items

### DEP-1 Delete `apps/web-evals`, `packages/evals` and `packages/ipc` (owner decisions 1 and 2, decided)

**Evidence:** about 13,600 lines in 141 tracked files; since the rebrand only 3 fork commits touched them, all to
keep them compiling (#149, #126, #28). Their tests never run (`packages/evals` renamed its script to `_test`,
`web-evals` has none); `.github/workflows/evals.yml` needs a paid runner and never ran on the fork. Their lint and
type-check still run through turbo, so every change to `@roo-code/types` must keep them compiling.

**Savings (lockfile walk):** 149 of 2,076 locked packages are reachable only through them (Next.js with 8
`@next/swc-*` binaries, drizzle, better-sqlite3, libsql, sharp with 25 `@img/*` binaries, redis, postgres,
archiver); about a quarter of all advisory entries, including both critical Next.js RCE advisories. `tar` stays
(the webview also reaches it, see DEP-3).

**Change (owner decisions 1 and 2: remove all of it):**

1. Delete both workspaces, `.github/workflows/evals.yml`, the root `evals` script and the `apps/web-evals` knip
   section; then `packages/config-eslint/next.js`, `packages/config-typescript/nextjs.json` and
   `@next/eslint-plugin-next` (only web-evals uses them).
2. Delete `packages/ipc` and `node-ipc` (19 packages, bundled into every `extension.js` today). The IPC server is
   switched on only by the `ROO_CODE_IPC_SOCKET_PATH` environment variable (`src/extension.ts:369`), which only
   `packages/evals` sets (`runTaskInCli.ts:28`, `runTaskInVscode.ts:30`). In `src/extension/api.ts` remove the
   `IpcServer` import (`:23`), the `ipc` field (`:36`), the server start and `TaskCommand` handling (`:66-103`) and
   the broadcast (`:161`); **keep the `API` class itself**, it is the public extension API other extensions call.
   `enableLogging` is derived from the socket path (`extension.ts:370`): give it its own switch or drop it.
   Adapt `src/extension/__tests__/api-terminal-profile.spec.ts`. The IPC types in `packages/types`
   (`IpcMessageType`, `IpcOrigin`, `TaskCommand`, tested by `ipc.test.ts`) go too if knip reports them unused
   afterwards; check the CLI first.

**Gate:** G1 and G2; `pnpm install --frozen-lockfile` works; lockfile diff shows only removals.

**Status (2026-09-24):** DONE in #252. `apps/web-evals`, `packages/evals`, `packages/ipc`, `evals.yml`, the root
`evals` script, the Next.js eslint/tsconfig presets and the `evals-context` skill deleted; lockfile lost 170
packages, nothing added. `API` keeps every public method; `enableLogging` is a constructor flag defaulting to
false (today's behaviour for every user). Kept on purpose: the IPC types in `@roo-code/types` (`ipc.ts`,
`RooCodeIpcServer`, `ipc.test.ts`) and the `CommandsResponse`/`ModesResponse`/`ModelsResponse` event names, now
unused but part of the published types package (owner decision whether to drop them). Out of scope:
`src/services/command/built-in-commands.ts` `/init` prompt examples still name `packages/evals` and `packages/ipc`.

### DEP-2 Remove dependencies with zero importers

**Evidence:** knip's `ignoreDependencies` hides them (`knip.json:19-37` and per-workspace lists).

| Workspace           | Remove                                                                                                                                                                                                          | Proof                                                                                                                  |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `src`               | `@ai-sdk/amazon-bedrock`, `@ai-sdk/baseten`, `@ai-sdk/deepseek`, `@ai-sdk/fireworks`, `@ai-sdk/google`, `@ai-sdk/google-vertex`, `@ai-sdk/mistral`, `@ai-sdk/xai`, `sambanova-ai-provider`, `zhipu-ai-provider` | zero imports, leftovers of the AI SDK revert `6cfa82f57`                                                               |
| `src`               | `reconnecting-eventsource`                                                                                                                                                                                      | only feeds a global `EventSource` override (`McpHub.ts:838`) that MCP SDK 1.26 never reads; gate on `McpHub.spec` (51) |
| `packages/cloud`    | `ioredis` (7 packages), `p-wait-for`                                                                                                                                                                            | never imported                                                                                                         |
| `webview-ui`        | `rehype-highlight`, `source-map`                                                                                                                                                                                | zero imports                                                                                                           |
| `src`, `webview-ui` | `@types/node-cache`, `@types/stacktrace-js`                                                                                                                                                                     | deprecated stubs; the libraries ship their own types                                                                   |

**Change:** remove them and the matching knip ignore entries; every remaining ignore entry gets a comment saying
why. Later removals follow their refactors: `ai` and `@ai-sdk/openai-compatible` after API-4, `react-remark` after
WEB-11, `styled-components` after WEB-2.

**Status (2026-09-24):** DONE in #256. The 14 listed packages removed plus 12 more with no honest reason to stay
(`@roo-code/config-typescript` in src and webview, `@vscode/codicons` in src (icons ship from `src/assets`),
`@types/mocha`, `@types/katex`, `only-allow`, root `ovsx`, `cross-spawn` in the CLI, `esbuild` in core); lockfile
lost 52 packages. `reconnecting-eventsource` claim confirmed (SDK imports its own `eventsource`); a new McpHub test
pins that the global `EventSource` stays untouched. `knip.json` renamed to `knip.jsonc` so every remaining ignore
entry carries a reason; a run with all ignores disabled flags each remaining one. Noted for API-4:
`@ai-sdk/openai-compatible` is a devDependency although runtime code imports it (esbuild inlines it).

### DEP-3 In-range refresh

**Change:** refresh the lockfile within the declared ranges for the packages in the advisory table (one branch
per workspace group: extension, webview, packages). Move build-only packages in `webview-ui`
(`@tailwindcss/vite` and other Vite plugins) to `devDependencies` so `pnpm audit --prod` reflects what ships.
Review the root overrides: `glob >=11.1.0` now resolves to a version npm flags as deprecated, so raise it to the
current major if every consumer accepts it (check with `pnpm why glob`).

**Gate:** G1, G2, G5 (VSIX builds, the extension activates, one task runs end to end). After DEP-1 to DEP-3,
TEST-6 becomes blocking.

**Status (2026-09-24), extension and packages group:** DONE in #257. `pnpm audit --prod` outside webview-ui went
from 1 critical, 44 high, 24 moderate, 2 low to 1 moderate (`uuid`, accepted: exceljs and gaxios call only `v4()`,
belongs in the TEST-6 allowlist). MCP SDK 1.26.0 to 1.30.1 in src and agent-interchange (a single stdio message
over 10 MB is now rejected); `glob` override `^13.0.6`; new `fast-xml-parser ^5.7.0` override because
`@aws-sdk/xml-builder` 3.921 pins 5.2.5 and newer `@aws-sdk/*` need Node 20 (drop it after DEP-4); `undici
^6.28.1`. `shell-quote` is declared only by webview-ui. Webview group: separate branch.

**Status (2026-09-24), webview group:** DONE in #258. shell-quote 1.10.0 (own types, `@types/shell-quote` removed),
axios 1.20.0, mermaid 11.17.2 (dompurify 3.4.16), mdast-util-to-hast 13.2.1, tailwind 4.3.3 (drops `tar`), vite
8.3.1, webview vitest 3.2.7; `@tailwindcss/vite`, `tailwindcss`, `tailwindcss-animate` moved to devDependencies.
Whole-repo `pnpm audit --prod`: 2 critical, 17 high, 25 moderate, 4 low to 0, 3, 4, 0. Left: postcss under
styled-components (6.4+ pins csstype 3.2.3, breaks `CodeBlock.tsx` types with @types/react 18; goes with WEB-2),
js-cookie 2 under react-use (only `useCookie`, unused), uuid (see above). posthog-js kept at 1.242.1: its
`dist/module.js` is self-contained, so preact/fflate never reach the bundle; 1.434 adds about 150 KB. Main bundle
+53.5 KB (+0.9%). Not verified: a live render of Mermaid and Markdown (G5).

### DEP-4 Runtime floor and type overrides

**Change:**

1. Node for development and CI: 20.20.2 to the current Node 22 LTS in `engines`, `.nvmrc`, `.tool-versions`
   and the `setup-node` steps; align `@types/node` (packages mix `20.x` and `^24`) with the runtime.
2. **Raise `engines.vscode` from `^1.84.0` to `^1.102.0` (owner decision 12, decided).** Verified in the VS Code
   release notes on 2026-09-24:

    | VS Code                      | Electron   | Node in the extension host |
    | ---------------------------- | ---------- | -------------------------- |
    | 1.84 to 1.89 (today's floor) | 27 at 1.86 | 18.x (1.86: 18.17.1)       |
    | 1.90                         | 29         | 20.9.0 (first Node 20)     |
    | 1.98                         | 34         | 20.18.2                    |
    | 1.101 and 1.102              | 35         | 22.15.1 (first Node 22)    |

    `^1.102.0` gives a Node 22 extension host, which unblocks the library majors in DEP-6, and it matches the
    `@types/vscode ^1.102.0` that `packages/cloud` already compiles against (while the extension still declared
    1.84, so cloud code could call APIs older editors lack). Align every `@types/vscode` with the new floor:
    `src/package.json:599` and `packages/telemetry` (`^1.84.0`), `apps/vscode-e2e` (`^1.95.0`), `packages/cloud`
    (`^1.102.0`); `vsce` rejects `@types/vscode` newer than `engines.vscode`. The owner uses VS Code only; forks (Cursor, Windsurf,
    VSCodium) are out of scope. Update the README's requirements line and add a changeset.

3. Rescope the `@types/react` override to the webview (or drop it and pin per workspace) so `apps/cli`
   type-checks against React 19 types.

**Gate:** G1, G2, G5; CLI type-check with React 19 types may surface real errors, which are fixed in the same
branch only if they are type-level; behavior changes get their own DEF entry.

**Status (2026-09-24):** DONE in #259 (changeset `minor`). Node 22.23.3 in `engines`, `.nvmrc`, `.tool-versions`
and the shared `setup-node-pnpm` action; `@types/node ^22.20.4` everywhere; `engines.vscode ^1.102.0` with
`@types/vscode ^1.102.0` everywhere (vsce accepts the manifest). The global `@types/react`/`@types/react-dom`
overrides are gone: the webview keeps 18.3.x, the CLI declares `^19.2.0`; twelve webview libraries that use React
types without declaring them got an optional `@types/react` peer through `pnpm.packageExtensions` (otherwise
pnpm's hoisted 19 caused 575 TS errors; a new such library shows up as TS2786). One CLI type-only fix
(`usePickerHandlers` takes `RefObject<T | null>`). `@aws-sdk/*` refreshed in range to 3.1140.0, which no longer
depends on `fast-xml-parser`, so the DEP-3 override was dropped. CLI and agent-interchange build target `node22`;
the CLI installer requires Node 22 (breaking for CLI users on Node 20, owner may revert: three lines). Noted:
the optional-call guards on `onDidStartTerminalShellExecution` in `TerminalRegistry.ts` are now unnecessary.

### DEP-5 Python and container floors

See `08-cloudapi.md` section C for the table. **Change:** raise floors in `pyproject.toml`
(`starlette>=1.3.1`, `python-multipart>=0.0.31`, `pydantic-settings>=2.14.2`, and transitive floors
`cryptography>=50.0.1`, `anyio>=4.14.2`, `idna>=3.15`, `pyasn1>=0.6.4`), `uv lock --upgrade`; replace
`python-jose` with PyJWT (only `jwt_issuer.py:6, 57, 90, 100` use it; removes `ecdsa` with its unfixed
CVE-2024-23342); pin `python:3.13-slim` by digest (the dev venv is 3.13, the image 3.12), pin the `uv` image
version, pin `postgres:16.x` and the Redis major; plan the Authentik 2026.2 to 2026.8 upgrade (Authentik supports
only its two latest release lines [I]). **Test first:** `GET /bridge/socket.io/?EIO=4&transport=polling` returns
200 (the mount at `main.py:134-143`), so a Starlette upgrade that breaks the bridge fails a test.

**Status (2026-09-24):** DONE in #254. Floors raised (`starlette>=1.3.1`, `python-multipart>=0.0.31`,
`pydantic-settings>=2.14.2`; transitive floors as `[tool.uv] constraint-dependencies`), `uv lock --upgrade`;
`python-jose` replaced by PyJWT 2.15 with wire-format tests (hand-built HS256/RS256 tokens plus a fixed token
issued by python-jose 3.5.0 that must still verify); pip-audit 20 IDs to 0. The bridge polling test already
existed (DEF-C31), so a WebSocket handshake test was added instead. Images pinned: `python:3.13.15-slim` by digest
(image moves from 3.12 to 3.13), `uv:0.12.18` by digest, `postgres:16.15-alpine`, `redis:8-alpine`. The pip-audit
CI step is now blocking. Authentik upgrade: plan only, notes in the PR body. Open: the cloudapi workflow runs only
on path changes, so new advisories are not caught without a schedule; Starlette 1.7 deprecates `httpx` in its
test client.
Follow-up #255: the cloudapi workflow runs weekly (Monday 06:17 UTC) so pip-audit catches new advisories; the
FRESH/LEGACY/MANAGED reconciliation moved from `docker-entrypoint.sh` to `db-migrate.sh`, which `make migrate`
now uses too (plain `alembic upgrade head` fails on an empty database). Still open: the `httpx` deprecation. Owner follow-ups (#261 /init template placeholders, #262 IPC types removed from `@roo-code/types`, #263 Authentik
2026.8.3 pinned by digest in the compose, `grant_types: [authorization_code]` in the blueprint, `auth_redis`
removed; direct 2026.2 to 2026.8 is refused, path 2026.2.7 then 2026.5.7 then 2026.8.3, procedure in the #263
body; merged, not yet deployed on the live stack).

## Phase 11 items

### DEP-6 Provider SDK and runtime library majors (after Phase 5 and DEP-4)

One SDK per branch. Gate: the provider's spec files, the golden stream fixtures from API-2, API-7 and API-13, and
a live smoke test for each provider profile the owner actually uses.

| Package                                                                                                            | Locked                     | Latest                    | Notes                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------ | -------------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `@anthropic-ai/sdk`                                                                                                | 0.37.0                     | 0.128.0                   | 70 non-test files import it, most for message types; do after API-2 (one stream loop)                                        |
| `@anthropic-ai/vertex-sdk`                                                                                         | 0.7.0                      | 0.19.x                    | together with the above                                                                                                      |
| `openai`                                                                                                           | 5.12.2                     | 7.x                       | also in `packages/core`; after API-7 and API-13                                                                              |
| `@google/genai`                                                                                                    | 1.29.1                     | 2.x                       | gemini and vertex handlers                                                                                                   |
| `@mistralai/mistralai`, `ollama`, `@lmstudio/sdk`                                                                  | 1.x, 0.5, 1.x              | 2.x, 0.6, 2.x             | one handler each                                                                                                             |
| `google-auth-library`                                                                                              | 9.15.1                     | 11.x                      | vertex auth                                                                                                                  |
| `undici`                                                                                                           | 6.27.0                     | 8.x                       | root override pins `^6`; newer majors need Node 20+ (DEP-4)                                                                  |
| `web-tree-sitter`                                                                                                  | 0.25.6                     | 0.27.0                    | grammar WASM compatibility; do with SVC-15 real-WASM tests                                                                   |
| `diff`                                                                                                             | 5.2.2                      | 9.x                       | `src` and `webview-ui`; ships its own types (drop `@types/diff`)                                                             |
| `pdf-parse`                                                                                                        | 1.1.1                      | 2.x                       | 1.x is unmaintained and imported through `pdf-parse/lib/pdf-parse`; the API changed; add a PDF extraction fixture test first |
| `chokidar`, `p-limit`, `workerpool`, `serialize-error`, `isbinaryfile`, `os-name`, `delay`, `uuid`, `global-agent` | various                    | next major                | small, mostly ESM or Node-floor changes; batch by risk                                                                       |
| `i18next`, `react-i18next`                                                                                         | 25, 15                     | 26, 17                    | with DEP-8                                                                                                                   |
| `mermaid`, `shiki`, `katex`, `react-markdown`, `lucide-react`, `vscrui`                                            | 11, 3, 0.16, 9, 0.518, 0.2 | 12, 4, 0.18, 10, 1.x, 1.x | webview rendering; after WEB-2 golden renders exist                                                                          |
| `ink`, `commander`                                                                                                 | 6.6.0, 12                  | 7.x, 15                   | CLI; `ink` only after CLI-9's frame snapshots                                                                                |

### DEP-7 Toolchain majors

`vitest` 3 to current (after TEST-1, so new failures are real), `@vitest/ui`; `eslint` 10 with `@eslint/js` 10 and
`eslint-plugin-react-hooks` 7 (its compiler rule makes WEB-Q10 bailout reporting free); TypeScript 5.8.3 to the
latest 5.x first, a 6.x or native 7.x compiler only once `typescript-eslint`, vitest and knip support it; `knip`,
`esbuild`, `@changesets/cli`, `lint-staged`, `jsdom`, `@testing-library/jest-dom`, `@vitejs/plugin-react`,
`@vscode/vsce` (Renovate ignores it today; record why before changing), `ovsx`.

### DEP-8 React 19 and zod 4 (owner decision 11)

- React 19 in the webview (with `react-dom`, `@types/react` 19, `react-i18next` 17, testing-library); set the React
  Compiler target to 19 in `webview-ui/vite.config.ts`. After Phase 7, when the heavy components are small and
  covered by golden renders. This also unifies the monorepo on one React major (the CLI is already on 19).
- zod 4: the root override pins `zod 3.25.76`, which already ships `zod/v4`, so the migration can go package by
  package through `zod/v4` imports before the final switch. `packages/types` is consumed by the extension, the
  webview, the CLI and the cloud package, and `self-hosted-cloudapi/src/schemas` mirrors its shapes, so the
  cross-language fixtures from CAPI-M8 are the gate. Size L.

### DEP-9 Replace `@vscode/webview-ui-toolkit`

**Evidence:** Microsoft archived and deprecated the toolkit; 89 webview files import it (`VSCodeTextField`,
`VSCodeCheckbox`, `VSCodeLink`, `VSCodeButton`, `VSCodeDropdown` and others). The webview already has its own
components in `webview-ui/src/components/ui/` (`input`, `checkbox`, `button`, `select`, `radio-group`,
`toggle-switch` and more), and `vscrui` is used in 10 files.

**Change:** one toolkit component type per PR, replaced by the existing `ui/` component (add a thin wrapper where
props differ), with a manual visual check of every touched screen. Start with `VSCodeLink` and `VSCodeCheckbox`
(simple semantics), leave `VSCodeTextField` (most uses, focus behavior) for last.
