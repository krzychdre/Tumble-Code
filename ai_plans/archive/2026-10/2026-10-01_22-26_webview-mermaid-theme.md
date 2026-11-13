# Mermaid diagrams follow the VS Code theme (round 2, A3)

Status: done on `fix/webview-mermaid-theme`

## Touched files

- `webview-ui/src/components/common/mermaidTheme.ts` (new): theme detection and the Mermaid configuration as pure functions
- `webview-ui/src/components/common/MermaidBlock.tsx`: uses them when rendering and when exporting the PNG
- `webview-ui/src/components/common/__tests__/mermaidTheme.spec.ts` (new)
- `webview-ui/src/components/common/__tests__/MermaidBlock.spec.tsx`
- `.changeset/mermaid-follows-vscode-theme.md`

## Problem

`MermaidBlock.tsx` configured Mermaid once with `theme: "dark"` (line 55) and a hard-coded dark palette
(`MERMAID_THEME`, lines 13-41, background `#1e1e1e` at line 14, white text everywhere). The PNG export filled the
canvas with the same `#1e1e1e` (line 308). In a light VS Code theme every diagram was a black box with white text
inside an otherwise light chat.

## Fix

- `themeKindFromBodyClass` reads the class VS Code puts on the webview body (`vscode-light`, `vscode-dark`,
  `vscode-high-contrast`, `vscode-high-contrast-light`). The same classes are what `CodeBlock.tsx:87` and
  `DiffView.tsx:43` test; this one also tells the two high contrast kinds apart.
- `buildMermaidConfig(kind, colors)` returns the whole Mermaid configuration: Mermaid's `dark` theme with the old
  palette for dark kinds, Mermaid's `default` theme with a new light palette for light kinds. The diagram background
  is the editor background (`--vscode-editor-background`); high contrast kinds outline nodes and lines with
  `--vscode-contrastBorder` (falling back to the editor foreground). The classic dagre look and Mermaid 11 node sizes
  are unchanged.
- Only plain hex values from the theme are used: Mermaid derives shades from its theme variables with khroma, so a
  `var(...)` reference or an unusual value would break it; anything else falls back to the palette.
- `loadMermaid` still imports Mermaid once, but now calls `mermaid.initialize` again when the theme (kind plus the
  colours read) differs from the one it was configured for, so every new render uses the active theme.
- The PNG export fills the canvas with `diagramBackground(...)`, the same editor background.

## Tests

- `mermaidTheme.spec.ts`: theme kind per body class, dark/light theme and palette, editor background used and
  invalid values ignored, high contrast outlines, the classic look in every kind, PNG background.
- `MermaidBlock.spec.tsx`: the existing "configured once" check still holds within one theme; a new test switches the
  body to `vscode-light` and checks that the next diagram reconfigures Mermaid with the `default` theme (real Mermaid
  `initialize` runs with the new configuration).

## Notes / caveats

- The webview has no theme-change signal today (`CodeBlock` also picks its Shiki theme only when it highlights), so a
  diagram already on screen keeps its colours until it renders again (new message, task reopened, webview reload).
  Adding a body-class `MutationObserver` for all content blocks would be a separate change.
- The light palette values were chosen by hand to mirror the dark one (light grey nodes, dark text and lines); not
  checked visually in a running VS Code from this worktree (no build allowed here).
