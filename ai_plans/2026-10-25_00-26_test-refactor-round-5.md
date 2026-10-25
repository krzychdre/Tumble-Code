# Test refactor round 5 (2026-10-25): tests of our logic only

**Status:** done 2026-10-25 (#1061 to #1139, final verification #1140 to #1142, main CI green at `a8ea71db1`); results below.
**Related plans:** `2026-10-23_17-20_maintenance-audit-round-4.md` (E1 to E9; E9 deferred the large spec families to
this round), `simplification_round3_audit_2026-10-02.md`.
**Touched:** spec files under `src/`, `webview-ui/src/`, `packages/cloud`, `packages/core`, `apps/cli`; production
code only where a pruned test exposes dead code or an untested branch.

## Goal

The owner's rule: a test must check our own business logic. It must not test a mock, a library we depend on, or a
state that cannot happen. Every test answers "which line of OUR code turns red if this fails?"; none means delete it.

Measured on main at `abc1288b1` (lines of tests against lines of the code they test; the project's rule of thumb is
about 1.5x):

| Area             | Code    | Tests   | Ratio |
| ---------------- | ------- | ------- | ----- |
| `src`            | 114 853 | 225 113 | 1.96x |
| `packages/cloud` | 4 290   | 7 805   | 1.82x |
| `packages/core`  | 4 928   | 7 404   | 1.50x |
| `webview-ui/src` | 46 806  | 59 446  | 1.27x |
| `apps/cli/src`   | 23 926  | 23 826  | 1.00x |
| cloud API (py)   | 16 910  | 22 801  | 1.35x |

Families with the largest excess over 1.5x (spec lines / subject lines):

| Subject                                                 | Spec files | Tests  | Code  | Ratio |
| ------------------------------------------------------- | ---------- | ------ | ----- | ----- |
| `src/core/webview/ClineProvider.ts`                     | 20         | 13 227 | 2 323 | 5.7x  |
| `webview-ui/.../chat/ChatView.tsx`                      | 13         | 5 929  | 703   | 8.4x  |
| `src/core/task/Task.ts`                                 | 9          | 5 716  | 1 766 | 3.2x  |
| `src/services/mcp/McpHub.ts`                            | 2          | 3 745  | 738   | 5.1x  |
| `webview-ui/.../settings/SettingsView.tsx`              | 8          | 3 332  | 654   | 5.1x  |
| `src/api/providers/bedrock.ts` (+ split files)          | 3          | 3 504  | 781   | 4.5x  |
| `src/core/config/importExport.ts`                       | 1          | 2 890  | 410   | 7.0x  |
| `src/api/providers/openai-native.ts`                    | 3          | 2 616  | 385   | 6.8x  |
| `webview-ui/.../chat/ChatRow.tsx` (+ rows)              | 9          | 2 093  | 135   | 15.5x |
| `webview-ui/.../chat/ChatTextArea.tsx`                  | 5          | 2 713  | 659   | 4.1x  |
| `src/core/config/CustomModesManager.ts`                 | 5          | 2 696  | 776   | 3.5x  |
| `src/services/code-index/vector-store/qdrant-client.ts` | 4          | 2 684  | 791   | 3.4x  |
| `src/core/prompts/sections/custom-instructions.ts`      | 2          | 2 178  | 566   | 3.8x  |
| `src/services/code-index/config-manager.ts`             | 1          | 1 804  | 390   | 4.6x  |
| `src/api/providers/anthropic-vertex.ts`                 | 1          | 1 609  | 267   | 6.0x  |

Single-file ratios overstate facades: `webviewMessageHandler.ts` (26 lines) and `condense/index.ts` (8 lines)
re-export modules whose specs sit under their name. Judge a family by the code its tests actually reach.

## What goes

1. **Tests of a mock.** A hand-written fake that the test then asserts on ("the fake returned X, so the result is
   X"); assertions that only restate the mock's setup; `toHaveBeenCalled` on a mock that the code under test calls
   unconditionally. Replace only the outermost boundary (network, SDK client, `vscode` API, clock, file system) and
   assert what reaches it in terms of our choices.
2. **Tests of a library.** The SDK's retry, zod parsing a valid object, React rendering a prop, i18next
   interpolation, `JSON.parse`, the Anthropic or OpenAI SDK's own stream handling. Keep only our mapping at the
   boundary (what we pass in, how we translate its answer or error).
3. **States that cannot happen.** Inputs our own code or types never produce, guards removed in earlier rounds.
   Branches that exist because an incident happened stay tested.
4. **Duplicates.** Two cases on the same code path are one case; cases that differ only in data become one
   `it.each`. Copied setup becomes a shared helper or fixture in the spec file (or the family's existing test
   utility module).
5. **Echo and snapshot restatement.** A test that copies a table or a constant from the code; snapshots that only
   restate generated output.

## What stays and what is added

- Every branch of our logic keeps at least one test that fails when the branch breaks.
- When pruning exposes an untested branch of our logic, add that case.
- Behaviour pinned for a reason (a regression test naming the bug, a protocol or wire format other code relies on)
  stays; it may be shortened.

## Proof per change

- **Coverage before and after** on the subject files: install `@vitest/coverage-v8@5.0.5` in the lane's worktree
  only (never committed), run the family's specs with `--coverage --coverage.include=<subject files>`, and record
  statements and branches before and after. Branch coverage must not drop; a drop is either a test to keep or a
  case to add.
- **Mutation checks**: for each family break at least three lines of our logic that the remaining tests should
  catch (a condition, a mapped field, an error translation), confirm a test goes red, restore.
- The family's specs, `tsc --noEmit` and eslint on touched files pass; `pnpm knip` exits 0.

## Lanes

One lane per area; areas touch disjoint directories so lanes can run in parallel (at most three at once). Each
lane opens one PR per family (or per small group of related families) and merges it right away.

| Lane | Area                                                                                                |
| ---- | --------------------------------------------------------------------------------------------------- |
| L1   | `src/core/webview/__tests__` (ClineProvider family, webviewMessageHandler family, message handlers) |
| L2   | `src/core/task/__tests__`, `src/core/condense/__tests__`, `src/core/task-persistence/__tests__`     |
| L3   | `src/api/providers/**/__tests__`, `src/api/transform/__tests__`                                     |
| L4   | `src/services/mcp`, `src/core/config`, `src/core/prompts`, `src/core/ignore`                        |
| L5   | `src/services/code-index`, `src/services/skills`, the rest of `src/services`, `src/core/tools`      |
| L6   | `webview-ui/src/components/chat` and the chat hooks                                                 |
| L7   | the rest of `webview-ui/src` (settings, code-index popover, modes, context, model hooks)            |
| L8   | `packages/cloud`, `packages/core`, `packages/types`, `apps/cli`                                     |

Waves: L1, L3, L6 first; then L2, L4, L7; then L5, L8. A final coordinator pass runs every suite once, fixes
anything red, and makes main's CI green.

## Not in this round

- The cloud API's Python tests (1.35x) and the CLI (1.00x): within the rule of thumb.
- e2e (`apps/vscode-e2e`): smoke coverage by design.
- Production refactors beyond what a pruned test exposes (dead code, an untested branch).
- Anything on the round 3 and round 4 "NOT worth doing" lists.

## Status

Every lane is merged. Spec lines are each lane's own count of its area (L5 counts the `src` folders no other lane
owns); branch coverage of the subject files did not drop in any PR, and every PR names at least three mutation checks
that turned a test red.

| Lane | PRs                                                                        | Spec lines before | after  |
| ---- | -------------------------------------------------------------------------- | ----------------- | ------ |
| L1   | #1065 #1071 #1077 #1083 #1087 #1092                                        | 22 415            | 14 817 |
| L2   | #1076 #1080 #1082 #1088 #1091 #1094 #1097 #1099                            | 26 868            | 18 015 |
| L3   | #1062 #1063 #1066 #1068 #1069 #1072 #1074 #1075 #1078 #1079 #1081 #1084    | 47 073            | 26 123 |
| L4   | #1086 #1090 #1093 #1096 #1102 #1105 #1108                                  | 23 578            | 12 677 |
| L5   | #1103 #1107 #1112 #1113 #1117 #1119 #1121 #1125 #1127 #1129 #1131 to #1139 | 96 098            | 77 067 |
| L6   | #1061 #1064 #1067 #1070 #1073                                              | 19 730            | 13 106 |
| L7   | #1095 #1098 #1100 #1104 #1106 #1109 #1110 #1114 #1116 #1120 #1122          | 38 851            | 29 991 |
| L8   | #1111 #1115 #1118 #1123 #1124                                              | 46 521            | 39 347 |

Per area, measured the same way as the table under "Goal" (main at `5abbe4da4` before, after the final pass):

| Area             | Tests before | Tests after | Ratio before | Ratio after |
| ---------------- | ------------ | ----------- | ------------ | ----------- |
| `src`            | 225 113      | 157 757     | 1.95x        | 1.37x       |
| `webview-ui/src` | 59 446       | 43 983      | 1.27x        | 0.94x       |
| `packages/cloud` | 7 805        | 4 925       | 1.82x        | 1.15x       |
| `packages/core`  | 7 404        | 4 760       | 1.50x        | 0.97x       |
| `apps/cli/src`   | 23 826       | 22 929      | 1.00x        | 0.96x       |

Snapshot files: 99 (56 179 lines) before, 70 (46 842 lines) after.

What the pruning found besides excess tests:

- Specs that exercised no production line: they re-implemented the logic and tested the copy
  (`AssistantMessageAssembler` had 0 of 42 branches covered, now 39), or asserted right after an async
  `postMessage` before the state arrived, so they passed whatever the code did (ChatView sounds).
- Bugs, each fixed with a test that was red first: Z.ai and Moonshot skipped the provider error handler on a
  rejected request (#1085); a failed `/v1/me` after a session refresh was an unhandled rejection that made a signed-in
  CLI exit (#1126); `read_file` showed "1 | " for an empty file (#1131); `searchCommits` returned one empty commit
  for no match (#1138); the webview's initial `showRooIgnoredFiles` disagreed with `SETTINGS_DEFAULTS` (#1128).
- Dead code removed where a pruned test exposed it: provider branches for states that cannot happen (#1089), the
  forced-rebuild comparison in `ModeProfileBinding` (#1077), unused exports and options in the webview, cloud, core
  and types packages, two unused translation keys (#1101).

Final pass: the test-only-exports allowlist lost four entries for types #1124 deleted (#1140); two new specs
failed only on Windows (`GIT_CONFIG_GLOBAL` at `os.devNull`, which git cannot open there, and a temp dir reported as
an 8.3 short name) and were fixed (#1142). The version bump PR could not be built since the unified release (#1141,
outside this round's scope).

Noted and left as they are (no defect, or not worth the churn):

- `getModelParams`' `"disable"` check and MiniMax's free-form base URL (reachable from the CLI's `--base-url`).
- The ByteString catch around `new OpenAI()` in three embedders (the SDK reports a bad key on the first request).
- `CloudTelemetryClient`'s debug branches (`debug` is always false) and `RefreshTimer.reset()` (no caller).
- `RunParallelTasksTool` specs (about 2.2x, mostly regressions of real incidents), the code-index parser,
  `NativeToolCallParser`, tiktoken, json-schema, storage and shell specs: candidates for a later round.
