# Simplification round 3 - audit (2026-10-02)

Scope: one read-only audit of `main` @ `6af9569e1`. Goal: reduce cognitive load for a human
maintainer working without AI assistance. Explicitly excluded per owner instruction: B11/terminal
removal, telemetry cloud-only decisions (#745-#747), rebrand work itself, anything from the
intentionally-unmerged `docs/refactor-plan` branch.

Method: `git log` orientation, line-count census per area, grep census of interfaces/scripts/i18n,
then verification of every candidate by reading the code. Every claim below cites a path and was
verified against current source, not git-history labels. Numbers and diagnoses from both review
rounds are incorporated; the diagnoses marked as corrected were re-verified in code before this
rewrite (flag at `find-unused-i18n-keys.mjs:404`, `TaskLifecycle.ts:813-815`, `Task.ts:447`,
`packages/types/src/skills.ts:10-12`, alias in `webview-ui/vitest.config.ts:18`, mock at
`webviewMessageHandler.routing.spec.ts:209-216`).

Evidence base (headline numbers, verified):

- `src/` 1217 TS files; `webview-ui/src` 616; `apps/cli/src` 241; `packages/` 370; `self-hosted-cloudapi/src` 99.
- Largest files: `src/core/webview/ClineProvider.ts` 2328, `src/core/task/Task.ts` 1695,
  `src/core/task/TaskApiLoop.ts` 1643, `src/core/task-persistence/TaskHistoryStore.ts` 1686,
  `apps/cli/src/agent/transcript-reducer.ts` 882, `self-hosted-cloudapi/src/services/diagnostics_service.py` 1035.
- Tests are healthy: 629 specs in src, 61 in webview-ui, 91 in packages, ~122 `*.test.ts` elsewhere.
  `pnpm knip` exits 1 with only the two duplicated zoo-port scripts flagged (by design, see NOT worth).

---

## Executive summary - top 5 by value/effort

1. **Kill the stale `@roo/*` path alias** in `webview-ui/tsconfig.json:24` and
   `webview-ui/vitest.config.ts:18`. The #748-#751 rebrand renamed every package and public string,
   but 22 non-test webview imports (in 21 files) still go through an alias literally named after the
   dead upstream brand. Rename it to `@tumble-code-shared/*` (or, better, make `src/shared` a real
   workspace package). S, low risk.
2. **Move the memory/dream default literals into `SETTINGS_DEFAULTS`, on both sides.** Five memory
   literals sit in the webview (`schema.ts:104-110`) and five in the extension (`TaskLifecycle.ts:813-815`,
   `Task.ts:447`, `memory/paths.ts:107-108`) because those keys are not in the defaults table yet and
   the guard therefore cannot see either side. Order: table first, both sides second, guard third.
   `pruneBeforeCondense` is deliberately OUT of scope (it resolves through
   `isPruneBeforeCondenseEnabled`, per the comment at `settings-defaults.ts:126-127`). S.
3. **Wire the unused-i18n-key mode with `--check`; give `find-test-only-exports.mjs` a real verdict.**
   The missing-keys check is enforced (its test runs against the real repo); the unused-key mode is
   not - and it only fails CI with the `--check` flag (`find-unused-i18n-keys.mjs:404`).
   `find-test-only-exports.mjs` has no failing mode at all and currently reports 407 items (2 files +
   405 test-only exports); knip cannot see them because it counts test usage as usage. Wire the first,
   and either add a check mode plus allowlist to the second or delete it. S-M.
4. **Two quick deletes:** the `packages/cloud/src/backoff.ts` shim (4 consumers, one of them a test
   that is a strict subset of the core test) and the dead `mode?: string` field on `SkillMetadata` -
   which exists in TWO identical copies (`src/shared/skills.ts:11` and `packages/types/src/skills.ts:10-12`),
   so both must go, plus the assignment at `SkillsManager.ts:212` and the test fixture at
   `skillsMessageHandler.spec.ts:80`. The `frontmatter.mode` read at `SkillsManager.ts:194-196` STAYS
   (real backward compatibility for SKILL.md files). Both S, near-zero risk.
5. **Consolidate the cloudapi web-router preamble.** `Depends(require_web_user)` (18 sites) +
   `Depends(get_db)` across 5 web routers, plus an identical
   `templates.TemplateResponse(request, ..., {"user": user, "nav_active": ...})` render block per
   page, plus the not-found-for-foreign-task response spelled FOUR ways (`web_tasks.py:183` inline,
   `_not_found` helper at `web_diagnostics.py:58`, own fields at `web_dataset.py:196`, `shared.py:43`).
   A shared web-page dependency + `get_own_task` collapses it without touching the behaviour-pinned
   tests. M.

---

## Findings (ordered by value/effort)

### 1. Stale `@roo/*` path alias in the webview

- **Where:** the alias is defined in TWO places: `webview-ui/tsconfig.json:24`
  (`"@roo/*": ["../src/shared/*"]`) and `webview-ui/vitest.config.ts:18`
  (`"@roo": path.resolve(__dirname, "../src/shared")` - miss either one and either the build or every
  webview test stops resolving imports). `webview-ui/vite.config.ts:102` resolves through the
  tsconfig (`tsconfigPaths: true`). 22 non-test imports in 21 files read `@roo/modes`, `@roo/package`,
  `@roo/support-prompt`, `@roo/checkExistApiConfig`, `@roo/ProfileValidator`; 6 test imports plus
  `vi.mock` calls add to that. The name also survives in 4 comments:
  `src/eslint.config.mjs:25`, `src/__tests__/layering.spec.ts:8`,
  `packages/config-eslint/__tests__/boundaries.test.mjs:8`, `webview-ui/turbo.json:4`.
- **Why it burdens a maintainer:** after #748-#751 every package is `@tumble-code/*` and "No RooCode
  name anywhere" is an explicit owner rule - yet the single most-used import path in the webview still
  says `@roo`. A newcomer greps for `@tumble-code` in the webview and misses half the imports; two
  alias namespaces (`@tumble-code/core/browser` and `@roo/*`) sit side by side in the same import list
  (e.g. `webview-ui/src/context/extensionStateReducer.ts:29-32`).
- **Proposal:** rename the alias in both definition sites (e.g. `@tumble-code-shared/*`, mechanical
  find-replace across imports, comments included), or go one step further and promote `src/shared` to
  a real workspace package so the alias dies entirely (that step is L and touches the bundling story;
  the rename alone is S).
- **Effort:** S (rename) / L (package promotion). **Risk:** low for the rename - pure import-path
  churn, compiler-checked.
- **Verify by content:** `grep -rn "@roo" webview-ui/src webview-ui/tsconfig.json webview-ui/vitest.config.ts`
  must be empty after the change (tests included, `vi.mock` paths count); `webview-ui` vitest suite
  green (note the known trap: bare i18next `t` mocks need TooltipProvider).

### 2. Memory/dream defaults hardcoded on both sides of the settings boundary

- **Where (webview), five literals:** `webview-ui/src/components/settings/schema.ts:104-110` -
  `autoMemoryEnabled` (104), `memoryRecallEnabled` (107), `autoDreamEnabled` (108),
  `autoDreamMinHours: 24` (109), `autoDreamMinSessions: 5` (110). (A sixth literal at line 119,
  `pruneBeforeCondense`, is NOT part of this finding - see below; `terminalProfile: { default: "" }`
  at line 134 is the empty-string idiom, different category, left as is.)
- **Where (extension), five literals:** `src/core/task/TaskLifecycle.ts:813-815` - `?? true` /
  `?? 24` / `?? 5` for the three autoDream keys; `src/core/task/Task.ts:447` -
  `getValue("memoryRecallEnabled") ?? true`; `src/core/memory/paths.ts:107-108` - `autoMemoryEnabled`
  defaulting to `true` when unset.
- **Root cause:** these keys are absent from `packages/types/src/settings-defaults.ts`
  (`SETTINGS_DEFAULTS`), so the D2 guard `scripts/check-settings-defaults.mjs` cannot flag either
  side; its scanned roots (`src`, `packages`, `apps`) also do not include `webview-ui`. Extending the
  scan alone would change nothing - the script only enforces keys already in the table.
- **Explicitly out of scope:** `pruneBeforeCondense`. The comment at `settings-defaults.ts:126-127`
  says it is resolved separately via `isPruneBeforeCondenseEnabled` (`prune-condense.ts:80`), so
  adding it to the table would contradict the current design. The webview line 119 should instead use
  that function or a constant in `PRUNE_CONDENSE_DEFAULTS`, like its neighbour
  (`pruneToolResultBudget` at line 120 already does). That is a small follow-up in the same PR at most.
- **Why it burdens a maintainer:** the "one table" rule (docs/architecture.md, "Where settings
  defaults live today") is violated on both sides for the same five keys; changing `autoDreamMinHours`
  today means finding and editing files in two workspaces. The comment at `schema.ts:103-104` claims
  the memory defaults "live in the host's ContextProxy (first-run migration)" - that comment is
  FALSE: `ContextProxy` only passes these keys through (`PASS_THROUGH_STATE_KEYS`) and performs no
  migration that writes them. The comment must be corrected in the same PR.
- **Proposal, in this order:** (a) add the five memory/dream keys to `SETTINGS_DEFAULTS`;
  (b) make `schema.ts:104-110`, `TaskLifecycle.ts:813-815`, `Task.ts:447` and
  `memory/paths.ts:107-108` read the table (or the shared resolver), and fix the false comment at
  `schema.ts:103-104`; (c) then extend `check-settings-defaults.mjs` to scan `webview-ui` too so the
  gap cannot reopen.
- **Effort:** S. **Risk:** low - values unchanged, only their home; the only behavioural surface is
  first-run state before any setting is persisted, which is exactly what the table defines.
- **Verify by content:** after the change, `grep -n "default: true\|default: 24\|default: 5"
webview-ui/src/components/settings/schema.ts` shows nothing in lines 104-110;
  `grep -n "?? 24\|?? 5" src/core/task/TaskLifecycle.ts` is empty in the dream block;
  `grep -n "?? true" src/core/task/Task.ts src/core/memory/paths.ts` has no memory-key hits;
  the guard run exits 0.

### 3. Guard-script wiring: one mode enforced, one mode and one script not

- **Where:** `scripts/find-unused-i18n-keys.mjs` (409 lines), `scripts/find-test-only-exports.mjs`
  (261 lines), `.github/workflows/code-qa.yml:36-41`.
- **What is actually enforced today:** the missing-keys check IS enforced -
  `scripts/__tests__/find-unused-i18n-keys.test.mjs:163-164` runs `findMissingWebviewKeys(loadRepo())`
  against the actual repository, so the `code-qa.yml` comment is truthful for that mode.
- **What is not:** (a) the unused-key detection mode - its tests use synthetic fixtures only, and the
  script exits 0 even when it finds unused keys (it found one today, `common:ui.close`); CI would
  only break with the `--check` flag (`find-unused-i18n-keys.mjs:404`:
  `if (args.has("--check") && unused.length > 0) process.exit(1)`). Running the bare command as a CI
  step, as the earlier draft proposed, would never fail - the step must be
  `node scripts/find-unused-i18n-keys.mjs --check`. (b) The whole `find-test-only-exports.mjs` script
  has NO failing mode at all, and it currently reports 407 items (2 files + 405 exports used only by
  tests). Wiring it "the same way" is impossible without adding a check mode and an allowlist.
  The earlier "maybe knip suffices" rationale is wrong by construction: knip counts a test import as
  usage, so test-only exports are invisible to it by definition.
- **Why it burdens a maintainer:** a maintainer reading the CI comment reasonably assumes unused keys
  and test-only exports are policed; only one of the two is. Both scripts must still be kept working
  when the repo layout changes, without delivering their gate.
- **Proposal:** (a) add one CI step `node scripts/find-unused-i18n-keys.mjs --check` next to
  `check-settings-defaults.mjs`, and remove the one unused key (`common:ui.close`) in the same PR so
  the gate starts green. (b) For `find-test-only-exports.mjs`, the owner decides between: adding a
  `--check` mode, triaging the 407 reported items into dead exports (to delete) and deliberate ones
  (to keep on an allowlist - the allowlist covers only the deliberately-kept ones, not all 405), or
  deleting the script and its test. Neither option is free; doing nothing is the one outcome to avoid.
- **Effort:** S for (a); M for (b) with a check mode. **Risk:** low for (a) - currently green after
  the one-key cleanup; (b) carries allowlist-maintenance debt if wired.
- **Verify by content:** after (a), `grep -rn "find-unused-i18n-keys" .github` shows a `run:` line
  with `--check` (not a comment); after (b) deletion,
  `grep -rln "find-test-only-exports" . --exclude-dir=node_modules` is empty.

### 4. Two quick deletes: backoff shim + dead `mode` field (in both interface copies)

- **Where (a):** `packages/cloud/src/backoff.ts` (2 lines) re-exporting `@tumble-code/core/backoff`.
  Four consumers: `packages/cloud/src/RefreshTimer.ts`,
  `packages/cloud/src/bridge/BridgeOrchestrator.ts`,
  `packages/cloud/src/retry-queue/RetryQueue.ts`, and the test
  `packages/cloud/src/__tests__/backoff.spec.ts` - which is, in full, a subset of
  `packages/core/src/__tests__/backoff.spec.ts`, so it should be deleted with the shim, not
  redirected. Dropping the re-export from `packages/cloud/src/index.ts` is safe: nothing imports
  `backoffDelayMs` from `@tumble-code/cloud`.
- **Where (b):** the deprecated `mode?: string` field exists in TWO identical `SkillMetadata` copies:
  `src/shared/skills.ts:11` (used by `SkillsManager.ts`, `skillInvocation.ts`, `src/core/mentions/index.ts`)
  and `packages/types/src/skills.ts:10-12` (used by the webview and `skillsMessageHandler.ts`).
  Removing it from one copy leaves it in the other. It is not only declared but assigned:
  `SkillsManager.ts:212` writes `mode: primaryMode` (with a deprecation comment); no code reads
  `.mode` off the object. Test data also carries it: `skillsMessageHandler.spec.ts:80` has
  `mode: "code"`. The real backward compatibility lives elsewhere and STAYS: the `frontmatter.mode`
  read at `SkillsManager.ts:194-196` (legacy single-mode SKILL.md files mapped to `modeSlugs`).
  The earlier draft's mention of "task histories containing mode" was an assumption with no code
  coverage - withdrawn.
- **Why it burdens a maintainer:** (a) one extra hop with no seam value, three call sites importing
  through it plus a redundant duplicate test; (b) a `@deprecated` field still actively assigned on
  every skill load, duplicated across two packages, asking every reader "when can I delete this?".
- **Proposal:** (a) point the three source consumers at `@tumble-code/core/backoff` directly, delete
  the shim, drop it from `index.ts`, delete `packages/cloud/src/__tests__/backoff.spec.ts`.
  (b) delete the field from BOTH `SkillMetadata` copies, delete the `mode: primaryMode` assignment at
  `SkillsManager.ts:212` and the fixture field at `skillsMessageHandler.spec.ts:80`; keep the
  `primaryMode` local (still used for `skillKey` at line 205) and lines 194-196 untouched.
- **Bonus sub-item (separate small PR):** the `SkillMetadata`/`SkillContent` interface duplication
  itself (`src/shared/skills.ts` vs `packages/types/src/skills.ts`) - one copy should import or
  re-export the other so the two cannot drift.
- **Effort:** S each. **Risk:** negligible (a: pure import-path change; b: type-erased, no reader).
- **Verify by content:** (a) `grep -rn "backoff" packages/cloud/src` shows only core imports, knip
  clean, cloud test count drops by one file. (b) `grep -rn "mode?:" src/shared/skills.ts
packages/types/src/skills.ts` is empty; `frontmatter.mode` read at `SkillsManager.ts:194-196`
  intact; skills specs green.

### 5. Cloudapi web-router preamble + the 404-for-foreign-task idiom (4 spellings)

- **Where:** `self-hosted-cloudapi/src/routers/web_metrics.py`, `web_diagnostics.py` (151),
  `web_dataset.py` (224), `web_tasks.py` (296), `web_settings.py` - 18
  `Depends(require_web_user)` sites + `Depends(get_db)` per endpoint and an identical
  `templates.TemplateResponse(request, ..., {"user": user, "nav_active": ...})` render block per page.
  The "unknown or not yours -> 404 page" response is spelled FOUR ways: inline in `web_tasks.py:183`,
  a local `_not_found` helper at `web_diagnostics.py:58` (not 111), its own heading/hint fields at
  `web_dataset.py:196`, and `shared.py:43`.
- **Why it burdens a maintainer:** every new page re-types the same dependency pair and remembers the
  `nav_active` key; four spellings of the same 404 invite a fifth divergence (different status, body
  or redirect for the same situation).
- **Proposal:** one FastAPI dependency (e.g. `require_web_page` returning `(user, db)` or an annotated
  `WebPageContext`), a thin `render_page(request, user, template, nav_active, **ctx)` helper, and one
  `get_own_task`-style dependency that unifies the four 404 spellings. `tests/test_route_boilerplate.py`
  and `test_route_table.py` pin behaviour, not structure - consolidation is allowed as long as route
  names, OpenAPI params, status codes, redirect targets and the no-DB-session property of the token
  check stay identical (verified by reading both test files).
- **Effort:** M. **Risk:** mid - must keep `test_route_table.py`'s exact `EXPECTED` set and the
  login-wall characterization green; no renames allowed. Unifying the four 404 spellings changes
  heading/hint text where it currently differs - keep the tests' pinned bodies as the arbiter and
  change text only deliberately.
- **Verify by content:** after the change
  `grep -c "Depends(require_web_user)" self-hosted-cloudapi/src/routers/web_*.py` drops toward zero,
  `grep -rn "not_found" self-hosted-cloudapi/src/routers/*.py` shows one helper, and
  `pytest tests/test_route_boilerplate.py tests/test_route_table.py` stays green.

### 6. `messageEnhancer.ts` - static-method class with one caller; convert to functions in place

- **Where:** `src/core/webview/messageEnhancer.ts` (165 lines). Sole non-test importer:
  `src/core/webview/messageHandlers/enhanceAndSearch.ts:10`.
- **Corrected risk picture:** (a) `webviewMessageHandler.routing.spec.ts:209-216` mocks the WHOLE
  `../messageEnhancer` module including the class shape - any file move forces an edit to that spec,
  which finding 12's ground rule ("routing spec untouched") forbids; (b) `messageEnhancer.test.ts`
  has roughly 20 call sites to rewrite, including one private-member access through `as any`;
  (c) the class has three members, not one operation; (d) `enhanceAndSearch.ts` is already 167 lines
  and would grow to about 330 if the code moved there - worse for readers, not better.
- **Why it burdens a maintainer:** a static-method class is a Java-ism around what are plain
  functions; the wrapper adds an import hop for the one caller and forces `as any` in its own test.
- **Proposal (simplest correct form):** keep the file where it is; convert the static-method class
  into plain exported functions in the SAME file, and keep a thin
  `export const MessageEnhancer = { ... }` object facade over them. No imports change anywhere, the
  routing spec's `vi.mock("../messageEnhancer", ...)` keeps working UNTOUCHED (it mocks the
  `MessageEnhancer` object shape, which still exists), and `messageEnhancer.test.ts` gets ~3
  mechanical call-site updates (the private `extractTaskHistory` access only). This resolves the
  apparent contradiction with finding 12's ground
  rule: with the facade the routing spec genuinely needs no edit; if a future owner prefers to drop
  the facade, finding 12 must then carry an explicit one-off exception for the mock shape at
  `webviewMessageHandler.routing.spec.ts:209-216`.
- **Effort:** S (with the facade, only ~3 test sites change: the private `extractTaskHistory`
  access through `as any` now calls a plain function). **Risk:** low - contained to one file plus
  mechanical test call sites.
- **Verify by content:** after the change `grep -rn "messageEnhancer" src --include='*.ts' |
grep -v __tests__` still shows exactly one importer; `class MessageEnhancer` is gone (the
  `export const MessageEnhancer = { ... }` facade remains); `webviewMessageHandler.routing.spec.ts`
  has NO diff at all.

### 7. Provider test mock boilerplate - real but modest

- **Where:** `src/api/providers/__tests__/` - 65 spec files (owner-corrected), no shared
  helper/fixture module (verified: no `helper*|fixture*|util*` file in that dir). Corrected scale:
  bare module-level `const mockCreate = vitest.fn()` appears in 14 files (18 once `vi.fn()` variants
  are counted); `defaultMockImplementation` exists in exactly ONE file (`openai.spec.ts:15`); the
  token-usage numbers `10/5/15` are hardcoded in ~16 files. Per-test local `mockCreate` declarations
  (openrouter, anthropic-vertex specs) are a different, test-local pattern and not part of this
  finding.
- **Why it burdens a maintainer (moderate):** ~14-18 specs each hand-roll the same SDK-mock scaffold
  (module mock + `mockCreate` + reset in `beforeEach`), so adding a provider still means copying a
  familiar ~30-40 line shape, and the usage triple `10/5/15` is cargo-culted identically everywhere,
  making cost-related assertions silently uniform.
- **Proposal:** one `src/api/providers/__tests__/provider-test-helpers.ts` exporting the module-mock
  factory, `mockCreate`, a default non-stream/stream implementation, and the per-SDK wrappers; migrate
  the module-mock specs opportunistically (openai, anthropic, minimax,
  anthropic-protocol-characterization, openai-usage-tracking, openai-cache-usage, ...). This is a
  mid-value cleanup, not a top-5 item.
- **Effort:** M. **Risk:** low-mid - test-only code, but each migration can shift assertions if the
  helper's shape differs subtly; keep per-spec fixtures overridable.
- **Verify by content:** `grep -rln "const mockCreate = vitest.fn()" src/api/providers/__tests__`
  before (14 files) vs after; the helper file must be the only definition site for migrated specs.

### 8. Task-side `*Access`/`*Host` interfaces: 21 seams, 691 lines, heavy member overlap

- **Where:** full census (owner-corrected): 21 consumer-side interfaces, 691 lines total.
  Task side: `TaskApiLoopAccess` (`src/core/task/TaskApiLoop.ts:73-176`, 104 lines - 15% of the
  total, not 28%), `TaskLifecycleAccess` (86), `TaskContextManagerAccess` (61), `TaskMessageLogAccess`
  (52), `ApiRequestBuilderAccess` (53), `TaskStreamProcessorAccess` (43), `TaskAskSayAccess` (33),
  `TaskSubtasksAccess` (35), `RetryHandlerAccess` (34), `TaskResumptionAccess` (29),
  `AssistantMessageAssemblerAccess` (9), `TaskTokenTrackingAccess` (13), `StreamToolCallHandlerAccess`
  (7). Webview side: `ModeProfileBindingHost` (26), `TaskHistoryGatewayHost` (22), `DelegationHost`
  (21), `BackgroundTaskHost` (21), `WebviewStatePusherHost` (17), `TaskSlotHost` (13),
  `CloudProfileSyncHost` (6), `TaskEventForwardingHost` (6). Census verified: **every** interface has
  exactly one production implementor (structural - `Task`/`ClineProvider` pass `this`; zero
  `implements` keywords repo-wide), so none is polymorphic; they are pure "declare what I touch" seams.
- **Pin tests:** `src/core/task/__tests__/Task.access-types.spec.ts` (path owner-corrected; earlier
  draft said `src/__tests__/`) and, next to it, `TaskLifecycle.lazy-access.spec.ts`.
- **Why it burdens a maintainer:** to follow one behaviour (say, an API retry) a maintainer reads the
  interface block to learn what the module can touch - and `taskId`, `api`, `apiConfiguration`,
  `apiConversationHistory`, `clineMessages`, `cloudSyncedMessageTimestamps`, `providerRef`, `abort`,
  `isBackground`, `cwd` recur across five task-side interfaces, so the same facts are re-declared five
  times and must stay in sync by hand. `TaskApiLoopAccess` alone is 104 lines of that.
- **Proposal:** keep the seam pattern (it is type-pinned and genuinely keeps private members honest),
  but compose shared member groups into small named interfaces (e.g. a `TaskCoreAccess` for
  id/api/abort/cwd/messages) that the per-module interfaces extend, following the composition
  precedent of `TaskStreamProcessorAccess`. Target: the recurring members declared once. Do **not**
  delete the seams.
- **Effort:** M. **Risk:** mid - pure type-level refactor, but both pinning specs must be updated
  with it and tsc is the only guard.
- **Verify by content:** after the change, each recurring member name is declared in exactly one
  interface (grep the member name, e.g. `cloudSyncedMessageTimestamps`, across `src/core/task/*.ts`
  and confirm one interface declaration - the earlier suggested `grep ... | grep interface` was
  useless because member lines do not contain the word "interface"); both pinning specs pass.

### 9. `diagnostics_service.py` (1035 lines) - split by concern, not by class

- **Where:** `self-hosted-cloudapi/src/services/diagnostics_service.py` - verified structure: two
  classes (`Occurrence`, `ProblemFilter` - the latter 90 lines, not "small") plus 31 module-level
  functions across four concerns: per-source collection (`conversation_occurrences`,
  `telemetry_occurrence`), filtering (`ProblemFilter`), grouping/aggregation (`group_occurrences`,
  `aggregate_problems` - about 59 lines, not 190, corrected in both places it appeared,
  `model_fit`), and views (`report_view`, `_sample_view`, `_group_view`). Related heavyweight:
  `problem_catalogue.py` (747), `problem_brief.py` (526).
- **Why it burdens a maintainer:** the Problems feature lives in three ~500-1000-line flat modules
  where the seams (collect -> filter -> group -> render) are line numbers, not imports; finding where
  to change a grouping rule means scrolling 1000 lines.
- **Proposal:** split into a package `services/problems/` with `collect.py`, `filters.py`,
  `aggregate.py`, `views.py` (pure moves, no signature changes). Actual importers of
  `diagnostics_service` (verified, owner-corrected): the `web_diagnostics` router, `problem_brief.py`,
  `web/presenters/problem_view.py`, and two tests - keep a one-line re-export module
  `services/diagnostics_service.py` so those five sites stay untouched. (The earlier draft wrongly
  justified the re-export with `test_route_boilerplate.py`, which does not import this service.)
- **Effort:** M. **Risk:** low - pure reorganization in Python; behaviour-pinned tests already cover it.
- **Verify by content:** `pytest tests/test_web_diagnostics.py tests/test_problem_catalogue.py
tests/test_problem_filters_brief.py` green with zero test edits; the five import sites unchanged.

### 10. The duplicated `marketplace.json` keys are dead, not a sync burden

- **Where:** (a) `src/i18n/locales/` - 7 domain files x 18 locales, ~8.7k lines JSON, consumed only by
  the extension core (verified: no CLI or packages import); (b) `webview-ui/src/i18n/locales/` - 10
  domain files x 18 locales, ~39.4k lines JSON (owner-corrected from 48k), own separate i18next
  instance; (c) `src/package.nls.*.json` - 17 locale files x 54 keys, hand-maintained, audited by
  `find-missing-translations.js`.
- **Corrected diagnosis (owner-verified):** the 16 `filters.*`/`items.*` keys shared between
  `src/i18n/locales/en/marketplace.json` and the webview copy are NOT "the same label maintained
  twice" - no extension code uses them at all (the extension uses only `marketplace:installation.*`).
  They are a dead copy to delete from all 18 locales, not a sync rule to document. The genuinely
  shared cross-tree domain files number four: `common.json` (4 shared keys), `marketplace.json` (16,
  all dead on the src side), `worktrees.json` (2), `mcp.json` (0). The
  `find-unused-i18n-keys.mjs` script cannot catch this: it checks only the webview tree, and its
  `--missing` mode compares against each tree's own `en`.
- **Why it burdens a maintainer:** 16 dead keys x 18 locales sit in `src/i18n` waiting for someone to
  wonder whether editing them does anything (it does not); the three-surface layout (core / webview /
  package-nls) is documented nowhere.
- **Proposal:** (a) delete the 16 dead `filters.*`/`items.*` keys from `src/i18n/locales/*/marketplace.json`
  (18 files; the tree is 100% key-complete, so nothing else depends on them - verify by grep before
  deleting); (b) add a ~20-line section to `docs/architecture.md` ("where a string lives") listing
  the three surfaces and which domains live in which tree; (c) the unused-key CI gate from finding 3
  covers the src tree going forward only if the script's scan is extended to it (today it scans the
  webview tree) - decide whether to extend or accept core-tree keys as unpoliced.
