# CLI UI Redesign — Claude Code Look & Feel

**Date:** 2026-08-05
**Branch:** `feat/14-cli-claude-style-ui` (stacked on `feat/13-cli-duplicate-greeting`)
**Scope:** `apps/cli/src/ui/**` only. Agent plumbing (ExtensionHost, store message flow, ask dispatcher, JSON/non-interactive modes) unchanged.
**Reference:** leaked Claude Code source at `/home/krzych/Projekty/QUB-IT/claude-code-src-leaked` (read with `grep -v sourceMappingURL` — files end in megabyte base64 sourcemaps).

## 1. Problem

The current TUI is a boxy fullscreen app: pinned ASCII-art header, fixed-height `ScrollArea` with manual focus/scroll handling (breaks native terminal scrollback), labeled blocks ("You said:" / "Tumble said:"), bare `y/n` approvals, dash-rule chrome everywhere. Claude Code's TUI is a _print-and-forget transcript_: finalized output flows into native scrollback via ink `<Static>`, only a small dynamic tail (in-flight message, spinner, dialogs, input) re-renders. Visual grammar is symbols + indentation, not boxes and labels.

## 2. Target visual grammar (distilled from leaked source)

```
✻ Welcome to Tumble Code v0.1.17                ← WelcomeBanner (first Static item)

  cwd: ~/Projekty/QUB-IT/Roo-Code                 dim, indent 2
  openai · gpt-5 [high] · mode: code              dim, indent 2

❯ fix the failing test in foo.ts                ← user turn: bg band + pointer

● I'll look at the test file first.             ← assistant: bullet + markdown

● Read(src/foo.test.ts)                         ← tool: status bullet + Bold name(args)
  ⎿  Read 42 lines                              ← result connector, dim

∴ Thinking…                                     ← thinking collapsed, dim italic

✳ Rummaging… (esc to interrupt · 12s · ↓ 1.2k tokens)   ← spinner while loading

────────────────────────────────────────────────  ← promptBorder rule (Box top border)
 ❯ type your message…                             ← pointer + input
────────────────────────────────────────────────  ← bottom border
  ? for shortcuts                  code · gpt-5 · 38%   ← footer: hints left, status right
```

Element rules (from leaked components, file references for implementers):

| Element        | Leaked ref                                         | Exact rendering                                                                                                                                                                                                                                             |
| -------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Assistant text | `components/messages/AssistantTextMessage.tsx`     | `<Box>` row: bullet column `<Box minWidth={2}><Text color={theme.text}>{figures.bullet}</Text></Box>` + `<Box flexDirection="column" flexGrow={1}><Markdown>…</Markdown></Box>`; `marginTop={1}` between turns                                              |
| User turn      | `components/messages/UserPromptMessage.tsx`        | Box `backgroundColor={theme.userMessageBg}` `paddingRight={1}`, content `<Text color={theme.subtle}>{figures.pointer} </Text><Text color={theme.text}>{text}</Text>`; >10k chars → head 5k + `… [+N chars] …` + tail 5k                                     |
| Thinking       | `AssistantThinkingMessage.tsx`                     | collapsed: `<Text dimColor italic>∴ Thinking…</Text>`; expanded (only when `--verbose`/debug): `∴ Thinking…` + `<Box paddingLeft={2}>` dim markdown                                                                                                         |
| Tool call      | `AssistantToolUseMessage.tsx`, `ToolUseLoader.tsx` | bullet column minWidth 2; bullet color: running → default+blink (dim toggle ~600 ms), error → `theme.error`, done → `theme.success`; then `<Text bold>Name</Text><Text>(primary arg)</Text>` `wrap="truncate-end"`                                          |
| Tool result    | `components/MessageResponse.tsx`                   | `<Text dimColor>{"  "}⎿{"  "}</Text>` + flexGrow content Box; dim text; max 5 lines then `… +N lines` dim                                                                                                                                                   |
| Spinner        | `components/Spinner.tsx`                           | frames `['·','✢','✳','∗','✻','✽']` + reversed (ping-pong), ~120 ms, brand color; shimmer verb + `…`; dim suffix `(esc to interrupt · {s}s · ↓ {tokens} tokens)`                                                                                            |
| Input          | `PromptInput/PromptInput.tsx`                      | `<Box borderStyle="round" borderLeft={false} borderRight={false} borderColor={theme.promptBorder} paddingX={1}>` → renders plain full-width rules, no corners; prompt char `<Text color={theme.promptBorder}>{figures.pointer} </Text>` (dim while loading) |
| Footer         | `PromptInputFooterLeftSide.tsx`                    | one dim line below input box: left hints (priority: toast > exit-hint > context hint), right `mode · model · ctx%`                                                                                                                                          |
| Select rows    | `design-system/ListItem.tsx`                       | focused: `<Text color={theme.permission}>{figures.pointer} </Text>` + label; unfocused: two-space indent; dim description on same/next line; number prefix `1. `                                                                                            |
| Dialogs        | `permissions/PermissionDialog.tsx`                 | full `borderStyle="round"` box, `borderColor={theme.permission}`, title bold, body, numbered SelectList                                                                                                                                                     |
| Welcome        | `LogoV2/WelcomeV2.tsx`                             | one-liner: `<Text color={theme.brand}>✻ Welcome to Tumble Code </Text><Text dimColor>v{version}</Text>` + dim info lines (no giant ASCII mascot)                                                                                                            |

