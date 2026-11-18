# Subagent header title unfolds the full subtask prompt

Status: done on branch feat/subagent-header-full-prompt, not merged
Related plans: 2026-11-18_11-15_subagent-transcript-autoscroll.md, 2026-11-18_11-35_subagent-header-context.md
Touched:

- `webview-ui/src/components/chat/SubagentTranscriptView.tsx`
- `webview-ui/src/components/chat/__tests__/SubagentTranscriptView.spec.tsx`
- `.changeset/subagent-header-full-prompt.md`

## Problem

At the parent commit the subtask message was a Virtuoso `Header`
component (`listComponents`, lines 289-302), a box capped at
`max-h-48 overflow-y-auto`. The title above it was plain text
(`<TabTitle title={description}>`, line 331), and `description` is the truncated
first line from the summary or history item (line 314). Since the previous
commit the list opens at the bottom (`taskTs`, line 280), so the box was scrolled
out of sight and the whole prompt could not be read. The chat solves the same
need with a clickable task card: `TaskHeader.tsx` lines 217-257 render a `button`
with `aria-expanded` and the `chat:task.expand` / `chat:task.collapse` tooltip,
and lines 284-285 show the text in a `max-h-[40vh]` pane.

## Fix

- `listComponents` deleted; Virtuoso no longer receives a `components` prop, so
  no box heads the list.
- The title becomes a `button` inside `StandardTooltip`, with `aria-expanded`,
  `aria-controls="subagent-prompt"` and the `chat:task.collapse` /
  `chat:task.expand` tooltip; the label is `description` truncated, followed by
  `ChevronUp` or `ChevronDown`.
- `const [isPromptExpanded, setIsPromptExpanded] = useState(false)`; while
  expanded, a `div id="subagent-prompt"` holding `MarkdownBlock` renders under
  the title row, capped at `max-h-[40vh] overflow-y-auto`.
- Without a subtask message (`subtaskText === undefined`) the title stays plain
  text, as before.

## Tests

`SubagentTranscriptView.spec.tsx`, "the title unfolds the whole subtask message,
like the task card of the chat". It asserts the prompt text is absent, clicks
`getByRole("button", { name: "fix the ladder" })`, expects `aria-expanded="true"`
and the text present, clicks again and expects it gone. The react-virtuoso mock
lost its `components` and `Header` support, and "shows every row after the
subtask message, read-only" no longer asserts the header box.

Mutation check: never rendering the prompt box failed the new test on
`getByText("Repo: Game. Fix the ladder.")` after the first click.

## Notes

- The subtask box at the top of the transcript list is removed; the prompt lives
  in the header now.
- The folded label is still `description` (the summary or history first line),
  not the first line of the decoded prompt.
- The expanded state is local and resets on a subagent switch, because
  `App.tsx` mounts the view with `key={subagentTranscript.taskId}`.
- The transcript rows and the follow behaviour of the previous commit are
  unchanged; an unfolded prompt takes height from the list, which keeps its own
  scroll.
