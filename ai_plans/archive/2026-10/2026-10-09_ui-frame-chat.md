# UI frame language: the chat transcript

**Status:** done on `feat/ui-frame-chat`, PR open, not merged.
**Related plans:** `2026-10-09_ui-frame-language.md` (the tokens and rules this branch applies).
**Target look:** the "Chat" screen, "Proposal" column of `assets/2026-10-09_ui-frame-language-demo-screens.html`.

## Touched files

All under `webview-ui/src/components/`.

- Shared blocks: `common/ToolBlock.tsx`, `common/ToolUseBlock.tsx`, `common/CodeAccordion.tsx`, `common/DiffView.tsx`,
  `common/Thumbnails.tsx`, `common/MermaidBlock.tsx`, `common/MermaidButton.tsx`.
- Chat: `ChatView.tsx`, `ChatRow.tsx`, `TaskHeader.tsx`, `ContextWindowProgress.tsx`, `TodoListDisplay.tsx`,
  `UpdateTodoListToolBlock.tsx`, `ReasoningBlock.tsx`, `ErrorRow.tsx`, `WarningRow.tsx`, `CommandExecution.tsx`,
  `CommandExecutionError.tsx`, `CommandPatternSelector.tsx`, `TerminalOutput.tsx`, `McpExecution.tsx`,
  `FollowUpSuggest.tsx`, `QueuedMessages.tsx`, `FileChangesPanel.tsx`, `SubagentsPanel.tsx`, `BatchDiffApproval.tsx`,
  `BatchFilePermission.tsx`, `CodebaseSearchResult.tsx`, `CodebaseSearchResultsDisplay.tsx`,
  `AutoApprovedRequestLimitWarning.tsx`, `Announcement.tsx`, `CheckpointWarning.tsx`, `AnnotateButton.tsx`,
  `OpenMarkdownPreviewButton.tsx`, `BlockTimestamp.tsx`, `checkpoints/CheckpointSaved.tsx`,
  `context-management/{CondensationErrorRow,CondensationResultRow,PruneResultRow,TruncationResultRow}.tsx`.
- Row renderers: `rows/renderers/ask/AskRows.tsx`, `rows/renderers/say/{ApiRequestRows,MessageRows,UserFeedbackRow}.tsx`,
  `rows/renderers/tool/{EditFileToolRow,ExpandableToolRows,FileToolRows,SearchToolRows,TaskToolRows}.tsx`.
- Specs: `chat/__tests__/{ChatView.actionBar,ChatView.ask-state-machine,ErrorRow,FollowUpSuggest,ReasoningBlock,TaskHeader}.spec.tsx`,
  `common/__tests__/{Thumbnails,ToolBlock}.spec.tsx`, the golden file `__tests__/__golden__/ChatRow.golden.json`.

## What changed per screen

- **Task header:** a closed card (`border-frame`, `bg-surface`, hover `bg-surface-hover` + `border-frame-hover`,
  `rounded-control`), full foreground text instead of 80%, the context line in the description colour instead of
  `muted-foreground/70`, a focus ring on the toggle button, the chevron in the description colour instead of 60%
  opacity, and the expanded metadata divider on `border-frame` (it used `sideBar-background`, invisible). The to-do
  list moved out of the card, directly under it, as its own card. `ContextWindowProgress` now uses
  `text-[length:var(--text-meta)]` (the bare `text-[var(...)]` form is ambiguous between colour and size).
- **User message:** the inverted 70% foreground block became a card: `bg-surface-hover`, `border-frame`, a 2px
  `textLink` left edge, foreground text, 8px 10px padding. Edit and delete are always visible in the description
  colour (they were `opacity-0` until hover).
- **Tool blocks:** `ToolBlock` is a framed card (`border-frame`, `bg-surface`, `rounded-control`) that keeps the 2px
  status edge; the header row is at least 28px with a `bg-surface-hover` hover; the body sits under a `border-frame`
  rule; the chevron is always in the description colour. `ToolUseBlock` (still used by the file-read rows, the batch
  permission list, the to-do tool block and the header-less code accordion) draws the same frame and a 28px header
  row. Skill and slash-command rows dropped their own `editorGroup-border` frame and use the primitive's.
  `CodeAccordion`'s sticky header keeps an opaque fill (editor background with the surface tint layered on top) so
  code does not show through it; its open-diff and open-file buttons are 22px with a hover fill.
