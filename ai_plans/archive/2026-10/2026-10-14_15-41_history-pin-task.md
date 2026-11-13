# Pin a task to the top of the task lists

**Status:** implemented on `feat/history-pin-task` (stacked on `feat/history-running-first`), pull request open,
not merged
**Related plans:** `2026-10-14_15-36_history-running-first.md` (the section ordering this branch extends)
**Touched:**

- `packages/types/src/history.ts` (`pinnedAt?: number` on `historyItemSchema`)
- `packages/types/src/vscode-extension-host/taskLifecycle.ts` and its type-surface spec (`setTaskPinned`)
- `src/core/webview/TaskHistoryGateway.ts` (`setTaskPinned`), `src/core/webview/ClineProvider.ts` (delegate),
  `src/core/webview/messageHandlers/taskLifecycle.ts` (handler)
- `webview-ui/src/components/history/PinButton.tsx` (new), `TaskItemFooter.tsx`, `types.ts` (`pinned` section),
  `useTaskSearch.ts`, `useGroupedTasks.ts`, `HistoryPreview.tsx`
- `webview-ui/src/i18n/locales/*/history.json` (`pinTask`, `unpinTask`, `section.pinned`, all 18 locales)
- tests: `TaskHistoryGateway.spec.ts`, `TaskHistoryStore.spec.ts`, `taskMetadata.spec.ts`, the routing spec and its
  snapshot, `PinButton.spec.tsx` (new), `TaskItemFooter.spec.tsx`, `useTaskSearch.spec.tsx`,
  `useGroupedTasks.spec.ts`, `HistoryPreview.spec.tsx`, `HistoryView.a11y.spec.tsx`

## Symptom

The owner: "Dodaj funkcjonalność 'Przypnij', tasku na liście tasków i w historii - ma zatrzymywać przesuwanie
tasku wgłąb listy historii i pozwalać otwierać go wygodnie użytkownikowi." (Add a "Pin" action for a task in the
task list and in the history: it must stop the task from drifting down the history list and let the user open it
easily.) Every new task pushes the older ones down, and the preview on the welcome screen shows only four groups, so
a task the user keeps coming back to soon disappears from view.

## What was happening

- `packages/types/src/history.ts:7` had no field for a user choice like this; the store parses every record with
  `historyItemSchema.safeParse` (`TaskHistoryStore.ts:973`, `:1150`), and a Zod object drops unknown keys, so a
  field must be in the schema to survive a reload.
- A running task saves its history item again and again (`TaskMessageLog.updateProviderTaskHistory` with the item
  built by `taskMetadata.ts:136`). `TaskHistoryStore.upsert` merges the save into the stored record
  (`TaskHistoryStore.ts:626`, `{ ...base, ...item }`), so a key the save does not name survives; a save naming the
  key, even as `undefined`, would clear it.
- The ordering of the lists after the branch below: `listSection` / `bySection` in
  `webview-ui/src/components/history/types.ts` with one section, "active".

## Fix

- Data: `pinnedAt?: number` (epoch ms of the pin, absent when not pinned) on `historyItemSchema`; optional, not
  nullable, so the cloud and the CLI, which never send it, are unaffected. The time is what orders the pinned
  tasks.
- Message: `setTaskPinned` (webview to host, task lifecycle domain) with `text` = task id and `bool` = pinned. The
  handler calls `ClineProvider.setTaskPinned`, which calls `TaskHistoryGateway.setTaskPinned`: an
  `atomicReadAndUpdate` under the store lock with this provider's origin that sets `pinnedAt` (keeping the first
  pin time when the task is pinned already) or removes the key, then a `taskHistoryItemUpdated` push with the
  stored item. A failure (the task was deleted meanwhile) is logged, nothing else.
- Ordering: a new section "pinned" above "active". `listSection` returns "pinned" for any row with `pinnedAt`, so
  a pinned task that works keeps its pinned slot and still shows the running indicator. Pinned rows go most
  recently pinned first (`bySection` compares `pinnedAt`), so the block never moves while the user pins nothing:
  new tasks and saves of running tasks do not reorder it. The History view shows a "Pinned" header above the
  "Active" one; the preview shows every pinned and every working group, then fills up to four. As for the running
  tasks, a search ranked by relevance keeps the relevance order.
- UI: `PinButton` in the row actions of `TaskItemFooter` (both variants, so the preview and the History view),
  before the copy button: `codicon-pin` with the tooltip "Pin", `codicon-pinned` in the foreground colour with
  "Unpin" on a pinned row (that filled pin is the row's pin marker), `aria-pressed`, and `stopPropagation` so the
  click does not open the task. Hidden in selection mode like the other actions.
- Subtasks: no pin button on a subtask row (`isSubtask`). The lists order root rows; a pinned subtask would stay
  inside its tree and the pin would do nothing visible. An orphan subtask whose parent is gone is shown as a root
  and can be pinned.

## Tests

- `TaskHistoryGateway.spec.ts`: pinning sets `pinnedAt` with the gateway's origin and pushes the stored item; a
  second pin keeps the first time; unpinning removes the key and leaves the other fields as they were.
- `TaskHistoryStore.spec.ts`: a pinned record keeps `pinnedAt` when the task saves its item again (the save does
  not name the key), and a fresh store that reads the disk still has it (the schema keeps the field).
- `taskMetadata.spec.ts`: the item a task saves never has a `pinnedAt` key, which is what keeps the merge from
  clearing the pin.
- Routing spec: `setTaskPinned` routes to `provider.setTaskPinned(id, true)`; the routed-type count is 135.
- `PinButton.spec.tsx`: pin and unpin messages, the label, `aria-pressed`, the filled pin, no row click.
- `TaskItemFooter.spec.tsx`: the button on a root row in both variants, not on a subtask row, not in selection mode.
- `useTaskSearch.spec.tsx`, `useGroupedTasks.spec.ts`: pinned above working above the rest, most recently pinned
  first, a pinned working task in the pinned slot with its status; pinned first also when nothing works.
- `toDayRows`: a "Pinned" header, then "Active", then the day headers.
- `HistoryPreview.spec.tsx`: pinned and working groups are all shown together.
- `HistoryView.a11y.spec.tsx`: the rendered order and headers, and the unpin click posts the message without
  opening the task.

Gates: the touched specs (183 webview tests in `components/history`, 223 host tests in the four host specs, the
types surface spec), `tsc --noEmit` in `packages/types`, `src` and `webview-ui`, eslint on the touched files,
`check-react-compiler-bailouts`, `find-missing-translations`, `find-unused-i18n-keys --check`,
`find-test-only-exports --check`, `pnpm knip`.

## Notes

- Pinning is per task, not per workspace: a pinned task shows in the lists of its own workspace (or all
  workspaces), like every other task.
- Deleting a pinned task, alone or in a batch, needs nothing special: the record goes away with its pin.
- A stale full copy of a history item written later through `updateTaskHistory` would bring back an older
  `pinnedAt` (or drop a newer one only if the copy named the key, which none does). The writers that spread a full
  copy (`ModeProfileBinding`, `DelegationService`) read the item from the store a few awaits before the write, so a
  pin or unpin landing in exactly that window could be undone; the user sees it and clicks again. Moving those
  writers to `atomicReadAndUpdate` would close it and is out of scope here.
- The pin is not shared through the cloud: no cloud schema carries history items.