## 3. Architecture: `<Static>` transcript split

Replace `ScrollArea` (alt-viewport, manual scroll) with ink `<Static>`:

- `<Static items={staticMessages}>` — finalized messages, printed once into native scrollback.
- Dynamic tail (normal ink tree below Static): in-flight messages + Spinner + dialogs/pickers + InputArea + footer.

**Promotion rule** — new pure module `src/ui/transcript.ts`:

```ts
export function getStaticCount(messages: TUIMessage[], isLoading: boolean, hasPendingAsk: boolean): number {
	let count = messages.length
	// trailing message may still receive in-place updates (finalization, ask answer)
	if ((isLoading || hasPendingAsk) && count > 0) count -= 1
	// anything from the first streaming message onward stays dynamic
	const firstPartial = messages.findIndex((m) => m.partial === true)
	if (firstPartial !== -1) count = Math.min(count, firstPartial)
	return count
}
```

Store facts this relies on (verified in `src/ui/store.ts`):

- `addMessage` appends new ids; existing ids get in-place updates (partial → debounced batch; final → immediate). Practically only the trailing message streams.
- `resetForTaskSwitch` sets `messages: []` — the array **can shrink**.

App-side guards (in `App.tsx`):

- Monotonicity: `staticCount = Math.max(prevStaticCount, getStaticCount(...))` while the array is an append-extension (`messages[i].id === prevIds[i]` for promoted prefix).
- Reset detection: if the promoted prefix no longer matches (task switch cleared the array), bump a `staticKey` state to remount `<Static>` fresh (old scrollback stays above — correct) and reset `prevStaticCount`.
- `<Static>` items keyed by `message.id`.
- WelcomeBanner is a synthetic first Static item (id `"__welcome__"`), so it prints once and scrolls away naturally.

Implementation note: WP-D must grep `updateMessage`/`addMessage` call sites in `useMessageHandlers.ts` and confirm no path updates a message that already has a _newer non-partial successor_. If one exists, extend the hold-back for that role. Accepted tradeoff (same as Claude Code): a late identical re-send to a promoted message is silently ignored visually.

Rendering keeps `render(…, { exitOnCtrlC: false })` in `run.ts` — unchanged. Non-TTY print mode unchanged.

## 4. Theme rewrite — `src/ui/theme.ts`

Semantic keys (Claude Code naming), values from the existing Hardcore palette so Tumble keeps its identity (brand stays orange, not Claude rust):

```ts
export const theme = {
	brand: "#FD971F", // orange — welcome ✻, spinner verb/frames
	text: "#F8F8F2",
	secondaryText: "#A3BABF", // tool results, descriptions
	subtle: "#5E7175", // ❯ in user rows, ⎿ connectors
	inactive: "#505354", // placeholder, disabled
	permission: "#9E6FFE", // dialog borders, select pointer/focus
	promptBorder: "#5E7175", // input rules + prompt ❯
	userMessageBg: "#383a3e", // user-turn background band
	bashBorder: "#F92672", // reserved: `!` bash-style accents
	success: "#A6E22E", // resolved tool bullets, success toasts
	error: "#F92672",
	warning: "#E6DB74",
	suggestion: "#66D9EF", // autocomplete matches, links
	planMode: "#66D9EF",
	diffAdded: "#225C2B", // bg for added lines (from Claude dark)
	diffRemoved: "#7A2936",
	diffAddedDimmed: "#47584A",
	diffRemovedDimmed: "#69474D",
	code: "#E6DB74", // inline code spans
} as const
```

