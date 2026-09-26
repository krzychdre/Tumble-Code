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

## Open leftovers (collected 2026-09-25, after Phase 6)

One list of everything found but not done; details sit in the named status paragraph. "Take care of the leftovers"
means: work through this list (one branch per item), then strike each line here.

- ~~Windows CI: `src` vitest dies silently~~ DONE: not a crash, two assertion failures hidden by the truncated
  `gh run view --log`; the runner's 8.3 short TEMP path vs `fs.promises.realpath`. Fixed in #341 (merge 99d28803c),
  its Windows job passed in 20 min. The debug branch is gone from the remote.
- Memory writers: closing VS Code or the CLI on the final `completion_result` ask still skips them: WON'T FIX (owner
  decision 15). ~~`hasMemoryWritesSince` reads `toolUses`~~ DONE #344 (5ead450cb): 0 of 1,042 real task files carry
  `toolUses`; the gate now reads answered tool asks into the memory dir. ~~Chat completions never reach
  `captureTaskCompleted`~~ DONE #346 (00a24b428): the accepted abandon records it once, no public `TaskCompleted`;
  self-hosted DB had 63 Task Created, 0 Task Completed. The CLI clears through the same `clearTask` path, so
  "the CLI never answers `completion_result`" is covered by #339 and #346.
- ~~SVC-8: one write-guard flag covers both MCP settings files~~ DONE #342 (ca3e0fb0a): one guard timer per file.
- ~~SVC-10: folders added later get a manager only lazily~~ DONE #345 (b2735d167): they were never indexed at all in a
  multi-root window; `startCodeIndexForFolder` on `event.added`; also fixed dispose during `initialize()` leaking a
  watcher.
- ~~SVC-9: `deletePointsByMultipleFilePaths` untested~~ DONE #348 (406b68c29): 22 tests; found it swallowed Qdrant
  errors since upstream 11c454ffa (stale points forever), now rethrows. ~~Query prefix applied to indexed code~~ DONE
  #350 (2d10090e9): only `nomic-embed-code` has a prefix; documents now embed without it, legacy collections carry
  no `document_prefix` marker and are rebuilt once. Open: `collectionExists` treats any error as "missing".
- ~~SVC-11: gitignored `.roo` dirs are never found by the subfolder scan~~ WON'T FIX: owner decision 13, the scan keeps respecting gitignore.
- ~~SVC-12: `@`-mention search spawns `rg` per query~~ DONE #352 (847787e92): file list plus fzf index cached per root,
  invalidated by `WorkspaceTracker` create/delete and ignore-file events, 30 s TTL; typing "mention" 7 walks to 0,
  about 390 to 185 ms on this repo. ~~`handleError` sends the stack to the model~~ DONE #349 (90135414d): message and
  cause chain only, full error to the log.
- ~~SVC-17: a diff opened for a truncated path is not reopened~~ DONE #347 (208e4da3b): reproduced with the real
  parser (partial-json drops a split `\u002e` escape, so `write_to_file` wrote `a/b` instead of `a/b.ts`);
  a session for another path is reverted in `handlePartial` and `execute`.
- Earlier owner questions: ~~dispose leak~~ done in #309; ~~retry policy~~ DONE #343 (5c6a3e517, owner decision 14):
  401/403/404 not auto-retried in foreground tasks, a declined retry ends the loop, the unattended CLI exits 1 instead
  of hanging; background tasks DONE #353 (47e9fa63d): 401/403/404 end them at once, other errors always back off
  (with auto-approve off they used to re-request in a tight loop through the auto-approved ask) and stop after 7
  attempts (about 315 s), the parent or memory drain gets one failure line; ~~stale DeepSeek catalog~~ DONE #351 (ea164246e,
  decision 16): `deepseek-flash` default, `deepseek-v4-flash` alias, `deepseek-chat`/`-reasoner` deprecated, effort
  `low` no longer sent as `high`. Open from #351: the `/models` fetcher ignores the new limit fields; peak/off-peak
  pricing not modeled (peak prices used).
