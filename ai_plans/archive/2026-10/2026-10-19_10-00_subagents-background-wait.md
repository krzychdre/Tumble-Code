# Subagents: the main loop stays responsive, results arrive one by one, per-profile request cap

**Status:** in progress (stack of three branches)
**Related plans:** 2026-10-18_20-45_subagent-no-turn-limit.md, 2026-10-18_21-20_subagents-panel-all-runs.md
**Branches (stacked, in merge order):**

1. `feat/subagents-background-wait` (owner points 1 and 2)
2. `feat/profile-max-concurrent-requests` (owner point 5, extension and CLI)
3. `feat/subagents-eager-use` (owner point 4, prompts)

## Owner request (2026-10-19, verbatim, Polish)

1. "Podczas pracy subagentów, chciałbym móc uzyskać odpowiedź od głównej pętli"
2. "Kiedy jeden z podagentów skończy, a rozdział pracy to umożliwia, może zostać uruchomiony następny."
3. "Subagenty mogą wykorzystywać workspace'y aby nie kolidować (ale to już chyba się dzieje)"
4. "Skoro dostawca modelu na to pozwala, wykorzystujmy subagentów często i chętnie (jeśli to tylko możliwe)"
5. "Każdy model ma ograniczoną pulę kontekstu i równoległych zapytań. Dodaj do konfiguracji odrębną ilość max.
   jednoczesnych zapytań do providera, która będzie capem ilości spawnowanych agentów. [...] To samo dla CLI +
   uzupełnij przykładową konfigurację."

## What happens today

- `RunParallelTasksTool.execute` (src/core/tools/RunParallelTasksTool.ts) awaits `runWithConcurrency` over all
  subtasks and only then pushes one aggregated report. The parent Task sits inside the tool call the whole time.
- A user message typed meanwhile goes to `task.messageQueueService` (messageHandlers/taskLifecycle.ts). The queue
  is drained only at the next `ask` (TaskAskSay.ask) or by `processQueuedMessages` (edit tools). Nothing asks
  while the fan-out runs, so the user waits for the slowest subagent (point 1).
- The pool already starts the next queued subtask when one finishes, but the parent cannot react to one result
  (start a dependent follow-up) until all of them end; a single-subtask call is rejected (point 2).
- Each subagent already runs in its own git worktree under `~/.roo/worktrees/` with its own branch, locked by pid
  and swept when orphaned (point 3: nothing to do).
- `parallelTasksMaxConcurrency` (global setting, default 3, max 8) caps one fan-out. There is no per-profile cap and
  two fan-outs of one task would each get the full cap (point 5).
- The tool description and the orchestrator role tell the model to use subagents only for TINY jobs and never with
  a single subtask (point 4).

## Design

### Branch 1: background fan-outs and `wait_for_subagents`

- A provider-level tracker (one per ClineProvider, next to `subagentRegistry`) owns every running fan-out, keyed by
  parent task id, not by Task instance, so a rehydrated parent instance sees the same subagents. Per parent it
  keeps the running jobs and the finished results the parent model has not seen yet.
- One global slot pool bounds the subagents running at once in the whole provider by `parallelTasksMaxConcurrency`
  (FIFO queue). Branch 2 adds a per-profile limit to the same pool.
- `run_parallel_tasks` validates, asks approval, starts the subagents in the background and then waits the same
  way `wait_for_subagents` does. One subtask is now allowed (a follow-up started after a result).
- New tool `wait_for_subagents` (no parameters, read-only, no approval): returns when
    - one or more subagents of this task finished: their results, plus the list still running and what to do next;
    - the user sent a message: it is taken from the queue, shown in the chat as the user's message, and returned in
      the tool result with the instruction to answer the user first; the subagents keep running;
    - nothing is running and nothing is pending: says so.
- A result that finishes while nobody waits stays pending. If the parent sits at an idle or resumable ask (its
  turn ended, or it was rehydrated), the pending results are delivered as a queued message, which wakes it.
- `attempt_completion` is refused while the task has running subagents or results it has not read, with the
  instruction to call `wait_for_subagents`.
