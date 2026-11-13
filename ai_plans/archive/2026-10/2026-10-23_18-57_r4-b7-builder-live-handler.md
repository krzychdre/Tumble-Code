# R4-B7 (prerequisite): the request builder reads the task's current handler

**Status:** done.
**Related plans:** `2026-10-23_17-20_maintenance-audit-round-4.md` (item B7; found while moving request assembly into
`ApiRequestBuilder`).

## Touched files

- `src/core/task/TaskApiLoop.ts`
- `src/core/task/__tests__/TaskApiLoop.profile-switch.spec.ts`

## Problem

`TaskApiLoop` builds its `ApiRequestBuilder` once, in the Task constructor, and handed it `access.api` as a value.
`Task.updateApiConfiguration` (a mid-task profile switch) replaces and disposes `task.api`, so the builder kept the
old handler: the system prompt took the old model's info (`isStealthModel`, `excludedTools`) and
`buildCleanConversationHistory` asked the old handler whether it round-trips encrypted reasoning. `apiConfiguration`
and `rooIgnoreController` were already passed as getters for the same reason.

## Change

The builder's access object passes `api` as a getter, so each request reads the task's current handler.

## Tests

- `TaskApiLoop.profile-switch.spec.ts`: a switch to a handler whose model is a stealth model makes the next system
  prompt input carry `isStealthModel: true`. The case fails against the previous `TaskApiLoop.ts` (mutation check).
