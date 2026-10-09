# Tasks run in an editor tab never reach the cloud: investigation & fix

**Status:** fixed on `fix/bridge-tab-provider-messages`
**Related plans:** `archive/2026-06/2026-06-21_fix-extension-offline-on-shared-task.md` (bridge default-on)
**Touched:**

- `src/core/webview/ClineProvider.ts` (`observeInstances`)
- `src/extension/api.ts` (listen to every provider, once)
- `src/extension/__tests__/api-tab-provider-events.spec.ts` (new)
- `src/core/webview/__tests__/ClineProvider.spec.ts` (one test)

## Symptom

A task started in a Tumble Code editor tab (prompt "I got data to analyse in
private_docs/LC_PRO...", root `01a120f3-1b3c-...`, 9 subtasks) did not appear in the
self-hosted cloud web view, while the cloud metrics kept counting its cost and tokens.

Evidence on 2026-10-09:

- `telemetry_events` held the task and every subtask (`LLM Completion`, `Task Message`,
  `Tool Used`, ...), so cost and tokens were counted.
- `tasks` and `task_messages` held none of them. Every task of the same VS Code window up to
  12:11 UTC was stored; every task from 13:56 UTC on was missing. VS Code restarted at
  13:12 UTC and the bridge log says `remote control bridge connected`.
- The server logged no `[bridge] failed to persist` warning: the messages never arrived.

## What was happening

The cloud has two independent inputs:

1. Telemetry (`POST /api/events`, `TelemetryService`, process-wide): cost, tokens, counts.
2. The remote-control bridge (socket.io, `BridgeOrchestrator`): the task's messages. The server
   creates the `tasks` row from the first bridged message (`upsert_task_message`).

`BridgeOrchestrator` takes messages from the `API` event bus. `API.registerListeners`
was called for the sidebar provider and for the tab `API.startNewTask` opens itself, and for
nothing else. A tab opened by the "open in new tab" command, or the tab
`replaceOrphanedTabs` opens after a host restart, is a separate `ClineProvider` whose
`TaskCreated` nobody listened to. Its tasks therefore produced telemetry but no bridge
traffic, and the cloud never learned the task existed.

## Failure surface

| Where the task runs                                       | Before         | After  |
| --------------------------------------------------------- | -------------- | ------ |
| Sidebar                                                   | stored         | stored |
| Tab opened by `API.startNewTask({ newTab })`              | stored         | stored |
| Tab opened by the command / editor title button           | telemetry only | stored |
| Tab reopened after a host restart (`replaceOrphanedTabs`) | telemetry only | stored |

## Fix

`ClineProvider.observeInstances(observe)` calls `observe` for every live provider and for
each one constructed later (the constructor notifies observers right after joining
`activeInstances`), and returns a disposable. `API` registers the sidebar explicitly (it is
what the API is built around, and tests hand in stand-ins) and observes every instance;
a `WeakSet` keeps a provider from being listened to twice, which would forward every
event twice. The explicit `registerListeners` after `openClineInNewTab` is gone: the
observer covers it.

## Tests

- `api-tab-provider-events.spec.ts`: a tab created after the API forwards its task's
  message; a sidebar message is forwarded exactly once. Verified by restoring `api.ts`
  from `main`: the tab test fails, the once test passes.
- `ClineProvider.spec.ts`: `observeInstances` replays the live provider, reports a new
  one, and stops after `dispose`.

## Caveats

- Messages of a running tab task that were sent before the fixed build loads are not in
  the cloud; sharing the task (which backfills the whole conversation) uploads them.
- The bridge's `instanceState` snapshot and remote commands (`cancelTask`,
  `showTaskWithId`, ...) still address the sidebar provider only. For a tab task the web
  cockpit's running flag and Stop act on the sidebar's task. Not changed here.
- Separate server bug seen in the same logs: concurrent telemetry events naming the same
  subtask race in `record_relation` (`task_relations_pkey` duplicate, `POST /api/events`
  500, the event is retried by the client queue). Not changed here.
