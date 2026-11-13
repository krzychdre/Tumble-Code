# Web Resume button does nothing: investigation & fix

**Status:** fixed on `fix/cloud-resume-button`
**Related plans:** `2026-10-09_bridge-commands-target-task-by-id.md` (Stop half of the same controls)
**Touched:**

- `src/core/webview/ClineProvider.ts` (`resumeStoppedTask`) + spec
- `src/extension/bridge.ts`
- `packages/cloud/src/bridge/types.ts`, `commandHandlers.ts` (+ tests)

## Symptom

On a task's cloud web page, Stop stops the task, but Resume does nothing: the task stays
stopped and the page keeps showing Resume.

## Root cause

The web page sends `resume_task`; the extension's bridge dispatched it to
`provider.showTaskWithId(taskId)`. That never resumes anything:

1. Stop goes through `cancelTask`, which aborts the task and rebuilds it from history as the
   current task. So right after Stop the task is already the current task, and
   `showTaskWithId` starts with `if (id !== this.getCurrentTask()?.taskId)`: a no-op.
2. For a task not on screen, `showTaskWithId` rebuilds it from history, and a rebuilt task
   (`TaskResumption.resumeTaskFromHistory`) blocks on a `resume_task` ask until someone answers
   it. In VS Code that answer is the Resume Task button (`askResponse: "yesButtonClicked"`,
   `useChatComposer.ts`). The web never sent one.

## Fix

`ClineProvider.resumeStoppedTask(taskId)` does what the Resume Task button does: shows the task, waits
(up to 10 s) until that live task's last message is a complete, unanswered `resume_task` ask,
and answers it with `yesButtonClicked`. It returns false when the task never asks that (it is
running, or it finished: `resume_completed_task` is left alone, the web sends a message for
that). The bridge's `resume_task` calls it on the panel that hosts the task, or the sidebar.

The web page and the cloud API need no change; only the extension (VSIX) must be rebuilt.

## Tests

- `ClineProvider.resumeStoppedTask.spec.ts`: answers an ask already waiting, an ask that appears
  after the task is shown, and ignores other asks / no live task.
- `commandHandlers.test.ts`: `resume_task` calls `provider.resumeTask(taskId)`.
