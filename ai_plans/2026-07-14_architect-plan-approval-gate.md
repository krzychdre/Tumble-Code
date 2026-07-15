# Architect Plan-Approval Gate

**Date:** 2026-07-14
**Branch:** `feature/architect-plan-approval-gate` (stacked on `feature/plan-review-annotations`)
**Status:** implemented (committed on branch); manual verification in the extension pending

## Problem

Architect mode's "wait for the user to approve the plan" behavior is prompt-driven
only (step 5 of its custom instructions asks the model to ask; step 7 asks it to
`switch_mode`). A weak model can skip the question entirely, and with
`alwaysAllowModeSwitch` / `alwaysAllowSubtasks` enabled it switches itself to Code
mode (or spawns a code-mode subtask) and starts implementing a plan nobody reviewed.
The only hard constraint today is that Architect can't edit non-`.md` files.

## Goal

Make the stop **enforced by the harness, not the prompt** (weak-model-proof):

1. While a task is in a _planning_ mode, `switch_mode` and `new_task` always
   require manual approval — even when the Mode / Subtasks auto-approve toggles
   are on.
2. The gate is a first-class permission: a new "Plan" toggle in the auto-approve
   menu next to Read / Write / MCP / Mode / Subtasks / Execute / Question.
   Enabling it restores today's behavior.
3. Only the `autonomous` auto-approval mode bypasses the gate (the requested
   "bypass-able in Autonomous mode"). `bypass` mode does NOT: it force-approves
   other tool asks, but gated switch_mode/new_task from a planning mode still
   prompt (user decision 2026-07-14 — bypass is semi-auto, plan review stays).

Rejecting the gated ask (with a message) _is_ plan feedback — combined with the
plan-review annotation panel this closes the review loop: read plan → annotate →
send notes → model revises → approve the mode switch.

## Design

### Which modes are gated — `planApprovalRequired` mode flag

New optional boolean on `modeConfigSchema` (`packages/types/src/mode.ts`):
`planApprovalRequired?: boolean`. Set `true` on built-in `architect` in
`DEFAULT_MODES`. Custom modes (validated by the same schema) can opt in.
Gating by mode _flag_ rather than hardcoded slug keeps it working for users'
custom planning modes; gating by _current_ mode (recomputed per ask) keeps it
correct across mid-task mode switches — no persisted task state.

### Where the gate lives — `checkAutoApproval`

`src/core/auto-approval/index.ts` is the single extension-side decision point
(`TaskAskSay.ask()` → `checkAutoApproval`), which the model cannot influence —
this is what makes the gate weak-model-proof.

In the `ask === "tool"` branch:

- `tool.tool === "switchMode"`: if the _current_ mode (resolved via
  `getModeBySlug(state.mode, state.customModes)`) has `planApprovalRequired`
  and `state.alwaysApprovePlan !== true` → `{ decision: "ask" }` regardless of
  `alwaysAllowModeSwitch`.
