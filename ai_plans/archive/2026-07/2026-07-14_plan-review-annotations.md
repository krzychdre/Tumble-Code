# Plan Review with Annotations

**Date:** 2026-07-14
**Branch:** `feature/plan-review-annotations`
**Status:** v2 implemented (uncommitted on branch) — plan review moved from the chat overlay to a dedicated editor-area markdown panel (see "V2" section at the end); manual verification in the extension pending

## Problem

Tumble Code's Architect mode produces plans as markdown chat messages (and todo lists),
but there is no ergonomic way to _review_ a plan: the user reads it in the chat stream,
then has to hand-write a follow-up message describing which parts they want changed,
re-quoting sections manually. Claude Code's plan-mode annotation flow (rendered plan +
inline notes fed back to the model) is the UX target.

## Goal

1. Display a plan (any substantial assistant markdown message) in a full-panel rendered
   markdown view.
2. Let the user select text in the rendered plan and attach notes to the selection.
3. Compile the notes into a single follow-up message (quoted excerpt + note pairs,
   plus an optional overall comment) and send it back to the model through the
   existing mid-task message path.

## Non-goals (v1)

- No new tool, no prompt/protocol change, no extension-host code change.
  The compiled feedback is an ordinary plain-text user message — this is deliberate:
  it must survive weak models (GLM/Qwen/local Llamas), which means _zero_ new
  protocol for the model to understand. Blockquote + note is universally parseable.
- No persistence of draft annotations across webview reloads (drafts survive tab
  switches because ChatView stays mounted; they are lost on reload — acceptable,
  the _sent_ message is the durable artifact and is mode-switch-safe by construction).
- No annotation of plan `.md` files on disk (chat messages only). Future extension.

## Architecture (webview-ui only)

### Entry point — `ChatRow.tsx`

Add an "Annotate" hover button (lucide `MessageSquarePlus`) next to
`OpenMarkdownPreviewButton` on completed (non-partial) assistant messages:

- `say: "text"` (~line 1196 branch)
- `say: "completion_result"` (~line 1335 branch)
- `ask: "completion_result"` (~line 1679 branch)

Shown when the message text is non-trivial (≥ 100 chars) — plans are long; short
acks don't need review. Clicking calls a new `onAnnotate?(markdown: string)` prop
threaded from ChatView (same pattern as existing ChatRow callbacks).

### Review overlay — new `webview-ui/src/components/chat/PlanReviewOverlay.tsx`

Full-panel overlay rendered by ChatView (absolute inset-0 over the chat, like the
announcement/dialog patterns; ChatView stays mounted so drafts survive tab switches).

Layout:

- Header: title + close button.
- Main area (scrollable): the plan rendered with the existing `MarkdownBlock`.
- Selection flow: `mouseup` inside the markdown container → if
  `window.getSelection()` is non-collapsed and contained in the container, show a
  floating "Add note" chip near the selection → clicking opens a small note input
  anchored there → save produces `{ id, quote, note }` (quote =
  `selection.toString()`, trimmed/normalised whitespace).
- Notes panel (bottom sheet on narrow webview width, side column when wide):
  list of annotations, each showing truncated quote + note, edit and delete.
- Best-effort inline highlight of annotated quotes using the CSS Custom Highlight
  API (`CSS.highlights`, available in the Chromium webview): re-locate each quote
  by text search over the container's text nodes; silently skip quotes that no
  longer match. Non-destructive (no DOM mutation), purely cosmetic — the _quote
  string_ is the real anchor, not the range.
- Footer: optional "Overall comments" textarea + `Send notes` (disabled when there
  are no notes and no overall comment) + `Cancel`.

### Compiled message format (weak-model-safe, plain text)

```text
I reviewed the plan and added notes on specific parts. Each quoted block is the part
of the plan the note refers to.

> {quote 1}

Note: {note 1}

> {quote 2}

Note: {note 2}

Overall: {overall comment, if any}

Please address these notes and update the plan.
```

Multi-line quotes get a `>` prefix (plus a space) on every line. No XML, no JSON, no tool call —
readable by any model and by the human in the chat transcript.

### Send path — `ChatView.tsx`

- New state `planReviewMarkdown: string | null`; `onAnnotate` sets it, overlay
  renders when non-null.
- `onSubmit(compiledText)` → existing `handleSendMessage(compiledText, [])`
  (which already routes to `newTask` / `askResponse: messageResponse` correctly),
  then closes the overlay and clears drafts for that message.

### i18n

New `chat.json` keys under `"planReview"`: button tooltip, overlay title, add note,
note placeholder, overall placeholder, send, cancel, empty state, compiled-message
scaffold strings. English is source; replicate to all other locales.

Note: the compiled-message scaffold sent to the model is intentionally **always
English** (models are steered in English; localized instructions hurt weak models).
Only UI chrome is localized.

## Files touched

| File                                                                  | Change                                                                             |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `webview-ui/src/components/chat/PlanReviewOverlay.tsx`                | new — overlay component                                                            |
| `webview-ui/src/components/chat/planReviewMessage.ts`                 | new — pure `compilePlanReviewMessage(annotations, overall)` helper (unit-testable) |
| `webview-ui/src/components/chat/ChatRow.tsx`                          | annotate button on assistant text/completion messages; `onAnnotate` prop           |
| `webview-ui/src/components/chat/ChatView.tsx`                         | overlay state + render + submit wiring                                             |
| `webview-ui/src/i18n/locales/*/chat.json`                             | new `planReview` keys                                                              |
| `webview-ui/src/components/chat/__tests__/PlanReviewOverlay.spec.tsx` | new tests                                                                          |
| `webview-ui/src/components/chat/__tests__/planReviewMessage.spec.ts`  | new tests                                                                          |