WP-A keeps the old flat exports (`titleColor`, `dimText`, `borderColor`, …) as deprecated aliases mapped onto the new keys so every intermediate commit compiles; WP-D deletes the aliases after the last consumer is rewritten.

## 5. New shared modules

### `src/ui/figures.ts` (WP-A)

```ts
const isMac = process.platform === "darwin"
export const figures = {
	bullet: isMac ? "⏺" : "●", // message/tool bullets
	elbow: "⎿", // result connector
	pointer: "❯", // prompt, select cursor
	welcome: "✻",
	therefore: "∴", // thinking
	checkboxOn: "☒",
	checkboxOff: "☐",
	arrowDown: "↓",
	arrowUp: "↑",
	ellipsis: "…",
	blockquote: "▎",
	dot: "·",
} as const
export const SPINNER_FRAMES = ["·", "✢", "✳", "∗", "✻", "✽", "∗", "✳", "✢"]
```

### `src/ui/spinnerVerbs.ts` (WP-A)

~40 gerunds in Claude's whimsical register incl. brand pun (`"Tumbling"`, `"Pondering"`, `"Rummaging"`, `"Brewing"`, `"Combobulating"`, `"Percolating"`, …). `pickVerb(seed: number)` — deterministic pick so one verb is stable per turn (seed = loading-start timestamp).

### `src/ui/components/Markdown.tsx` (WP-A)

Minimal line-based renderer, **no new deps**, must never throw on malformed input (fall back to raw text). Subset:

- `**bold**`, `*italic*`/`_italic_`, `` `code` `` (color `theme.code`), `~~strike~~`
- headings `#..####` → bold (h1 also underline); list items `-`/`*`/`1.` → ` •` / ` 1.` with hanging indent; blockquote `> ` → `▎ ` dim
- fenced code blocks → 2-space-indented block, `theme.secondaryText`, dim language tag line
- links `[t](u)` → `t` in `theme.suggestion` + ` (u)` dim; bare hr `---` → dim `───`
- tables/unknown → pass through verbatim
  API: `<Markdown dimColor?>{text}</Markdown>` returning `<Box flexDirection="column">` of `<Text>` lines.

### Primitives `src/ui/components/primitives/` (WP-A)

- `Bullet.tsx` — `{ status: "running" | "success" | "error" | "plain", dim? }`; renders minWidth-2 column; `running` blinks via 600 ms interval toggling `dimColor` (cleared on unmount).
- `ResultRow.tsx` — `{ children, maxLines = 5 }`; renders `  ⎿  ` connector (subtle) + dim content; truncates with `… +N lines` dim tail. String children pre-sanitized (tabs→4sp, strip `\r`) — move `sanitizeContent` here from ChatHistoryItem.
- `SelectList.tsx` — `{ items: { label, description?, value }[], onSelect, onCancel?, isActive, initialIndex?, numbered? (default true), maxVisible = 8 }`; ↑/↓ wrap, `1`–`9` jump-select, Enter confirm, Esc → onCancel; windowing with ↑/↓ dim overflow hints (port windowing math from existing `PickerSelect.tsx`); focused row `❯ ` in `theme.permission`, others two-space indent; descriptions dim.
- `Spinner.tsx` — `{ startTime, tokensOut?, verb }`; 120 ms ping-pong frames in brand; elapsed = `Math.floor((Date.now()-startTime)/1000)s`; tokens shown when > 0 as `↓ {formatNumber} tokens`; static dim suffix `(esc to interrupt · … )`.

## 6. Message layer (WP-B)

`src/ui/components/messages/`: `UserMessage.tsx`, `AssistantMessage.tsx`, `ThinkingMessage.tsx`, `SystemMessage.tsx` per §2 table. `ChatHistoryItem.tsx` becomes a thin dispatcher: role → component; `role === "tool"` → todo special-case (unchanged logic) → `toolData` renderer → `GenericTool` fallback. Delete the old inline `ToolDisplay`/category-color system.

`src/ui/components/tools/` rewrite to the `● Name(arg)` + `⎿ result` grammar using `Bullet`/`ResultRow`. New `tools/toolNames.ts` display-name map (keep `getToolCategory` in `types.ts` for status semantics):