- **Effort:** S for (a), S-M for (b)+(c). **Risk:** low - dead keys, no reader.
- **Verify by content:** before deleting, `grep -rn "filters\." src --include='*.ts' | grep -v i18n`
  shows no `t("marketplace:filters.` usage from the extension; after, the key count of
  `src/i18n/locales/en/marketplace.json` drops by 16 and all suites stay green.

### 11. e2e suite: non-hermetic and undocumented

- **Where:** `apps/vscode-e2e/` - 6 test files (4 smoke: extension, task, modes, markdown-lists; 2
  provider: `providers/deepseek-v4.test.ts` 402 lines, `providers/zai.test.ts` 218; owner-corrected
  from 7), 1147 LOC across all 11 TS files including the runner, **no README** (verified,
  owner-confirmed). `test:ci` chains `pnpm -w bundle` + webview build + `dotenvx` `.env.local` +
  `@vscode/test-electron` download; the two provider suites need real API credentials.
- **Why it burdens a maintainer:** the test-placement rules in AGENTS.md lean on this suite for
  "real VS Code host" coverage, but nothing records what it needs to run, which suites are hermetic,
  and which need credentials - discovery cost is on every newcomer.
- **Proposal:** add a short README (how to run, what needs `.env.local`, which suites are smoke vs
  provider) and mark the provider suites opt-in via a naming/marker convention the runner can filter.
  No test changes.
