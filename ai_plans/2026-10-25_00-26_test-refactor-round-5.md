# Test refactor round 5 (2026-10-25): tests of our logic only

**Status:** in progress; per-lane status lines below.
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

| Lane | PRs | Tests before | Tests after | Notes |
| ---- | --- | ------------ | ----------- | ----- |
| L1   |     |              |             |       |
| L2   |     |              |             |       |
| L3   |     |              |             |       |
| L4   |     |              |             |       |
| L5   |     |              |             |       |
| L6   |     |              |             |       |
| L7   |     |              |             |       |
| L8   |     |              |             |       |