- Leftovers round verification (2026-09-25): full local run on main 847787e92 (`pnpm turbo run check-types lint
  test --continue --concurrency=3`): 38 of 38 tasks green; src 9,817 passed (37 skipped), webview 1,694, cli 1,075,
  types 451, vscode-shim 408, cloud 304, core 178, agent-interchange 114, telemetry 31, build 17.
- Phase 7 (webview) DONE 2026-09-25, #354 to #414 (statuses in 06-webview-ui.md; WEB-4 step 3 optional, not started).
  Open owner question from WEB-3: wire format for clearing the condense profile, memory writer profile and memory
  directory (proposal: send `""`, host treats it as unset).
- Next phases: 8 to 11 in the roadmap above.
- Phase 8 verification (2026-09-26): full local run on main a2e27cf54: 37 of 38 tasks green (src 9,652 passed, 37
  skipped; webview 2,362; cli 1,264; types 603; core 466; vscode-shim 408; cloud 315; agent-interchange 114; telemetry
  71; build 23); `tumble-code#check-types` failed on five imports #419 left unused in `anthropic.ts` and
  `anthropic-vertex.ts` (check-unused-locals over `api/`), fixed in #439 (merge 78168126c). GitHub CI on main still
  queued at that time.

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
| 4 Extension core    | Break up the god objects                         | CORE-R1 settings table and state builder, CORE-R3 message-handler modules, CORE-R2 delegation service, CORE-R9 tool callbacks, CORE-R4 tool descriptors, CORE-R8 edit pipeline, CORE-R12 per-task tool state, CORE-R11 prompt input, CORE-R6 rest of ClineProvider                        | M-L             | DONE 2026-09-25 (#274 to #296 incl. CI fixes #275, #282, #291, #295 and DEF-C41/C42 #278, #279; ClineProvider 4,946 to 2,396 lines; statuses in `04-extension-core.md`) |
| 5 Providers         | One adapter per wire protocol                    | API-1 error contract, API-3 strict schema, API-2 Anthropic stream, API-Q quick wins, API-4 retire AI SDK path, API-6 provider definitions (+ PKG-7 schema copies), API-7 Chat Completions adapter, API-5 cancellation, API-13 Responses core, API-18 Bedrock split, then DEP-6 SDK majors | M-L             | DONE 2026-09-25 (#297 to #327: API-1 to API-7, API-13, API-18, DEP-6 incl. DEP-6b; defects DEF-C43 to C46; statuses in `05-providers-and-services.md` and `03-dependencies.md`) |
| 6 Services          | Lifecycles and single implementations            | SVC-8 McpHub, SVC-10 code-index lifecycle, SVC-9 embedder base, SVC-11 `.roo` resolver, SVC-12 ripgrep runner, SVC-15 tree-sitter cache, SVC-14 terminal contract, SVC-16 `src/shared` layering, SVC-17 DiffView remainder                                                                | M-L             | DONE 2026-09-25 (#328 to #337: SVC-8 in #330 and #337, SVC-9 #333, SVC-10 #328, SVC-11 #331, SVC-12 #329, SVC-14 #335, SVC-15 #332, SVC-16 #334, SVC-17 #336; statuses in `05-providers-and-services.md`) |
| 7 Webview           | Pure data pipeline, small components             | WEB-Q quick wins, WEB-1 row pipeline, WEB-2a pure rows, WEB-4 state context, WEB-3 settings schema, WEB-6 provider forms, WEB-5 code-index form, WEB-2b row renderers, WEB-7 message bus, WEB-8 ChatView hooks, WEB-9 to WEB-11, WEB-12 bundle                                            | M-L             | DONE 2026-09-25 (#354 to #414; WEB-4 step 3 optional, not started) |
| 8 CLI and packages  | Share logic instead of re-implementing it        | CLI-5 duplicated logic slice by slice, PKG-6 browser-safe `src/shared` package, CLI-9 single state machine, PKG-11 remaining package structure                                                                                                                                            | M-L             | DONE 2026-09-26 (#418 to #438: PKG-6, PKG-7, CLI-5 slices 1-5, CLI-9 steps 1-3b, PKG-11 incl. message domains; fixes #420 vertex credentials; open: CLI-9 stream-json contract decision; statuses in `07-cli-packages-repo.md`) |
| 9 Cloud API         | Maintainable Python service                      | CAPI-M3 telemetry vocabulary, CAPI-M4 formatting, CAPI-M5 split `web.py`, CAPI-M6 route dependencies, CAPI-M7 config, CAPI-M8 cross-language fixtures, CAPI-M10 migration drift test, CAPI-M9 SQL aggregation, CAPI-M11 bridge queries, CAPI-M12 (decision 21)                                                    | S-M             | DONE 2026-09-26 (#440 to #460, deployed; decisions 20 to 26; DEF-C47 to C49 fixed; DEF-C50 bridge retry fixed in #465 (needs a VSIX rebuild); statuses in `08-cloudapi.md`) |
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
| 5   | Unknown model ID: keep the ID, substitute the default, or honor it as custom? Providers disagree today.                                                | **Decided** | Keep the ID with default capabilities and show a warning in the settings UI that the model is unknown (owner 2026-09-25, before API-6) |
| 6 | Production logging is a no-op (`src/utils/logging/index.ts` returns a real logger only under test). Intended? | **Decided** | No: write it to the Tumble Code output channel at `info` (TEST-3) |
| 7   | Remove `migrateSettings` (drops migration for installs older than 2025)?                                                                               | **Decided** | Yes, remove it (owner 2026-09-24, done in Phase 3 CORE-Q item 9, #267) |
| 8   | Keep the cloud API LLM proxy endpoints?                                                                                                                | **Decided** | No: **remove them entirely** (endpoints, `proxy_service`, settings, tests), owner 2026-09-24; DEF-S5 becomes the removal  |
| 9   | Should `new_task` and `generate_image` create checkpoints (they do in one list, not in the other)?                                                     | **Decided** | Yes, both (owner 2026-09-24): the set follows the checkpointing call sites, pinned by a test; `list_code_definition_names` leaves the list |
| 10 | Renovate or Dependabot? Both are configured, neither opened a PR in the last 200. | **Decided** | Renovate; remove `dependabot.yml` (TEST-7). The owner installs the Renovate GitHub App |
| 11  | When to take React 19 and zod 4?                                                                                                                       | Open        | After Phases 7 and 8 (Phase 11)                                                                                                     |
| 12  | Raise the minimum VS Code version (`engines.vscode ^1.84.0`, a Node 18 extension host) to unblock library upgrades?                                    | **Decided** | Yes: **`^1.102.0`** (Node 22.15.1 extension host; verified in the VS Code release notes, table in `03-dependencies.md` DEP-4)       |
| 13 | SVC-11: gitignored `.roo` dirs (the owner's global `~/.gitignore` = `core.excludesFile` lists `.roo`) are never found by the subfolder scan. Change it? | **Decided** | No: leave as is, the scan keeps respecting all gitignore files (owner 2026-09-25) |
| 14 | Retry policy: with auto-approve `TaskApiLoop.handleApiRequestError` retries every failure, including 400 and 401 | **Decided** | Stop auto-retry for 401, 403 and 404; keep retrying 400 (some providers and proxies return 400 for transient trouble) (owner 2026-09-25) |
| 15 | Memory writers when VS Code or the CLI closes while a task sits at its final `completion_result` ask | **Decided** | Leave as is, document the limit only (owner 2026-09-25) |
| 16 | Refresh the stale DeepSeek catalog (`deepseek-flash`, V4-Pro, peak and off-peak prices, alias entries) now or later? | **Decided** | Now, in its own branch during the leftovers round (owner 2026-09-25) |
| 17 | Background tasks (#353) stop after 7 attempts for retryable errors: should HTTP 429 (too many requests) count toward that cap? | **Decided** | No: 429 is excluded from the cap, a background task keeps backing off (at most 600 s between attempts) until the rate limit clears or it is aborted; 400, 5xx and no-status errors keep the 7-attempt cap (owner 2026-09-25) |
| 18 | Clearing the condense profile, memory writer profile and memory directory is impossible (`|| undefined` dropped by JSON). Wire format for a cleared value? | **Decided** | The webview sends `""`, the host stores it and treats `""` as not set (current profile / default folder) and sends it back in the state push (owner 2026-09-25) |
| 19 | CLI-9: move `JsonEventEmitter` onto the shared transcript reader and give the `message` event a real `ts` diff? Both change the print/stream-json output (e.g. a resume would print the whole history) | **Decided** | No, not now: the stream-json and print output format stays unchanged; `JsonEventEmitter` remains its own interpreter (owner 2026-09-26). Confirmed after the trade-offs were explained: also no v1-compatible fix for the known loss (only the last message of each state push is emitted, so two messages arriving in one push can lose the first) and no opt-in `schemaVersion: 2` |
| 20 | CAPI-M9: SQL aggregation for the metrics page, step 1 only (narrow select plus composite index) or also step 2 (numeric columns filled at ingest, backfill migration on the live database)? | **Decided** | Step 1, then measure the metrics page on a copy of the live database; step 2 only if the measurement still shows it slow (owner 2026-09-26) |
| 21 | CAPI-M12 (CPU-heavy work off the event loop, upload size cap, cached marketplace YAML) in Phase 9? | **Decided** | Yes, as the last branch of the phase; the upload cap is derived from the largest real task file with headroom and lives in settings (owner 2026-09-26) |
| 22 | Deploy the cloud API after Phase 9? | **Decided** | Once, at the end of the phase: `pg_dump` backup first, image built from an export of main, restart, then a live check of sign-in, task list, metrics and the bridge (owner 2026-09-26) |
| 23 | CAPI-M10: add a Postgres service container to the cloud API CI job for the migration drift test? | **Decided** | No: SQLite only; whatever needs Postgres (the datetime migration) stays untested and is documented in `08-cloudapi.md` (owner 2026-09-26) |
| 24 | CAPI-M6 finding: the JWT issuer (`iss == "rcc"`) and version (`v == 1`) checks are bypassed by a second decode without them (API and bridge). Enforce? | **Decided** | Yes: one decode with mandatory issuer and version checks in the API and the bridge, own `fix/` branch; every token ever issued carries both claims, so nobody is logged out (owner 2026-09-26) |
| 25 | CAPI-M3 finding: a non-string `completionKind` is its own row on the metrics page but a conversation turn on the task detail page. Unify? | **Decided** | Yes: both pages treat it as an ordinary conversation turn, one function in `telemetry_vocab.py` (owner 2026-09-26) |
| 26 | DEF-C49: a shared-conversation upload fails (unique `task_id, message_ts`) when two messages share a `ts` (653 of the owner's 1,212 tasks, mostly ask plus say `command_output`). Collapse like the bridge or keep both? | **Decided** | Collapse like the live bridge: of several messages with one `ts` the later one wins, no schema change (owner 2026-09-26) |

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
- Decision 17 DONE #363 (`b1b93ba15`): 429 retries do not count toward the background cap (7th non-429 failure ends
  the task; the backoff exponent still counts all retries, max 600 s; Google `RetryInfo` honored, plain
  `Retry-After` is not read anywhere: possible item). Also fixed: `RetryHandler` got `abort` as a value copy
  (always false), now a getter, so cancel during a backoff ends the task as `user_cancelled`. Known cost: the
  first-chunk retry recursion grows one generator level per request during a long 429 period.