- **Effort:** S. **Risk:** none.
- **Verify by content:** file exists; `apps/vscode-e2e/package.json` scripts match its instructions.

### 12. `ClineProvider.ts` residual bulk (2328 lines, 49 async methods)

- **Where:** `src/core/webview/ClineProvider.ts` - 2328 lines, ~35 fields, 8 constructed collaborators
  (`TaskSlot`:250, `WebviewStatePusher`:256, `TaskHistoryGateway`:263, `DelegationService`:300,
  `ModeProfileBinding`:320, `CloudProfileSync`:366, `BackgroundTaskRunner`:376, `SubagentRegistry`:139),
  49 `async` methods. S1/S7/Phase-4 already extracted the big seams.
- **Why it burdens a maintainer:** it is still the file everyone opens; finding "where does X get
  handled" usually starts here. Decomposition has real diminishing returns left, but the
  command-handler and task-history method clusters could keep moving out along the same pattern.
- **Proposal:** strictly incremental: identify the 2-3 largest self-contained method clusters (likely
  task-history operations - cf. `TaskHistoryGateway.ts` 751 - and delegation) and move them out
  following the established `*Host` seam pattern, one cluster per PR. **Do not touch** the
  do-not-touch list items (the three `postStateToWebview*` variants, `clineMessagesSeq`, abort
  ordering) - and note finding 6's constraint: `webviewMessageHandler.routing.spec.ts` should stay
  untouched across these moves.
