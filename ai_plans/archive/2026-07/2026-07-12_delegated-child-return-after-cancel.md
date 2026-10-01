# Delegated child completes but never returns to parent after cancel/restart (2026-07-12)

Branch: `fix/delegated-child-return-after-cancel` (stacked on `fix/cloud-degradation-signals`).

## Reported repro

1. Orchestrator task delegates a subtask to Architect (`new_task` → `delegateParentAndOpenChild`).
2. User interrupts the Architect child mid-run (cancel, or opens/starts another task) and
   restarts/resumes it later.
3. Architect finishes — but never returns its result to the orchestrator parent.

## Root cause (evidence)

Delegation return is gated on the parent's `awaitingChildId`:

- `AttemptCompletionTool.ts:119` — delegates only when
  `parentHistory.awaitingChildId === task.taskId`.
- `ClineProvider.reopenParentFromDelegation` (~line 3772) — same guard.

TWO paths deliberately DETACH the parent while the child is interrupted, so the
parent isn't stuck "delegated" to a dead child:

- `ClineProvider.cancelTask` (~3377-3396): child cancelled → parent
  `{status: "delegated" → "active", awaitingChildId → undefined}`.
- `ClineProvider.removeClineFromStack` repair (~559-577): child popped from the
  stack (user switches/starts another task) → same detach.

The rehydrated/resumed child keeps `historyItem.parentTaskId` (only the fail-closed
error path strips it), but NOTHING ever re-establishes the delegation. When the
restarted child completes, the gate fails and it falls through to the standalone
completion flow. Detach is one-way — by omission, not by design.

## Fix — evidence-gated re-attach at completion time

New `ClineProvider.tryReattachDelegatedParent(parentTaskId, childTaskId)` called from
`AttemptCompletionTool`'s `status === "active"` branch when the `awaitingChildId`
gate fails. Re-attaches (re-stamps `{status: "delegated", awaitingChildId: childTaskId}`)
ONLY when ALL hold:

1. `parentHistory.status === "active"` (not completed; not delegated to someone else);
2. `parentHistory.awaitingChildId === undefined` (no live delegation);
3. `parentHistory.delegatedToId === childTaskId` (the parent's LAST delegation was to
   THIS child — pins identity; a parent that later delegated to child B, whose B was
   also cancelled, has `delegatedToId === B` and child A must NOT steal the slot);
4. the parent is not currently open in the task stack (user actively working in it);
5. **untouched-tail proof**: the parent's persisted API history still ends frozen at
   the delegation — the last `new_task` `tool_use` (same backward scan
   `reopenParentFromDelegation` uses) has NO `tool_result` answering it in any later
   message. If the user resumed the parent meanwhile, the resume repair synthesizes a
   result → check fails → no re-attach (standalone completion, current behavior).

After a successful re-attach the existing `delegateToParent` flow runs unchanged —
including the user-facing finish-subtask approval and the reopen guard re-validation.

Completion-time (not resume-time) re-attach covers BOTH detach triggers with one
gate, and needs no changes to the cancel/detach semantics that #73 depends on.

## TDD

Failing tests first in `ClineProvider.delegation-cancel-races.spec.ts` (unit gates)
and the AttemptCompletionTool delegation spec (integration: detached-but-reattachable
parent → delegation flow proceeds; pre-fix it falls through).