| internal                     | display            | primary arg                                                            | result line                                                                         |
| ---------------------------- | ------------------ | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| readFile/read_file           | `Read`             | path                                                                   | `Read N lines` or excerpt                                                           |
| listFiles\*                  | `List`             | path                                                                   | `N entries`                                                                         |
| searchFiles/codebaseSearch   | `Search`           | query/regex                                                            | `N matches` + top paths                                                             |
| executeCommand               | `Bash`             | command (truncate-end)                                                 | output lines (max 5)                                                                |
| writeToFile/newFileCreated   | `Write`            | path                                                                   | `Wrote N lines`                                                                     |
| applyDiff/editedExistingFile | `Update`           | path                                                                   | `+A -R` summary; diff lines colored `theme.diffAdded/diffRemoved` bg when available |
| switchMode                   | `Mode`             | target mode                                                            | reason                                                                              |
| newTask                      | `Task`             | mode                                                                   | first line of message                                                               |
| updateTodoList               | `Update Todos`     | —                                                                      | ⎿ checklist `☒ done` (dim+strikethrough) / `☐ pending`, current bold                |
| attempt_completion           | —                  | rendered as `●` assistant message, success-green bullet, markdown body |
| fallback                     | humanized toolName | —                                                                      | raw content via ResultRow                                                           |

`TodoDisplay.tsx` restyled to the checklist above (keep progress line + ctrl+t viewer contract and `TodoChangeDisplay` diff coloring: added=success, removed=error dim strikethrough).
Tool status source: `hasPendingToolCalls`/`partial` → running; `toolData`/`originalType` error variants → error; else success. WP-B verifies exact signal in `useMessageHandlers.ts` and documents it in the component.

## 7. Input & dialogs (WP-C)

`src/ui/components/input/InputArea.tsx` — the bordered container from §2 wrapping prompt char + existing `AutocompleteInput` (which loses its own `"› "` prompt and `HorizontalLine`s; its trigger/suggestion logic is untouched). Prompt char: `❯ ` promptBorder, dim while loading; followup-answer mode keeps its distinct state via `theme.permission` colored `❯`.
`InputFooter.tsx` — single dim line: left = toast (colored by kind) > `Press ctrl+c again to exit` > `? for shortcuts`; right = `{mode} · {model} · {ctx%}` (+ ` · $cost` when > 0), `ctx%` in warning color ≥ 80 %. Reuses `formatNumber`/`formatCost` from `MetricsDisplay.tsx`, which shrinks to these helpers + the condensed variant (delete `ProgressBar`).
`src/ui/components/dialogs/ApprovalDialog.tsx` — permission-bordered box: bold title from ask type (`Bash command` / `Write file` / `MCP tool` …), body = relevant fields parsed from `PendingAsk.content` JSON (command / path / server+tool), question `Do you want to proceed?`, SelectList `1. Yes` / `2. No (esc)`. Keyboard: full SelectList set **plus legacy `y`/`n` accelerators** (existing muscle memory).
`dialogs/FollowupDialog.tsx` — same box style: question as title, `PendingAsk.suggestions` as numbered options + final `Type my own answer…` (existing `__CUSTOM__` flow → reveals InputArea); countdown line dim at box bottom `Auto-selecting "{label}" in {n}s — press any key to cancel` driven by existing `useFollowupCountdown` semantics (any navigation cancels).
`PickerSelect.tsx` restyle: no border box — rows under the input rule, `❯` focused row (suggestion color), dim descriptions, `maxVisible 8`, dim `↓ N more` hint. `OnboardingScreen.tsx` swaps `@inkjs/ui` Select for `SelectList`, welcome line per §2.
`ToastDisplay.tsx` → single dim line, colored by kind (success/error/warning), no box.

## 8. Shell integration (WP-D)

`App.tsx` rewrite (structure only — all handler logic, hooks and ask flows are kept):

```tsx
<>
	<Static key={staticKey} items={[welcomeItem, ...staticMessages]}>{renderStaticItem}</Static>
	<Box flexDirection="column">
		{dynamicMessages.map(m => <ChatHistoryItem …/>)}
		{isLoading && !pendingAsk && <Spinner …/>}
		{showTodos && <TodoDisplay …/>}                 {/* ctrl+t */}
		{approvalAsk && <ApprovalDialog …/>}
		{followupAsk && <FollowupDialog …/>}
		{picker && <PickerDropdown …/>}
		<InputArea …/>                                   {/* hidden only when a dialog owns input */}
		<InputFooter …/>
	</Box>
</>
```

