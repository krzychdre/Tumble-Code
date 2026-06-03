# Make Tool / Command Containers Use the Console Font Reliably — Implementation Plan

**Date:** 2026-05-22
**Branch:** `fix/ui-api-request-finished-dimming` (continuing the iterative UI work)
**Status:** Approved

## 1. Objective

The command-execution container (e.g. a `ruff check` run) still does not
render in a console / fixed-width font. Make every running-tool container use
the VS Code editor (console) font reliably — the font already used elsewhere
for code, with no new font introduced.

## 2. Evidence (traced, not assumed)

The "console font" was applied **three inconsistent ways**:

- `CodeBlock.tsx` `StyledPre` (renders the command in `CommandExecution`):
  `font-family: var(--vscode-editor-font-family);` — **no fallback**. If VS Code
  does not supply `--vscode-editor-font-family`, this declaration is invalid and
  the text inherits the proportional UI font — the observed bug.
- `TerminalOutput.tsx` (command output): `var(--vscode-editor-font-family,
'Cascadia Code', …, monospace)` — has a fallback chain.
- `index.css` `.diff-view`: `var(--vscode-editor-font-family), ui-monospace, …,
monospace` — has a fallback chain.
- Feature 4 (`49d512408`) added Tailwind's generic `font-mono` to
  `ToolUseBlock` — `--font-mono` was the Tailwind default (generic
  `ui-monospace …`), NOT the VS Code editor font.

So `CommandExecution`'s command was the only path with no monospace fallback,
and `font-mono` was a _different_ font from the editor font used by code
blocks — contradicting "find which one is used, don't introduce another".

## 3. Tech Strategy

Make `--font-mono` the single source of truth for the console font:

- Define `--font-mono` in the `index.css` `@theme` block as
  `var(--vscode-editor-font-family), <monospace fallback chain>`. This overrides
  Tailwind's generic default, so the `font-mono` utility (already on
  `ToolUseBlock`, `ToolUseBlockHeader`, `CommandExecution` header bits, mention
  highlights) now resolves to the VS Code editor font — with a guaranteed
  fixed-width fallback.
- Point `CodeBlock`'s `StyledPre` and `TerminalOutput` at `var(--font-mono)`
  instead of bespoke `--vscode-editor-font-family` strings.

Result: the command, its output, and every tool container resolve to the one
console font; and because the chain always terminates in `monospace`, the text
is fixed-width whether or not VS Code supplies `--vscode-editor-font-family`.
No new font is introduced — it is the editor font the app already uses.

## 4. File Changes

| Action | File Path                                           | Brief Purpose                                           |
| :----- | :-------------------------------------------------- | :------------------------------------------------------ |
| [MOD]  | `webview-ui/src/index.css`                          | Define `--font-mono` = editor font + monospace fallback |
| [MOD]  | `webview-ui/src/components/common/CodeBlock.tsx`    | `StyledPre` font-family → `var(--font-mono)`            |
| [MOD]  | `webview-ui/src/components/chat/TerminalOutput.tsx` | Output font-family → `var(--font-mono)`                 |

## 5. Blast Radius

`--font-mono` is also used by `.mention-context-highlight` and any `font-mono`
utility — all now render in the editor font (intended consistency). Behaviour
only changes where `--vscode-editor-font-family` was previously unresolved: such
text now correctly falls back to a fixed-width font instead of the UI font.

## 6. Verification Standards

- [x] Existing specs pass: TerminalOutput / CommandExecution / CodeBlock (39).
- [x] `pnpm check-types` clean in webview-ui.
- [x] `pnpm lint` clean in webview-ui.
- [x] `pnpm build` succeeds; compiled CSS confirmed to contain
      `--font-mono: var(--vscode-editor-font-family), …, monospace`.
- [ ] Visual: the `ruff check` command and its output render in the fixed-width
      editor font.