- Environment details of a parent with background subagents list them (running, finished but unread).
- Cancel: an explicit user cancel of the parent cancels its subagents; abandonment (history switch, rehydrate)
  leaves them running, as today.
- The subagents sidecar (`subagents.json`) is written after each subagent ends, not once per fan-out.

### Branch 2: `maxConcurrentRequests` per profile

- `ProviderSettings.maxConcurrentRequests` (whole number >= 1, unset = no per-profile cap): how many requests this
  provider and model take at once. A subagent takes a slot of the profile it runs on; the parent task counts as
  one request when it runs on the same profile. A fan-out that could never start on a profile (limit 1, parent on
  it) is refused with a message telling the model to do the work itself.
- Settings UI: a number field in the profile settings next to the mistake limit (empty = no limit).
- CLI: `models.<id>.maxConcurrentRequests`, validated like the other model keys, works with every provider, becomes
  the profile's `maxConcurrentRequests`; README and `examples/cli-settings.example.json` show it.

### Branch 3: use subagents eagerly when the provider allows it

- Tool description and orchestrator/code guidance: fan out any independent, self-contained job (not only tiny
  ones), one at a time is fine, keep working or answer the user while they run. Keep the measured rule that one
  review/audit is never sliced into chunks.
- When the profile allows several requests at once, the prompt states how many subagents can run.

## Tests / Notes

Filled in by each branch.

### Branch 1 (`feat/subagents-background-wait`)

What was built:

- `src/core/webview/BackgroundSubagents.ts`: the tracker, one per ClineProvider (`provider.backgroundSubagents`),
  keyed by parent task id. `start(parentTaskId, { description, mode })` gives each subagent a number that counts
  across all fan-outs of the parent (`#1`, `#2`, ...), so a weak model never sees two "#1". `finish(parentTaskId,
number, result?)` moves it to unread (no result = dropped, used for a user-cancelled parent), wakes subscribers,
  and calls `deliverIfIdle` when nobody waits. `subscribe`, `takeUnread`, `running`, `unreadCount`, `hasWork`,
  `environmentSection`.
- `src/core/webview/SubagentSlotPool.ts`: `slots.acquire(request: SlotRequest, signal?) => Promise<release>`,
  strict FIFO, `SlotRequest = { globalLimit }`. Each request carries its own limits, so branch 2 adds
  `profileKey` / `profileLimit` to `SlotRequest` and one check in `fits()`. An aborted waiter leaves the queue
  (`SlotWaitAbortedError`).
