# Monospace Font on Running-Tool Containers - Implementation Plan

**Date:** 2026-05-22
**Branch:** `feat/ui-monospace-tool-containers` (stacked from `feat/ui-rectangular-corners`)
**Status:** Approved

## 1. Objective

Ensure running-tool containers use the existing fixed-width / console font,
without introducing any new font family.

## 2. Evidence (existing font verified)

Grepped `font-family`, `monospace`, `editor-font-family`, `font-mono`,
`--vscode-editor-font-family` across `webview-ui/src`:

- The fixed-width font already in use is the Tailwind `font-mono` utility
  (CSS `--font-mono` token) and the VS Code token `--vscode-editor-font-family`:
    - `common/ToolUseBlock.tsx` — `ToolUseBlockHeader` already has `font-mono`;
      the `ToolUseBlock` **container itself does NOT**.
    - `chat/CommandExecution.tsx:155,171` — running command containers already
      use `font-mono`.
    - `chat/McpExecution.tsx:223,314` — running MCP containers already use
      `font-mono`.
    - `common/CodeBlock.tsx:146` and `index.css:531-533` reference
      `var(--vscode-editor-font-family)` for code/terminal output.
- **Gap identified:** `ToolUseBlock` is the shared container used by tool
  blocks (readFile, batch file/list permission, code accordion, todo blocks
  via `UpdateTodoListToolBlock`). Its header is monospace but its body content
  is not, so the running-tool container is visually inconsistent.

## 3. Tech Strategy

- **Pattern:** Surgical, zero-new-font fix. Add the **existing** `font-mono`
  class (already on `ToolUseBlockHeader` in the same file) to the `ToolUseBlock`
  container so its entire content inherits the same fixed-width font.
- **Constraints:** Do NOT introduce a new font. Reuse `font-mono` exactly as
  already used. No theme-token redefinition (keeps blast radius minimal).

## 4. File Changes

| Action | File Path                                           | Brief Purpose                                   |
| :----- | :-------------------------------------------------- | :---------------------------------------------- |
| [MOD]  | `webview-ui/src/components/common/ToolUseBlock.tsx` | Add `font-mono` to the `ToolUseBlock` container |

## 5. Execution Sequence

1. Add `font-mono` to the `ToolUseBlock` container's class list.
2. Typecheck, lint, build.

## 6. Blast Radius

- Single class added to one shared container component.
- `CommandExecution` / `McpExecution` already monospace — untouched.
- Children that set their own font (code blocks) are unaffected; they keep
  their explicit font-family.
- No logic, no type, no API change. No tests assert on this font.

## 7. Verification Standards

- [ ] `pnpm check-types` clean.
- [ ] `pnpm lint` clean.
- [ ] `pnpm build` succeeds.
- [ ] Visual: tool-block container content renders in the fixed-width font.
