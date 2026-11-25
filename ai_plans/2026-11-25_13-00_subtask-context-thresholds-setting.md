# Subtask context limits set in the Settings view

Status: done, merged as #1364.

## Problem

#1363 hard-coded the two context limits of a delegated task: 65% of the model's context window for the handoff
reminder and 85% for the stop (`SUBTASK_CONTEXT_REMINDER`, `SUBTASK_CONTEXT_STOP` in `TaskApiLoop.ts`). The owner
wants both configurable in the GUI.

## Fix

- Two global settings, `subtaskContextReminderPercent` and `subtaskContextStopPercent` (`global-settings.ts`), with
  defaults 65 and 85 in `SETTINGS_DEFAULTS`, listed in the webview state keys (`state.ts`) and saved on Save
  (`settings/schema.ts`).
- `TaskApiLoop.handleSubtaskContextLimit(state, content)` reads them from the cycle's state snapshot; the reminder
  text names the configured stop.
- Settings view, Subagents section: two sliders in steps of 5. The reminder runs from 10 to the stop minus 5, the
  stop from the reminder plus 5 to 100, so the reminder is always below the stop and the host needs no check.
  Labels and descriptions in all 18 locales.
- The CLI has no control for them and uses the defaults.

## Tests

`TaskApiLoop.subtask-context-limit.spec.ts` (configured thresholds), `TaskApiLoop.cycle-state-snapshot.spec.ts`
(the cycle passes its state), `SubagentSettings.spec.tsx` (slider bounds, defaults shown); state builder and schema
snapshots updated; mutation-checked.