- `WelcomeBanner.tsx` (new) replaces `Header.tsx`: per §2; includes `Logged in as {user.name}` and `(YOLO)` marker when non-interactive. `ASCII_ROO` stays in `constants.ts` (unused by TUI).
- Transcript split per §3 (`transcript.ts` + unit tests: streaming, ask hold-back, task-switch reset, monotonicity).
- Remove from `useGlobalInput`: scroll/focus keybindings; keep ctrl+c double-press exit, esc abort, ctrl+t todos.
- **Delete:** `ScrollArea.tsx`, `ScrollIndicator.tsx`, `Header.tsx`, `LoadingText.tsx`, `HorizontalLine.tsx`, `ProgressBar.tsx`, `hooks/useFocusManagement.ts`, `Icon.tsx` (+ their tests); remove theme legacy aliases; fix every remaining import (`grep -rn "ScrollArea\|HorizontalLine\|LoadingText\|useFocusManagement\|Icon\b\|theme\.\(titleColor\|dimText\|borderColor\|rooHeader\|userHeader\|toolHeader\)"`).
- Spinner verb: `pickVerb(loadingStartTime)`; tokens from `tokenUsage.totalTokensOut` (store field name to verify).

## 9. Work packages (Sonnet subagents, `model: "sonnet"`)

Disjoint file ownership; each WP ends green (`pnpm check-types && pnpm lint && pnpm test` in `apps/cli`) and **commits immediately** (user rebuilds mid-session).

| WP  | Agent | Depends | Owns                                                                                                                                                                                                | Commit                                                                   |
| --- | ----- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| A   | 1     | —       | `theme.ts` (semantic + aliases), `figures.ts`, `spinnerVerbs.ts`, `Markdown.tsx`, `primitives/*`, `Spinner.tsx` + tests                                                                             | `feat(cli): add Claude-style UI foundation (theme, figures, primitives)` |
| B   | 2     | A       | `messages/*`, `ChatHistoryItem.tsx`, `tools/*`, `TodoDisplay.tsx`, `TodoChangeDisplay.tsx` + tests                                                                                                  | `feat(cli): Claude-style message and tool rendering`                     |
| C   | 3     | A (∥ B) | `input/*`, `dialogs/*`, `AutocompleteInput.tsx`, `PickerSelect.tsx`, `OnboardingScreen.tsx`, `MetricsDisplay.tsx`, `ToastDisplay.tsx` + tests — **not wired into App yet; must compile standalone** | `feat(cli): Claude-style input area and dialogs`                         |
| D   | 4     | B + C   | `App.tsx`, `WelcomeBanner.tsx`, `transcript.ts`, `useGlobalInput.ts`, deletions, alias removal, `useMessageHandlers` audit + tests                                                                  | `feat(cli): static-scrollback shell with welcome banner`                 |
| E   | 5     | D       | drop `@inkjs/ui` (verify zero imports) + lockfile, full build, PTY smoke render, `apps/cli/README.md`                                                                                               | `chore(cli): drop @inkjs/ui and polish Claude-style UI`                  |

Shared agent instructions: repo style = tabs, double quotes, no semicolons (Prettier enforces — run `pnpm format`); ink 6.6 + React 19 + zustand 5 already installed, **no new dependencies**; tests with vitest + ink-testing-library (`lastFrame()` assertions); don't touch files outside your ownership column; read this plan §§2–8 for exact specs.

## 10. Verification (WP-E + me)

1. `pnpm --filter @tumble-code/cli check-types && pnpm --filter @tumble-code/cli lint && pnpm --filter @tumble-code/cli test && pnpm --filter @tumble-code/cli build`
2. PTY smoke (TUI needs TTY): `script -qfec "timeout 5 node apps/cli/dist/index.js" /dev/null` → welcome banner + input frame render, no crash; `--help` still prints.
3. Manual visual pass by user (rebuilds installed binary).

## 11. Risks

- **Late update to a promoted message** → stale scrollback line. Mitigated by hold-back rule + WP-D audit; residual risk accepted (identical tradeoff in Claude Code).
- **Task switch clears messages** → `staticKey` remount; old scrollback intentionally remains above.
- **Dynamic tail taller than terminal** (huge streaming message) → ink redraw artifacts; mitigated by eager promotion + thinking collapse; not fully solvable without alt-screen (explicitly out of scope).
- **bg color support** (`userMessageBg`) degrades gracefully in 16-color terminals (chalk downsamples).
- **Windows glyphs**: ⎿/∴/❯ render fine in Windows Terminal; legacy conhost out of scope.

## 12. Out of scope

Light/daltonized themes + runtime theme switching, full markdown (tables), transcript-expand keybindings (ctrl+o), vim mode, bash `!` mode, alt-screen virtual list, terminal-title updates, extension/webview UI.