## Risks / notes

- Text selection across React-rendered markdown is DOM-fragile; we anchor on the
  quoted _string_, never on DOM ranges, so re-render or partial highlight failure
  degrades gracefully (note still valid, still sent).
- `window.getSelection()` inside shadow-DOM-free webview is fine; jsdom in vitest
  lacks Custom Highlight API — guard with `typeof CSS !== "undefined" && "highlights" in CSS`.
- ChatRow is virtualized (Virtuoso); the button only reads `message.text`, no
  measurement impact.

## Verification

- `cd webview-ui && npx vitest run` (new specs + existing ChatRow/ChatView specs green)
- `pnpm check-types` (or workspace equivalent) clean
- Manual: architect-mode plan → hover → Annotate → select two sections, add notes,
  overall comment → Send → chat shows the compiled user message → model receives it.

---

## V2 — annotate the plan _file_ in an editor-area markdown display

### Why the rework

User feedback after v1: Architect mode writes the plan to a markdown **file**
(`plans/*.md` — and that is the desired workflow); the chat bubble is just
"I wrote the plan", so a hover button on chat messages is the wrong entry point,
and the narrow sidebar is the wrong reading surface. The annotation UI must sit
on a big rendered view of the plan file, Claude-Code-style.

### Architecture

**New extension-owned WebviewPanel** (`src/core/webview/PlanReviewPanel.ts`) in
the editor area, reusing the _same_ webview-ui bundle:

- HTML mirrors `ClineProvider.getHtmlContent()` (same asset URIs, CSP, nonce,
  base-URI globals) plus one extra global: `window.PLAN_REVIEW_MODE = true`.
- `webview-ui/src/index.tsx` branches on that global: renders `PlanReviewApp`
  instead of `App`. No vite/build changes (single bundle, shared CSS).
- `PlanReviewApp` mounts `ExtensionStateContextProvider` (defaults are fine,
  no hydration) + `TranslationProvider` + `TooltipProvider`, posts
  `planReviewReady`, receives `planReviewInit { filePath?, markdown, language }`,
  sets i18n language directly, and renders the annotation surface (the v1
  overlay refactored into a non-overlay `PlanReviewSurface` component).
- File mode: panel watches the file (`FileSystemWatcher`) and pushes
  `planReviewUpdate` on change — Architect iterating on the plan live-updates
  the view; annotations are quote-anchored so they survive (stale quotes just
  lose their cosmetic highlight, the note still sends).
- Content mode (no file): panel can be opened with raw markdown (used by the
  chat-message button), no watcher.

**Sending notes back** no longer goes through the chat webview:
`planReviewSubmit { text }` → panel host routes to the visible/sidebar
`ClineProvider` → `getCurrentTask()?.submitUserMessage(text)` (resolves any
pending followup ask, same as a typed chat message) or `createTask(text)` when
no task is active, then focuses the sidebar. Still a plain-English text message
— the weak-model and mode-switch properties of v1 are unchanged. When a file
path is known, the compiled header names it:
"I reviewed the plan in `plans/plan.md` …".

### Entry points

1. **Chat tool rows**: "Review plan" button on `.md` file-edit rows
   (`editedExistingFile` / `newFileCreated` / `appliedDiff` / `edit` variants) →
   `openPlanReview { path }` → panel opens in file mode.
2. **Command** `tumble-code.reviewPlanFile` (Command Palette + editor-title menu
   for markdown files) → opens the active/given `.md` in the panel. Works for
   any markdown file, not just plans.
3. **Chat message hover** (kept from v1, repurposed): now opens the same editor
   panel in content mode instead of the sidebar overlay. The sidebar overlay
   itself is removed.

### V2 file changes

| File                                                                                                          | Change                                                                                          |
| ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `src/core/webview/PlanReviewPanel.ts`                                                                         | new — panel host: HTML, init/update/watch, submit routing                                       |
| `src/core/webview/webviewMessageHandler.ts`                                                                   | new `openPlanReview` case                                                                       |
| `src/activate/registerCommands.ts`, `src/package.json`, `packages/types` (CommandId), `src/package.nls*.json` | `reviewPlanFile` command + markdown editor-title menu                                           |
| shared message types (`WebviewMessage` / `ExtensionMessage`)                                                  | `openPlanReview`, `planReviewReady/Init/Update/Submit/Close`                                    |
| `webview-ui/src/index.tsx`                                                                                    | branch on `window.PLAN_REVIEW_MODE`                                                             |
| `webview-ui/src/components/plan-review/PlanReviewApp.tsx`                                                     | new — standalone app shell                                                                      |
| `webview-ui/src/components/chat/PlanReviewOverlay.tsx`                                                        | → refactored into `PlanReviewSurface` (no overlay chrome)                                       |
| `webview-ui/src/components/chat/ChatView.tsx`                                                                 | remove v1 overlay wiring                                                                        |
| `webview-ui/src/components/chat/ChatRow.tsx` / `AnnotateButton.tsx`                                           | hover button posts `openPlanReview` (content mode); new "Review plan" button on `.md` edit rows |
| locales (webview `chat.json`, `src/package.nls*.json`)                                                        | new keys                                                                                        |

### V2 verification

- webview-ui + src vitest suites green, `tsc --noEmit` clean in both.
- Manual: architect writes `plans/plan.md` → "Review plan" on the tool row →
  panel renders plan → annotate → Send → notes arrive in the running task;
  edit the file on disk → panel live-updates.