- `tool.tool === "newTask"`: same guard, regardless of `alwaysAllowSubtasks`
  (a code-mode subtask is an implementation escape hatch). `finishTask` is NOT
  gated (it returns control to the parent, it doesn't start new work).

The existing short-circuits stay untouched **by design**:

- `autoApprovalEnabled === false` → everything asks (gate irrelevant).
- `autoApprovalMode` `autonomous` force-approves before granular checks → gate
  bypassed (requirement 3). In `bypass` mode the force-approve block carries an
  explicit exception: gated switchMode/newTask asks fall through to "ask"
  (and the Plan toggle renders as user-controllable, not forced, in bypass).
- Per-task `autoApprovalOverride` (subagent delegation) is checked before
  `checkAutoApproval` — parallel subagents keep their parent-approved behavior;
  the gate applies to the interactive task where the user is reviewing.

### New permission — `alwaysApprovePlan`

Boolean global setting (default **false** — the gate is on by default), named
after the `alwaysApproveResubmit` precedent. Full plumbing chain (13 touch
points mapped in exploration): global-settings schema + defaults,
ExtensionState key union, ClineProvider state construction (3 sites),
extension bridge + cloud bridge allowlist/schema, `AutoApprovalState` type,
AutoApproveToggle config (icon `tasklist`, testId `always-approve-plan-toggle`),
AutoApproveSettings props, useAutoApprovalToggles/useAutoApprovalState hooks,
settings i18n (en + 17 locales), checkAutoApproval logic, tests.

UI copy (en): label "Plan", description "Automatically approve switching modes
or creating subtasks from a planning mode (Architect) without reviewing the
plan first". OFF = review enforced.

### Weak-model notes

- No prompt changes needed for the gate itself. The model sees a normal
  approval flow; on rejection it receives the standard denial + user feedback
  tool result it already understands.
- Architect's step 5 ("ask if pleased") stays — good UX when models follow it;
  the gate is the backstop when they don't.

## Files touched

| Area      | Files                                                                                                                                                             |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Types     | `packages/types/src/mode.ts` (schema + architect flag), `global-settings.ts`, `vscode-extension-host.ts`, `cloud.ts`                                              |
| Extension | `src/core/auto-approval/index.ts`, `src/core/webview/ClineProvider.ts` (3 state sites), `src/extension/bridge.ts`, `packages/cloud/src/bridge/commandHandlers.ts` |
| Webview   | `AutoApproveToggle.tsx`, `AutoApproveSettings.tsx`, `useAutoApprovalToggles.ts`, `useAutoApprovalState.ts`, `locales/*/settings.json`                             |
| Tests     | `checkAutoApproval.spec.ts` (gate cases), `useAutoApprovalState.spec.ts`, toggle component spec if present                                                        |

## Verification

- `checkAutoApproval` unit tests: architect + switchMode/newTask ask with
  Mode/Subtasks toggles ON → "ask"; with `alwaysApprovePlan` ON → "approve";
  non-planning mode unaffected; bypass/autonomous still force-approve;
  finishTask un-gated; custom mode with `planApprovalRequired` gated.
- Full `src` + `webview-ui` vitest, `tsc` in `src`/`webview-ui`/`packages/types`.
- Manual: architect plans → tries `switch_mode` with Mode auto-approve ON →
  approval buttons appear; reject with annotation notes → model revises.

---

## V2 — reviewed-plan-file write gate (2026-07-14, user feedback)

Feedback after first build: in `code` mode the model updated the plan file and
kept going — nothing stopped it, because the original gate only guards leaving
a planning mode. User picked (AskUserQuestion) the "file open in a review
panel" rule over path heuristics.

New rule, enforced in the same `checkAutoApproval` spot: **a write tool call
(`editedExistingFile` / `appliedDiff` / `newFileCreated` / `generateImage`)
targeting a file currently open in a Plan Review panel always asks — in any
mode, including architect and code** — unless `alwaysApprovePlan` is on or
auto-approval mode is `autonomous`. `bypass` does NOT skip it (consistent with
the mode-exit gate).

Mechanics:

- `src/core/webview/planReviewRegistry.ts` — dependency-free singleton set of
  open review-file paths (avoids an import cycle core/auto-approval ↔
  core/webview). `PlanReviewPanel` registers on open, unregisters on dispose.
- `checkAutoApproval` resolves the tool's relative `path` against `state.cwd`
  (present in `getState()`), compares via `arePathsEqual`. New
  `AutoApprovalStateOptions` member: `"cwd"`.
- The panel no longer closes after "Send notes": it live-updates with the
  model's revision (file watcher) and, while open, holds the write gate — that
  is the annotate → revise → re-review loop. The surface clears drafts after
  sending. Closing the panel ends the review session and plan edits flow
  normally again (e.g. routine todo check-offs during implementation).

Also fixed alongside (same feedback round): the chat `AutoApproveDropdown` had
a duplicated `isModeForced` that rendered the Plan toggle as forced-on in
bypass; it now uses the shared `isAutoApproveForced` and got the missing
`alwaysApprovePlan` toggle case + ExtensionStateContext setter.

---

## V3 — automatic post-save plan review pause (2026-07-14, user feedback round 3)

User: "Plany ZAWSZE mają być otwierane w trybie do review. Zawsze po ich
pierwszym kompletnym zapisaniu lub edycji, model musi pauzować i czekać na
zatwierdzenie." Clicking "Review plan" manually must not be required.
AskUserQuestion decisions: pause skipped ONLY by autonomous mode or the Plan
toggle (bypass holds, consistent with V1/V2); plan files = any `.md` under a
`plans/` or `ai_plans/` path segment + root `plan.md`/`todo.md`.

### Semantics change vs V2

The pre-write "file open in a review panel" gate is REPLACED by a post-save
pause: the write completes first (the user reviews the finished plan, not a
diff preview), then the task blocks. Pre-write + post-save together would
double-stop every edit. The registry stays: a file manually opened in a review
panel is also pause-eligible even outside the plan patterns.

### Mechanics

1. `src/shared/planFiles.ts` — pure `isPlanFilePath(absPath, cwd)`:
   relative path has a `plans`/`ai_plans` segment and ends with `.md`, or is
   exactly `plan.md`/`todo.md`. Constant patterns for now (setting later).
2. Post-save helper (`src/core/plan-review/planReviewPause.ts`) called by every
   write tool after a successful save, before pushToolResult:
    - eligible = isPlanFilePath(abs) OR isPlanReviewFileOpen(abs)
    - skipped when: `alwaysApprovePlan`, `autoApprovalMode === "autonomous"`,
      or headless task (`isBackground`) — background subagents must never hang.
    - auto-opens/reveals PlanReviewPanel for the file (the "always open in
      review mode" requirement), then blocks:
      `task.ask("tool", { tool: "reviewPlan", path })`.
    - approve → appends "user approved" to the tool result; reject/message →
      `say("user_feedback")` + feedback appended `<user_message>`-style
      (AskFollowupQuestionTool pattern, weak-model-safe).
    - Annotation submit (`submitUserMessage`) resolves this pending ask as
      messageResponse — notes ARE the review response; the loop is:
      save → pause+panel → annotate/approve → revise → save → pause…
3. `checkAutoApproval`: `tool === "reviewPlan"` → approve only when
   `alwaysApprovePlan`; explicit exception in the bypass force-approve block
   (bypass must not auto-resolve the pause); autonomous force-approve stands.
   The V2 `isReviewedPlanFileWrite` pre-write gate and its tests are removed.
4. ChatRow renders the `reviewPlan` ask (title + path, standard approve/deny
   buttons come from ChatView's ask handling). New ClineSayTool member.
5. i18n: `chat.json` planReview.pause\* keys, en + 17 locales.

### V3.1 fix — footer action bar scrolled out of view (2026-07-15)

User: the panel's Cancel / "Send notes" buttons must be always visible (or
removed). They were designed as a fixed footer, but the plan-review webview
body has no height (`index.css` sets `height: 100%` on `html` only), so the
surface's `h-full` resolved to auto — the page grew with the plan and the
footer landed below a document-length scroll. Fix: the surface root (and the
loading state) are `fixed inset-0`, pinning header + footer to the viewport
and making the markdown area the only scroll container (which the annotation
chip math already assumed). jsdom cannot catch this class of bug — verify in
the extension.
