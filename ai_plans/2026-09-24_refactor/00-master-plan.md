# Refactor master plan (2026-09-24)

**Status:** Phase 0 and Phase 1 done (2026-09-24); owner decisions 1, 2, 3, 4a, 4b, 6, 8, 9, 10 and 12 recorded on 2026-09-24. Written on
branch `docs/refactor-plan-2026-09-24` (commit `b99049cdb` and its follow-up), not pushed, not merged.
**Supersedes:** `ai_plans/refactor-backend-src.md`, `ai_plans/2026-07-14_src-refactor-plan.md`,
`ai_plans/2026-07-14_webview-ui-refactor-plan.md`, `ai_plans/refactor-webview-ui.md`,
`ai_plans/refactor-packages.md`, `ai_plans/new-packages-versions.md`. Their still-open items were re-verified
against `main @ 0c0b40b15` and folded into the area documents below; items marked DONE there are not repeated.

## Next session: start here

The refactor is executed in new sessions; everything needed is in this directory. Steps for the first session:

1. **Workflow per item (owner rules, 2026-09-24; merge each PR as soon as its non-Windows checks pass, never let PRs pile up).** The plan stays on `docs/refactor-plan-2026-09-24`; it is
   not merged into `main`. For every item:

    1. `git switch docs/refactor-plan-2026-09-24` and read the item in its area document;
    2. create the item branch from an up-to-date `main` (`git fetch origin && git switch -c <type>/<item>
origin/main`, type one of `test`, `fix`, `refactor`, `chore`, `docs`);
    3. implement test-first and run the gates;
    4. push the branch to GitHub, open a PR, merge it once CI is green;
    5. switch back to the docs branch, add the item's status line (date, PR number, merge commit, test counts
       before and after, deviations from the plan) and commit it there.

2. **Re-measure the baseline** with the commands in "Baseline" below and compare with the recorded numbers; note
   any difference in this file before changing code (other work may have landed in between).