- **Command block:** the undefined `border-vscode-border` became the framed card with a status edge (running, done
  or failed by exit code); the output divider is `border-frame`; `TerminalOutput` is transparent inside the block and
  keeps the ANSI palette. Status dots are all 8px and paired with a word: "Running", the exit code, or "Error". The
  exit tooltip used the key `chat.commandExecution.exitStatus` (dot instead of colon, wrong parameter name) and showed
  the raw key; it now reads "Exited with status N". The auto-approve pattern section uses the frame, a 28px trigger
  with focus ring, description colour instead of 40% opacity, 26px inputs and focus rings on the allow/deny buttons.
- **MCP block:** the details body is the framed card with a status edge; the status dot is 8px (was 6px) and already
  had a word next to it.
- **Thinking:** chevron always visible in the description colour; the body rule is `border-frame-hover`.
- **Error row:** the body is a tinted card (error colour 35% border, 2px error edge, 6% fill), normal weight
  foreground text, copy and docs always visible, `font-sm` (not a class) removed, the details dialog on the frame.
- **Warning row:** the same card in the warning colour; the dismiss button no longer fades to 50% on hover, it gets
  a 22px hover fill and the focus ring.
- **Checkpoint:** the hard-coded cyan gradient became a 1px rule in `charts-blue` at 45%; the label is in the
  description colour, the icon blue.
- **To-do:** the task-header list is a card (`border-frame`, `bg-surface`) with a 28px toggle row instead of the
  invisible `sideBar-background` top border; pending items use the description colour instead of 60% opacity. The
  inline editor in the to-do tool block uses 22px inputs, selects and buttons on `border-input-frame`, outlined
  secondary buttons and a 4px-corner delete confirmation.
- **Follow-up suggestions:** `bg-surface`, `border-input-frame` with hover, `rounded-control`, 6px 10px padding; the
  copy-to-input button is always visible.
- **Approve/Reject bar:** `px-gutter` (12px, was 15px), 8px gap, no fixed 36px row height, default button height.
  The two buttons carry `data-ask-button="primary|secondary"`, because the specs found them by their old `mr-`/`ml-`
  margin classes, which are gone.
- **Queued messages, file changes, subagents:** frame tokens on the items, focus rings on the collapsible triggers
  and on the raw buttons, 22px icon buttons; the subagent permission buttons use the `Button` primitive at 22px; the
  answer input is 26px; the file-changes rows no longer wrap the already framed accordion in a second border.
- **Smaller pieces:** ChatRow has even padding (`px-gutter` both sides); the cost and web pills use `border-frame`;
  the web fetch and web search cards, the codebase-search results, the context-management result panels, the MCP
  ask box and the auto-approve limit warning use the frame and surface; the markdown preview and annotate buttons
  are always visible (22px, description colour); attachment thumbnails have a frame and an always-visible remove
  button; the timestamp no longer dims its parts with opacity; the diff gutter of context lines uses `bg-frame`.

## Not done, and why

- `CheckpointSaved`'s menu still appears only while the row is hovered (it is shown and hidden by component state,
  not by CSS). Making it always visible changes the row's behaviour and its specs; it needs its own decision.
- `McpExecution`'s header and `BatchFilePermission`'s rows are clickable `div`s without keyboard access. Turning them
  into buttons is a behaviour change beyond this styling branch.
- The action bar still dims to 50% when its buttons are disabled; `.disabled-action-button` lives in `index.css`,
  which belongs to the controls branch.

## Tests run

- `vitest run src/components/chat src/components/common --maxWorkers=2`: 85 files, 1091 tests passed.
- `vitest run` on the specs outside those folders that import these components (`src/__tests__/FileChangesPanel`,
  `ContextWindowProgress`, `App`, `components/ui/__tests__/button.call-sites`, `spinner`,
  `context/__tests__/ExtensionStateContext.perf`): 6 files, 45 tests passed.
- The golden file was regenerated with `UPDATE_GOLDEN=1`; the diff only changes classes and the always-visible
  controls.
- `tsc --noEmit -p .`, `eslint --max-warnings=0` on the 57 touched files, `node scripts/check-webview-radius.mjs`:
  all clean.
