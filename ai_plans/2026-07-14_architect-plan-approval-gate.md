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