3. **Start with Phase 0** (`01-safety-net.md`, TEST-1 first, because main's CI is red for flaky tests), then
   DEF-S1 and the cloud API security groups from `02-defects.md`.
4. **One branch per item** (`test/...`, `fix/...`, `refactor/...`, `chore/...`), stacked when files overlap;
   commit each finished item immediately; `pnpm knip` exits 0 before any push.
5. **After each item,** also update the Status column of its phase in the roadmap below (on the docs branch).
6. **Before an item that depends on an "Open" owner decision,** ask the owner and record the answer in the
   decisions table.

## Request

"Plan the refactor of the application. Find evident architecture problems, places where the code can be
simplified, where duplication can be reduced and where performance can be improved. Modularity and ease of
maintenance by a human come first. Every change must be backed by tests, and the tests must not fail after the
change. There is also room to upgrade the libraries to mitigate potential holes and vulnerabilities."

## How this plan was built

Five independent read-only audits (extension core, providers and services, webview UI, CLI and packages,
self-hosted cloud API) plus a dependency audit and a full baseline run of every gate. Every finding carries a
`file:line` reference checked against the live tree. The headline defects were re-verified by hand after the
audits (reproduction commands are recorded next to each defect in `02-defects.md`). Claims that are reasoned
from code but not reproduced are marked **[I]** (inference); everything else is verified.

## Documents

| File                           | Contents                                                                 |
| ------------------------------ | ------------------------------------------------------------------------ |
| `00-master-plan.md`            | This file: principles, gates, baseline, roadmap, open decisions          |
| `01-safety-net.md`             | Phase 0: make the test gates trustworthy before anything moves           |
| `02-defects.md`                | Phase 1: confirmed bugs, security first, each fixed test-first           |
| `03-dependencies.md`           | Phase 2 and 11: attack-surface removal, upgrades, runtime floor          |
| `04-extension-core.md`         | `src/core`, `src/activate`, `src/extension.ts`                           |
| `05-providers-and-services.md` | `src/api`, `src/services`, `src/integrations`, `src/utils`, `src/shared` |
| `06-webview-ui.md`             | `webview-ui`                                                             |
| `07-cli-packages-repo.md`      | `apps/cli`, `packages/*`, workspace boundaries, repository hygiene       |
| `08-cloudapi.md`               | `self-hosted-cloudapi` (Python)                                          |

Item IDs are prefixed by area: `TEST-`, `DEF-`, `DEP-`, `CORE-`, `API-`, `SVC-`, `WEB-`, `CLI-`, `PKG-`, `CAPI-`.

## Principles

1. **Tests before movement.** A refactor that moves or reshapes code starts with a _characterization test_: a
   test that pins today's observable behavior, bugs included. It lands in its own commit, passes before the move,
   and must pass unchanged after the move. If a characterization test has to change during the move, the move is
   not behavior-preserving and must be split.
2. **Bugs are fixed test-first, never inside a refactor.** A defect gets its own branch: a failing test that
   reproduces it (red), then the fix (green). A refactor commit that also changes behavior is rejected.
3. **Drift is the strongest argument for deduplication.** Priority goes to duplicated code whose copies have
   already diverged (a fix applied to one copy only). Duplicates that have not drifted and are small stay.
4. **One branch per item, stacked when files overlap** (repo convention). Each finished item is committed
   immediately. `pnpm knip` must exit 0 before any push.
5. **Weak-model and mode-switch safety.** Any change to prompts, tool schemas or tool protocols must still work
   for GLM, Qwen and local Llamas, and must stay correct when a task switches mode (and therefore model and
   context window) mid-way.
6. **Measure before optimizing.** Performance items start with a counter or a benchmark on a real task; no
   optimization lands without a before/after number.
7. **Each executed item updates its area document** (status line, commit, deviations) so this directory stays the
   single source of truth.

## Gates (every item, every branch)

| Gate             | Command                                        | Required result                                                                                                             |
| ---------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| G1 unit tests    | `pnpm turbo test --continue`                   | all green; test count per package not lower than the baseline table unless the item's entry lists the deleted tests and why |
| G2 static checks | `pnpm check-types`, `pnpm lint`, `pnpm knip`   | exit 0                                                                                                                      |
| G3 cloud API     | `cd self-hosted-cloudapi && uv run pytest`     | all green, run with the test-isolated environment from TEST-4                                                               |
| G4 CI | `code-qa.yml` (and the workflows the change triggers) on the PR | every check green except `platform-unit-test (windows-latest)`: owner rule of 2026-09-24, do not wait for Windows before merging; a Windows failure later seen on main becomes its own item |
| G5 build         | `pnpm vsix` and, for CLI items, the CLI bundle | builds; for UI items a manual smoke of the touched screen                                                                   |

Gate G1 is only meaningful once Phase 0 has removed the flaky and orphaned tests; until then a red run must be
compared test-by-test against the baseline below.

## Baseline (measured 2026-09-24 on `main @ 0c0b40b15`)

**Unit tests** (full `pnpm turbo test --continue`, then flaky files re-run in isolation):

| Workspace                          | Test files | Tests              | State                                                                                                                              |
| ---------------------------------- | ---------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `src` (extension)                  | 501        | 7,583 (38 skipped) | 1 flaky: `src/__tests__/extension.spec.ts` "does not call dotenvx.config..." times out at 20 s under full load, passes alone (4/4) |
| `apps/cli`                         | 85         | 1,029 (1 skipped)  | 1 flaky: `AutocompleteInput.test.tsx` "picker state was never reported", passes alone (5/5); the same file fails CI                |
| `webview-ui`                       | 140        | 1,570              | green, but 3 `*.test.ts` files (34 tests) never run; enabling them shows 1 failure at `path-mentions.test.ts:61`                   |
| `packages/types`                   | 25         | 304                | green                                                                                                                              |
| `packages/cloud`                   | 15         | 304                | green                                                                                                                              |
| `packages/vscode-shim`             | 23         | 408                | green                                                                                                                              |
| `packages/core`                    | 11         | 157                | green                                                                                                                              |
| `packages/agent-interchange`       | 7          | 114                | green                                                                                                                              |
| `packages/telemetry`               | 1          | 31                 | green                                                                                                                              |
| `packages/build`                   | 2          | 2                  | green                                                                                                                              |
| `packages/ipc`                     | 0          | 0                  | no tests                                                                                                                           |
| `packages/evals`, `apps/web-evals` | 7 files    | not run            | test script renamed to `_test`                                                                                                     |
| `self-hosted-cloudapi`             | 13         | 233                | green in a clean copy; 57 fail when the developer `.env` sets `WEB_ALLOWED_NETWORKS`; no CI runs it                                |

**Static checks:** `pnpm check-types` 14/14 green. `pnpm knip` exit 0 with warnings only: 55 unused exports,
30 unused exported types, 8 unused enum members, 9 duplicate exports.

**CI:** 9 of the last 10 `code-qa` runs on `main` failed, every time in `platform-unit-test`, driven by the CLI
Ink input tests (`AutocompleteInput.test.tsx`, `McpPanel.test.tsx`). A permanently red main hides real
regressions, which is why Phase 0 comes first.

**Dependencies:** `pnpm audit` reports 267 advisory entries (10 critical, 121 high); 173 of them are in production
dependency trees (6 critical, 88 high). `pnpm -r outdated` lists 166 outdated packages, 85 of them at least one
major version behind, 4 deprecated. The repository pins Node `20.20.2`; Node 20 reached end of life on
2026-04-30. The Python service has 20 unique advisory IDs in its lockfile and vendors DOMPurify 3.1.6 (20 OSV
advisories).

## Roadmap

Phases 0 to 3 are sequential and short. After Phase 3 the area phases (4 to 9) touch mostly disjoint files and can
run as parallel lanes; inside a lane the listed order matters. Size: S under a day, M one to three days, L more.

| Phase               | Goal                                             | Items (in order)                                                                                                                                                                                                                                                                          | Size            | Status      |
| ------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | ----------- |
| 0 Safety net        | Gates tell the truth                             | TEST-1 flaky Ink and extension tests, TEST-2 orphaned webview tests, TEST-3 test-output noise, TEST-4 cloud API env isolation, TEST-5 cloud API CI job, TEST-6 dependency-audit CI job, TEST-7 one working update bot, TEST-8 webview bundle guard                                        | S each          | DONE 2026-09-24 (#200 to #209); TEST-9 (optional) not done; Renovate needs the owner to install its GitHub App |
| 1 Defects           | Fix confirmed bugs before code moves             | Security: DEF-S1 to DEF-S12. Correctness: DEF-C1 to DEF-C32 (see `02-defects.md` for order)                                                                                                                                                                                               | S each, a few M | DONE 2026-09-24 (#210 to #250; DEF-C8 closed as not a bug; findings DEF-C33 to C40, TEST-10, TEST-11 added and done; see `02-defects.md` Status) |
| 2 Attack surface    | Remove what nobody uses, patch within ranges     | DEP-1 delete evals apps, DEP-2 dead dependencies, DEP-3 in-range refresh, DEP-4 Node 22, VS Code floor and type overrides, DEP-5 Python and container floors, PKG-8 repository hygiene                                                                                                    | S-M             | DONE 2026-09-24 (#251 to #259; follow-ups #253, #255); pending: final full run, TEST-6 blocking with allowlist, G5 manual smoke |
| 3 Foundations       | Cheap structure that every later phase relies on | PKG-1 `safeWriteJson` into core, PKG-2 boundary rules, PKG-3 shared nightly build config, PKG-4 pin CLI render deps, PKG-5 typed CLI runtime contract, PKG-9 CI gaps, CORE-Q and API-Q dead code and quick wins, CORE-R10 layering, CORE-R5 typed Task access, PKG-10 architecture map    | S-M             | DONE 2026-09-24 (#264 to #273; PKG-3 was already in #245) |
| 4 Extension core    | Break up the god objects                         | CORE-R1 settings table and state builder, CORE-R3 message-handler modules, CORE-R2 delegation service, CORE-R9 tool callbacks, CORE-R4 tool descriptors, CORE-R8 edit pipeline, CORE-R12 per-task tool state, CORE-R11 prompt input, CORE-R6 rest of ClineProvider                        | M-L             | not started |
| 5 Providers         | One adapter per wire protocol                    | API-1 error contract, API-3 strict schema, API-2 Anthropic stream, API-Q quick wins, API-4 retire AI SDK path, API-6 provider definitions (+ PKG-7 schema copies), API-7 Chat Completions adapter, API-5 cancellation, API-13 Responses core, API-18 Bedrock split, then DEP-6 SDK majors | M-L             | not started |
| 6 Services          | Lifecycles and single implementations            | SVC-8 McpHub, SVC-10 code-index lifecycle, SVC-9 embedder base, SVC-11 `.roo` resolver, SVC-12 ripgrep runner, SVC-15 tree-sitter cache, SVC-14 terminal contract, SVC-16 `src/shared` layering, SVC-17 DiffView remainder                                                                | M-L             | not started |
| 7   | Remove `migrateSettings` (drops migration for installs older than 2025)?                                                                               | **Decided** | Yes, remove it (owner 2026-09-24, Phase 3 CORE-Q item 9)                                                                            |
| 8 CLI and packages  | Share logic instead of re-implementing it        | CLI-5 duplicated logic slice by slice, PKG-6 browser-safe `src/shared` package, CLI-9 single state machine, PKG-11 remaining package structure                                                                                                                                            | M-L             | not started |
| 9 Cloud API         | Maintainable Python service                      | CAPI-M3 telemetry vocabulary, CAPI-M4 formatting, CAPI-M5 split `web.py`, CAPI-M6 route dependencies, CAPI-M7 config, CAPI-M8 cross-language fixtures, CAPI-M10 migration drift test, CAPI-M9 SQL aggregation, CAPI-M11 bridge queries                                                    | S-M             | not started |
| 10 Performance      | Measured wins only                               | CORE-R7 steps 1 to 4, WEB-1 parse cache (already in Phase 7), API performance items P1 to P9, CORE-R7 step 5 last                                                                                                                                                                         | S-M             | not started |
| 11 Framework majors | Large upgrades on a clean base                   | DEP-7 toolchain majors, DEP-8 React 19 and zod 4, DEP-9 replace `@vscode/webview-ui-toolkit`                                                                                                                                                                                              | L               | not started |

### Why this order

- **Phase 0 before everything:** the owner's rule "tests must not fail after the change" is unenforceable while
  main is red for unrelated reasons and some tests never run.
- **Phase 1 before refactors:** almost every defect lives in code a refactor would move. Pinning it with a test
  first stops the move from silently "fixing" or re-breaking it, and two of them are exploitable today.
- **Phase 2 early:** deleting unused apps removes about a quarter of the advisory entries (including both
  critical Next.js remote-code-execution advisories) and shrinks the surface every later refactor must keep
  compiling.
- **Phase 3 before the area phases:** the boundary rule and typed Task access make the large moves in Phases 4
  to 8 fail at compile time instead of at runtime.
- **SDK majors after provider consolidation:** after Phase 5 there is one stream loop per protocol instead of up
  to eight, so an SDK upgrade touches a handful of files instead of twenty.
- **Framework majors last:** React 19, zod 4 and the UI-toolkit replacement touch hundreds of files; doing them
  on top of smaller, better-tested components is far cheaper.

## Headline findings (details in the area documents)

- **Security, extension:** command auto-approval bypass. `getCommandDecision("echo \\' && rm -rf /tmp/x \\'",
["echo"], ["rm"])` returns `auto_approve`, but bash runs the `rm`. Reproduced (DEF-S1).
- **Security, cloud API:** stored XSS on public share pages, account takeover through the unvalidated
  `auth_redirect`, cross-user conversation overwrite, unauthenticated LLM proxy, wide-open CORS on the bridge,
  vendored DOMPurify with 20 advisories. All reproduced by probe tests in a copy (DEF-S2 to DEF-S12).
- **Correctness:** Anthropic and MiniMax cost excludes output tokens; the live system prompt lost the
  `.rooignore` instructions in May; `search_replace` corrupts `$` in replacements; Stop does not abort the HTTP
  request for about 16 provider handlers; OpenAI tool schemas are mutated in place for the whole process; the
  CLI installer downloads upstream's releases.
- **Architecture:** `ClineProvider.ts` grew from 4,414 to 5,011 lines since July and carries 14 responsibilities;
  `webviewMessageHandler.ts` is one 3,520-line function with 149 cases; adding a native tool touches 12 places
  in 9 files; two workspaces import app source through `../../../src`, creating a file-level cycle.
- **Duplication with drift:** 8 separate OpenAI Chat Completions stream loops, 3 Anthropic loops, 2 near-forked
  Responses API handlers, settings defaults written in 3 places that disagree, the CLI re-implementing tool and
  provider logic the extension already has.
- **Performance:** the chat view re-parses every tool payload in the history on every streamed token (measured
  up to 95.6 ms per recompute on a real 405-message task); every new message triggers a full state push and a
  full O(n) history save with no debounce.
- **Dead weight:** `apps/web-evals` and `packages/evals` (149 locked packages, never run), 10 unused AI SDK
  packages, 112.9 MB of upstream release images in `releases/` (81% of the tracked tree), 12 dead message
  handler cases, 35 unused webview state setters.

## Owner decisions

Recorded on 2026-09-24. "Decided" rows are binding for execution; "Open" rows proceed with the recommendation
only after the owner confirms it (ask at the start of the item that depends on it).

| #   | Question                                                                                                                                               | Status      | Answer or recommendation                                                                                                            |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Keep the external IPC automation socket (`packages/ipc`, `node-ipc`, bundled into every `extension.js`)? Its only in-repo client is the evals package. | **Decided** | Remove, together with DEP-1 (details in `03-dependencies.md`)                                                                       |
| 2   | Delete `apps/web-evals` and `packages/evals`?                                                                                                          | **Decided** | Yes (DEP-1)                                                                                                                         |
| 3   | Delete `releases/` (upstream PNGs, 112.9 MB) from the tree? History stays.                                                                             | **Decided** | Yes, and drop the image links from `CHANGELOG.md` (PKG-8)                                                                           |
| 4a  | `terminalShellIntegrationTimeout` default: 4,000 (webview initial state) / 30,000 (SettingsView Save fallback) / 5,000 ms (host)?                      | **Decided** | The longest existing value: **30,000 ms**, defined once in the CORE-R1 defaults table and used by the host, the webview and the CLI |
| 4b  | `soundEnabled` (false / true / false) and `enableCheckpoints` (true / false / true) defaults                                                           | **Decided** | The host value: `soundEnabled` false, `enableCheckpoints` true                                                                      |
| 5   | Unknown model ID: keep the ID, substitute the default, or honor it as custom? Providers disagree today.                                                | Open        | Honor custom IDs with default capabilities (as Anthropic and Gemini do)                                                             |
| 6 | Production logging is a no-op (`src/utils/logging/index.ts` returns a real logger only under test). Intended? | **Decided** | No: write it to the Tumble Code output channel at `info` (TEST-3) |
| 7   | Remove `migrateSettings` (drops migration for installs older than 2025)?                                                                               | Open        | Yes                                                                                                                                 |
| 8   | Keep the cloud API LLM proxy endpoints?                                                                                                                | **Decided** | No: **remove them entirely** (endpoints, `proxy_service`, settings, tests), owner 2026-09-24; DEF-S5 becomes the removal  |
| 9   | Should `new_task` and `generate_image` create checkpoints (they do in one list, not in the other)?                                                     | **Decided** | Yes, both (owner 2026-09-24): the set follows the checkpointing call sites, pinned by a test; `list_code_definition_names` leaves the list |
| 10 | Renovate or Dependabot? Both are configured, neither opened a PR in the last 200. | **Decided** | Renovate; remove `dependabot.yml` (TEST-7). The owner installs the Renovate GitHub App |
| 11  | When to take React 19 and zod 4?                                                                                                                       | Open        | After Phases 7 and 8 (Phase 11)                                                                                                     |
| 12  | Raise the minimum VS Code version (`engines.vscode ^1.84.0`, a Node 18 extension host) to unblock library upgrades?                                    | **Decided** | Yes: **`^1.102.0`** (Node 22.15.1 extension host; verified in the VS Code release notes, table in `03-dependencies.md` DEP-4)       |

## Do not touch (collected from all audits)

These look bad but encode tested race fixes or deliberate contracts. Change them only in a dedicated item with
the named tests in place.

- `clineMessagesSeq`, the three `postStateToWebview*` variants and the `sourceTaskId` routing in the webview
  state merge (stale-snapshot races).
- `cancelTask` and abort ordering with its `pWaitFor` bounds; the global `lastGlobalApiRequestTime` rate limit.
- `TaskHistoryStore` (66 tests, multi-window file races).
- The legacy `read_file` `files` shape and the tool-name aliases (weak models still send them).
- The Ink render pipeline in the CLI (`streamCommit`, `TailViewport`, `useInsertionEffect` ordering,
  `theme.dimmed`) until CLI-9's characterization tests exist.
- The esbuild externals in `src/esbuild.mjs` (global-agent, esbuild, ripgrep); align nightly to them.
- The security pins in the root `pnpm.overrides` (except rescoping `@types/react`, see DEP-4).
- The public shape of `ExtensionMessage` and `WebviewMessage` until the CLI shares code (narrow additively).
- `useScrollLifecycle` and the ChatRow height contract (manually verified scroll-follow).
- Cloud API: the monotonic `ON CONFLICT` upsert, `response_model_exclude_none=True`, share returning 404 for
  unknown tasks, the `/bridge` socket path, the database bootstrap classification, SQLite as test database,
  the denormalized summary columns.
- `packages/vscode-shim`, `src/core/memory`, the portable plus runtime provider registries, the per-protocol
  message converters.

## Glossary

- **Characterization test:** pins current behavior, including known bugs, so a move can be proven neutral.
- **Drift:** two copies of the same logic that no longer agree because a fix reached only one of them.
- **Gate:** a check an item must pass before merge (G1 to G5 above).
- **Stacked branches:** branch B is created from branch A when both touch the same files, and merged in order.
- **Change-point count:** the number of places that must be edited to add one feature (a tool, a setting); the
  main maintainability metric used here.
- **Flaky test:** passes or fails depending on timing or machine load rather than on the code.
