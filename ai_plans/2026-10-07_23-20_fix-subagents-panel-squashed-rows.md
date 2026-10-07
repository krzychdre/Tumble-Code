# Subagents panel: squashed rows with many subagents, panel starts collapsed

**Status:** done (branch `fix/subagents-panel-scroll-collapsed`)
**Related plans:** subagents panel/tail stack (#775-#777)
**Touched:**

- `webview-ui/src/components/chat/SubagentsPanel.tsx`
- `webview-ui/src/components/chat/ChatView.tsx`
- `webview-ui/src/components/chat/__tests__/SubagentsPanel.spec.tsx`

## Symptom

A `run_parallel_tasks` fan-out of 20 subagents ("Subagents: 20/20 active"). The
expanded panel showed 20 rows cut to a few pixels each: the text was sliced in
half and unreadable, and there was no scrollbar.

The owner also asked for the list to be collapsed when a task is opened.

## What was happening

The list already had a height cap and a scrollbar
(`flex flex-col ... max-h-[50vh] overflow-y-auto`), but it never scrolled:

- The list is a flex column, so every row is a flex item with the default
  `flex-shrink: 1`.
- Every row has `overflow-hidden`. A flex item whose `overflow` is not
  `visible` loses its content-based minimum height (`min-height: auto`
  resolves to 0).
- So when 20 rows did not fit in 50vh, the browser shrank the rows instead of
  overflowing the list. Nothing overflowed, so the scrollbar never appeared,
  and `overflow-hidden` clipped each row's content.

## Failure surface (before/after)

| Scenario                           | Before                                  | After                          |
| ---------------------------------- | --------------------------------------- | ------------------------------ |
| Few rows, fit in 50vh              | fine                                    | fine                           |
| Many rows (20), more than 50vh     | rows squashed, unreadable, no scrollbar | full-height rows, list scrolls |
| Opening a task with a fan-out      | panel expanded                          | panel collapsed                |
| Switching directly to another task | panel kept its state                    | panel collapsed again          |

## Fix

- `SubagentRow` root gets `shrink-0`, so rows keep their height and the capped
  list overflows and scrolls.
- `SubagentsPanel` starts with `panelExpanded = false`.
- `ChatView` renders `<SubagentsPanel key={currentTaskId} ... />`, so opening
  another task remounts the panel and it starts collapsed again (the panel can
  stay mounted across a direct task switch).

## Tests

`SubagentsPanel.spec.tsx`:

- `starts collapsed so a wide fan-out does not cover the chat`
- `scrolls the list instead of squashing the rows`: 20 rows, list keeps its
  cap + `overflow-y-auto`, every row has `shrink-0`. JSDOM does no layout, so
  this asserts the classes (same approach as the existing tail-cap test).
  Verified by removing `shrink-0`: the test fails; restored: passes.
- Existing tests expand the panel first (`expandPanel` helper).

## Notes

- A child that is `awaiting_input` still auto-expands its own row, but with
  the panel collapsed the user has to open the panel first. The header count
  shows the panel is live; auto-opening the panel for a waiting child would be
  a separate change.
