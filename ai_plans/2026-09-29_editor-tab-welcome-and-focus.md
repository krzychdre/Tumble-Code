# Editor tab: welcome screen without logo, no focus stealing

## Problem

1. Tumble opened in an editor tab ("open in editor") showed the sidebar welcome
   screen: the tumbling logo (RooHero) and the intro copy (RooTips). The logo
   uses fades painted in `sideBar-background`, so on the editor background it
   shows as a lighter box.
2. With Tumble open in an editor tab the user could not move focus anywhere
   else: every click in another editor group pulled the focus back into the
   Tumble input.

## Root cause of the focus stealing

`WebviewPanel.onDidChangeViewState` fires on every view state change, including
`active` flipping when the panel merely loses focus while staying on screen.
Two listeners reacted to it by posting `didBecomeVisible` whenever
`panel.visible` was true:

- `ClineProvider.resolveWebviewView` (tab branch),
- a duplicate listener in `openClineInNewTab` (`src/activate/registerCommands.ts`).

The webview answers `didBecomeVisible` with `textAreaRef.current.focus()`
(`useChatHostMessages.ts`), and focusing an element inside the webview makes
VS Code activate the panel again. Net effect: clicking elsewhere -> panel
inactive -> didBecomeVisible (twice) -> input focused -> panel active again.

## Fix

- `ClineProvider`: remember the last visibility and act only on a real
  hidden -> visible (or visible -> hidden) transition.
- `registerCommands.ts`: drop the duplicate listener; the provider already
  covers the tab panel.
- `ChatView`: render RooHero and RooTips only when `renderContext !== "editor"`.
  The sidebar keeps them. Recent tasks stay in both.

## Tests

- `ClineProvider.spec.ts` "editor tab view state": focus changes while visible
  send nothing; hidden -> visible sends exactly one `didBecomeVisible`.
- `ChatView.spec.tsx`: editor render context hides hero and tips.

## Follow-ups

The user flagged the editor tab as "looking different" in general; removing
the logo and copy is the first step. Further layout alignment (widths, padding
on a wide editor) is left for a later round once the user has seen this build.
