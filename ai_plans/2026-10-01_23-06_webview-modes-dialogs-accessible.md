# Modes dialogs and the zoom modal use Dialog

Status: done (branch `fix/webview-modes-dialogs-accessible`)

## Touched files

- `webview-ui/src/components/modes/CreateModeDialog.tsx`
- `webview-ui/src/components/modes/ImportModeDialog.tsx`
- `webview-ui/src/components/modes/SystemPromptSection.tsx`
- `webview-ui/src/components/modes/sidePanelDialog.ts` (new: the right-hand panel classes shared by two dialogs)
- `webview-ui/src/components/common/ZoomableModal.tsx`, `ImageViewer.tsx`, `MermaidButton.tsx`
- `webview-ui/src/components/common/Modal.tsx` (deleted)
- `webview-ui/src/components/ui/dialog.tsx` (`showCloseButton` prop, same name as upstream shadcn)
- specs: `modes/__tests__/ModesView.create-mode.spec.tsx`, `ModesView.sections.spec.tsx`,
  `common/__tests__/MermaidButton.spec.tsx`, `ImageViewer.spec.tsx`

## Problem

Four overlays were hand-made `div`s with `fixed inset-0 bg-black/..`: `CreateModeDialog.tsx:116`,
`ImportModeDialog.tsx:47`, `SystemPromptSection.tsx:64` and `common/Modal.tsx:12` (used only by `ZoomableModal`,
the Mermaid and image zoom view). None had `role="dialog"`, `aria-modal` or an accessible name, none closed on
Escape and none kept keyboard focus inside, so Tab walked into the settings page behind the overlay. The rest of the
webview uses the Radix based `Dialog` (11 files) and `AlertDialog` (10 files).

## Fix

All four now render `Dialog` + `DialogContent` with a `DialogTitle` (visible title for the modes dialogs, a
screen-reader-only one for the zoom modal, named after its first tab). Radix provides `role="dialog"`,
`aria-modal`, the focus trap and Escape.

- Create mode and system prompt keep their full-height panel on the right (`SIDE_PANEL_CLASS` overrides the centred
  layout); their own close button is replaced by the one `DialogContent` draws.
- Create mode and import keep the old behaviour of not closing on a click outside (`onInteractOutside` prevented),
  so a click next to the panel does not throw away a half-filled form. Escape closes them, as asked.
- The zoom modal and the import dialog draw their own close or cancel buttons, so they pass
  `showCloseButton={false}`.
- `Modal.tsx` had no other user and is deleted.

Visible differences: the zoom modal backdrop is `bg-black/50` like every other dialog (was `/70`); the dialog titles
use the `DialogTitle` type scale (`text-lg font-semibold`) instead of the browser `h2` size; dialogs fade and zoom in
like the other dialogs.

## Tests

- Create, import and system prompt: the dialog is found by role with its accessible name, Escape closes it, and
  Escape does not create or import anything.
- Zoom modal: role and name; close button, backdrop pointer-down and Escape all close it. The spec helpers now find
  the modal by `role="dialog"` (the Radix overlay and content are siblings, so `.fixed.inset-0` no longer finds the
  content).

## Notes

- `ChatRow.golden-renders.spec.tsx` has 3 failures (`completion_result`, `completion_result partial`,
  `checkpoint_saved`) on a clean `origin/main` worktree too; unrelated to this change.
- The literal "Restrict to specific MCP servers" in `CreateModeDialog.tsx` is left for the i18n item (D7).