- **Effort:** L (per cluster M). **Risk:** mid-high - the architecture doc pins several behaviours
  here; each move must keep `ClineProvider.spec.ts` (4032 lines) green.
- **Verify by content:** each PR: `ClineProvider.spec.ts` + `webviewMessageHandler.routing.spec.ts`
  untouched and green; file line count strictly decreases.

---

## NOT worth doing (considered and rejected)

- **Extracting the cloudapi browser-harness `check()` helper** - it is ONE identical line in 10
  fixture files; extraction saves 10 lines but adds a `<script src>` dependency to fixtures loaded
  via `--dump-dom` in `tests/test_browser_js.py`-style checks. Net negative. (Also rejected: merging
  the two fetch wrappers in `src/web/static/app.js` and `tasklist.js` - they are NOT near-identical:
  the tasklist version carries an Accept header and aborts via AbortController.)
- **`packages/vscode-shim` (8.6k lines incl. tests) mock-vs-real split** - the architecture doc lists
  the whole package as "do not touch without a dedicated item"; the mock creator (`create-vscode-api-mock.ts`, 329) is load-bearing for tests. High churn, protected area.
- **`provider-registry.ts` vs `runtime-provider-registry.ts` "two lists"** - verified not a sync seam:
  IDs are compile-time-enforced (`satisfies Record<RuntimeProviderId, ...>`), model facts are spread
  from the types package. Nothing to fix.
