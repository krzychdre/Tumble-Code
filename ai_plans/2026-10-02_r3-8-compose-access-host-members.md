# R3-8: Compose the `*Access`/`*Host` interface member groups

Implements finding 8 of `ai_plans/simplification_round3_audit_2026-10-02.md`.
Branch: `chore/r3-8-compose-access-host-members`. Pure type-level refactor, zero
behavior change.

## What the audit asked for

> keep the seam pattern (it is type-pinned and genuinely keeps private members
> honest), but compose shared member groups into small named interfaces (e.g. a
> `TaskCoreAccess` for id/api/abort/cwd/messages) that the per-module interfaces
> extend, following the composition precedent of `TaskStreamProcessorAccess`.
> Target: the recurring members declared once. Do **not** delete the seams.

## Design: why the groups are one-member-each, not one `TaskCoreAccess`

The audit's example name (`TaskCoreAccess` for id/api/abort/cwd/messages) is a
suggestion, not a spec; its TARGET is "each recurring member name is declared in
exactly one interface". I computed the exact consumer set of each recurring
member from the interface bodies:

| member                         | interfaces declaring it (before)                                                                              |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `taskId`                       | 13 task-side Access interfaces                                                                                |
| `api`                          | ApiLoop, ContextManager, MessageLog, StreamProcessor, ApiRequestBuilder, RetryHandler + (Lifecycle, narrowed) |
| `apiConfiguration`             | same six + Lifecycle                                                                                          |
| `apiConversationHistory`       | ApiLoop, ContextManager, MessageLog, Lifecycle, Subtasks, Resumption, ApiRequestBuilder                       |
| `clineMessages`                | + AskSay, TokenTracking, StreamProcessor, Assembler, Lifecycle, Resumption                                    |
| `providerRef`                  | all task-side interfaces except TokenTracking/Assembler/StreamToolCallHandler                                 |
| `abort`                        | 11 task-side interfaces                                                                                       |
| `isBackground`                 | ApiLoop, MessageLog, AskSay, Lifecycle, ApiRequestBuilder, RetryHandler                                       |
| `cwd`                          | ApiLoop, MessageLog, AskSay, Lifecycle, ContextManager, Resumption, ApiRequestBuilder                         |
| `cloudSyncedMessageTimestamps` | ApiLoop, MessageLog                                                                                           |

These sets are all DIFFERENT. A group bundle (say id+api+abort+cwd+messages)
extended by any interface would drag in members that module does not touch —
widening the seam, which D3 explicitly forbade ("Access-interface members are
load-bearing seams, not accidental forwarding"). Two members are genuinely
co-extensive (`taskId` everywhere; `api`+`apiConfiguration` on the same six),
but bundling those two pairs still forces e.g. TokenTracking (which has only
`taskId`+`clineMessages`) to keep its own declarations. Conclusion: the faithful
implementation is one exact-user-set group per recurring member, extended only
by the interfaces that touch every member of it.

## New files

- `src/core/task/access-groups.ts` — 10 groups: `TaskIdAccess`,
  `TaskProviderRefAccess`, `TaskAbortFlagAccess`, `TaskApiHandlerAccess`,
  `TaskApiConfigurationAccess`, `TaskApiConversationHistoryAccess`,
  `TaskClineMessagesAccess`, `TaskCloudSyncTimestampsAccess`,
  `TaskBackgroundFlagAccess`, `TaskWorkingDirectoryAccess`.
- `src/core/webview/host-groups.ts` — 7 groups: `ContextProxyHostMember`,
  `ProviderSettingsManagerHostMember`, `CurrentTaskHostMember`,
  `UpdateTaskHistoryHostMember`, `TaskHistoryStoreHostMember`,
  `PostMessageHostMember`, `ActivateProfileHostMember`.

## Interfaces now composed (extends)

Task side (13): `TaskApiLoopAccess`, `TaskLifecycleAccess`,
`TaskContextManagerAccess`, `TaskMessageLogAccess`, `ApiRequestBuilderAccess`,
`TaskStreamProcessorAccess`, `TaskAskSayAccess`, `TaskSubtasksAccess`,
`RetryHandlerAccess`, `TaskResumptionAccess`, `TaskTokenTrackingAccess`,
`AssistantMessageAssemblerAccess`, `StreamToolCallHandlerAccess`.

Webview side (6): `WebviewStatePusherHost`, `TaskHistoryGatewayHost`,
`DelegationHost`, `CloudProfileSyncHost`, `ModeProfileBindingHost`,
`BackgroundTaskHost`.

Left as-is (no recurring members to compose): `TaskSlotHost`,
`TaskEventForwardingHost`. `TaskStreamProcessorAccess` keeps its existing
extends of `StreamToolCallHandlerAccess`/`AssistantMessageAssemblerAccess`.

## Deliberate narrowings preserved (documented in place)

- `TaskLifecycleAccess.api` — narrow `{ cancelRequest; getModel }`, NOT
  `TaskApiHandlerAccess` (Lifecycle deliberately touches only those two).
- `TaskLifecycleAccess.rooIgnoreController`/`fileContextTracker`/`diffViewProvider`
  — narrow disposal-only views.
- `TaskHistoryGatewayHost.getCurrentTask()` — `{ readonly taskId }`, not the
  full `Task` (NOT `CurrentTaskHostMember`).
- `DelegationHost.getTaskHistoryStore` — `Pick<..., "get" | "atomicReadAndUpdate">`,
  wider than `TaskHistoryStoreHostMember`'s `"get"`, so kept local.
- `ProviderStateBuilder` is not a Host seam; untouched.
- `ModeProfileBindingHost.providerSettingsManager` — the intersection
  (`Pick<...4 methods> & ProviderSettingsManagerHostMember["providerSettingsManager"]`)
  re-states the inherited member narrowed to its wider local use. This is a
  compatible override, checked by tsc.

## Pin spec update

`src/core/task/__tests__/Task.access-types.spec.ts` now also assigns `Task` to
every one of the 10 groups (`assertTaskSatisfiesAccessGroups`), so a group
member-set change is tsc-checked the same way the per-module interfaces are.
`TaskLifecycle.lazy-access.spec.ts` untouched (its stub builds
`Partial<TaskLifecycleAccess>`; group members resolve identically).

## Verification

- `tsc --noEmit` (src): exit 0. ESLint on all touched files: clean.
- `core/task/__tests__`: 67 files / 549 tests green.
- Touched webview specs + ClineProvider family: green (see completion notes for
  the full list and counts).
- External stub-using specs (checkpointed-tools, system-prompt-parity,
  tool-policy-lists, api-delegation-events, new-task-delegation): green.
- `api/__tests__/cost-call-sites.characterization.spec.ts`: 1 test FAILS —
  **pre-existing on main** (verified in a clean /tmp worktree at `ae6f6260e`:
  same `access.api.getModel()` TypeError at TaskStreamProcessor.ts:617; the
  spec's stub never provided `api`). Not caused by this change; left for a
  separate fix.
- `pnpm knip`: only the two known pre-existing findings (zoo-prs twins, .css
  config hint). `node scripts/find-test-only-exports.mjs --check`: exit 0.
- Prettier check on all touched files: clean.

## Deviation from the audit's example

The audit's illustrative `TaskCoreAccess` bundle was not implemented because it
would widen the seams (evidence table above). The audit's own verify-by-content
criterion ("each recurring member name declared in exactly one interface") is
met for all ten recurring members and the composed Host members.