- Profile before slot: `BackgroundTaskRunner.resolveSubagentProfile(taskMode)` (mode-pinned profile, else the current
  one; also exposed as `ClineProvider.resolveSubagentProfile`). `runOneSubtask` resolves it, then acquires the slot
  (`{ globalLimit }`, branch 2 adds the profile's name and limit here), then creates the worktree and calls
  `createBackgroundTask` with `apiConfiguration` + the new `apiConfigName` option, so the profile is resolved once.
  `createBackgroundTask` keeps its own mode resolution for callers that do not pass a profile.
- `run_parallel_tasks`: validate, approve, then `startFanOut` (registry placeholders, tracker entries, the parent's
  TaskAborted listener, `runWithConcurrency` in the background) and `waitForSubagents`. The tool result starts with
  "Started N subagent(s) in the background: #a, #b." One subtask is accepted.
- `wait_for_subagents` (`src/core/tools/WaitForSubagentsTool.ts`): no parameters, strict schema, approval category
  "none", says a `{ tool: "waitForSubagents" }` row. Same gates as run_parallel_tasks (modes group and always
  available list, hidden for background tasks and when parallel tasks are Off via `getRequestDisabledTools`,
  absent from the slim and compact toolsets because its descriptor row sets neither flag).
- Texts for the model live in `src/core/tools/helpers/subagentResults.ts` (`formatParallelResults` moved there).

Decisions taken while building (simpler or safer than the design text):

- The per-call `maxConcurrency` stays a per-fan-out bound (`runWithConcurrency`); the global pool caps the total.
  No schema change.
- A user message wins over a ready result: the wait returns the message (the results stay unread and the text says
  how many are ready). A queued message is only taken when there is something to wait for; otherwise it stays in
  the queue for the next ask, as before.
- A text-only turn while subagents run or results are unread is the model answering the user, not a completion:
  `TaskApiLoop` skips the text-completion fallback and sends a reminder to call `wait_for_subagents` instead of the
  generic noToolsUsed text (the consecutive no-tool counter still applies). Without this, the answer would be
  relabelled as the completion result and then refused.
- `ToolRepetitionDetector` never trips on `wait_for_subagents` (no arguments, so every call looks identical). A call
  with nothing to wait for counts a mistake instead, so a loop still reaches the mistake limit.
- Delivery to an idle or resumable parent is also retried on the provider's `TaskIdle` / `TaskResumable` events: the
  task status changes 2 s after the ask appears, and a result arriving in that window would otherwise wait for the
  next `wait_for_subagents`.
- `SubagentRegistry.beginFanOut/endFanOut` now count per parent: a follow-up fan-out can overlap an earlier one, and
  the first `endFanOut` used to mark the parent settled while the second still ran.
- CLI: a message typed while the task works (no pending ask, not complete) is now sent as `queueMessage`, like the
  VS Code chat. Before, it went out as an `askResponse` with no ask open, so it never reached the queue (the wait
  could not see it) and answered whatever the task asked next.

Tests (package-local vitest):

- `src/core/webview/__tests__/SubagentSlotPool.spec.ts` (6): cap, FIFO, two fan-outs share the cap, double release,
  abort while queued, limit below 1.
- `src/core/webview/__tests__/BackgroundSubagents.spec.ts` (11): numbering, unread, dropped result, subscribers,
  delivery at idle/resumable, none while running/interactive/waited/aborted, environment section.
- `src/core/tools/__tests__/WaitForSubagentsTool.spec.ts` (8): result with still-running list, already-unread
  results, user message interrupt (say user_feedback, images), nothing to wait for leaves the queue alone, abort
  (listeners removed), tool row, mistake on nothing to wait for, refused in a subagent.
- `src/core/tools/__tests__/RunParallelTasksTool.spec.ts` reworked for the new flow: returns on the first result,
  single subtask, numbering across two fan-outs, global cap across two fan-outs, profile before slot, user message
  ends the wait, user cancel drops results, abandonment keeps them, delivery to a resumable instance, none to a busy
  one, listener kept until the last subagent ends, sidecar per subagent.
- `attemptCompletionTool.spec.ts` (refusal with running / unread, completes when done),
  `getEnvironmentDetails.spec.ts` (section), `ToolRepetitionDetector.spec.ts`, `SubagentRegistry.spec.ts`
  (overlapping fan-outs), `system-prompt-input.spec.ts`, `TaskApiLoop.text-completion-fallback.spec.ts` (reminder),
  parser/dispatch/examples tables, `packages/core` toolPayload kinds, webview `toolRendererDispatch.spec.ts`, CLI
  `useTaskSubmit.test.tsx` (queueMessage while working, askResponse when complete).

Full `src` suite in the worktree (`--maxWorkers=2`): 626 files passed, 61 failed, 4 skipped (10669 tests passed,
122 failed). Every failure also fails on the base commit 9903580b3: 57 tree-sitter files and `dist_assets.spec.ts`
need the built `src/dist` (wasm files; the worktree is not built), and `backgroundTask.spec.ts`,
`ClineProvider.backgroundTaskOptions.spec.ts` and `messageHandlers/__tests__/registry.spec.ts` are red on main.

Open points:

- A user cancel cascades to the subagents only through the parent instance that started them (unchanged). After the
  parent was rebuilt (history switch, rehydrate), cancelling the new instance leaves the subagents running; they can
  be stopped from the panel.
- The tracker lives in memory: an extension host restart loses running subagents, as before (their worktrees are
  swept as orphans).