- **Merging `config-eslint`/`config-typescript`/`config-vitest` into one package** - standard ESLint
  flat-config sharing; saves 2 `package.json` files, churn for near-zero cognitive gain.
- **Moving `src`/`webview-ui` under `apps/*`** - the `pnpm-workspace.yaml` comments admit it, but it is
  a repo-wide path/bundle/CI churn with no behavioural payoff.
- **Duplicated `zoo-prs.mjs` in `.claude/skills` and `.roo/skills` (knip's only 2 findings)** - by
  design: the Claude+Roo twin skills intentionally share one ledger; both dirs are agent-owned.
- **`scripts/bootstrap.mjs` removal** - verified it is a real pnpm bootstrapper for machines without
  pnpm, not a redundant wrapper.
- **CLI transcript shaping vs core duplication** - verified absent: `transcript-reducer.ts` and
  `json-event-emitter.ts` import `consolidate*` from `@tumble-code/core/cli`; no reimplementation.
- **`src/utils` vs `packages/core` function duplication** - verified absent by name intersection
  (empty); near-neighbours are semantically different.
- **Further splitting `Task.ts` right now** - just decomposed (10 collaborators, type-pinned by
  `Task.access-types.spec.ts`); the Access-interface cleanup (finding 8) is the useful remainder.
- **`vscode-lm-format.ts`/per-provider transform files consolidation** - the architecture doc pins
  per-protocol converters as compatibility-critical (weak models); do not touch.
- **Checkpoint services duplication** - verified single implementation (`ShadowCheckpointService`
  567 lines; no second service exists).
- **Webview provider-form boilerplate** - verified already descriptor-driven
  (`ProviderDescriptorForm.tsx`); zero raw `VSCodeTextField`/`VSCodeDropdown` counts in provider files.
- **`test-utils.tsx` sharing across workspaces** - verified there is no cross-workspace helper
  duplication pattern (one 36-line helper in webview-ui; `src/__mocks__` holds only fs/vscode mocks).
- **`config/settings.py` (292 lines) vs `schemas/settings.py`** - verified no real duplication
  (deployment env config vs API response contract; intentional overlap on two org-level flags).
- **Deleting the `frontmatter.mode` read (`SkillsManager.ts:194-196`)** - it is real backward
  compatibility for legacy SKILL.md files (maps the legacy single-mode frontmatter to `modeSlugs`);
  only the TypeScript field/assignment pair in both interface copies (finding 4b) is dead.
- **Adding `pruneBeforeCondense` to `SETTINGS_DEFAULTS`** - contradicts the documented design
  (`settings-defaults.ts:126-127` resolves it via `isPruneBeforeCondenseEnabled`); the webview should
  use that function or `PRUNE_CONDENSE_DEFAULTS` instead (see finding 2, out-of-scope note).
