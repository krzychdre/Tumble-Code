# Popover frames and composer outline follow the auto-approve mode

**Status:** done on `feat/auto-approve-accent-border`
**Touched:** `webview-ui/src/index.css`, `webview-ui/src/hooks/useAutoApproveFrameAccent.ts` (new),
`webview-ui/src/App.tsx`, `webview-ui/src/components/ui/popover.tsx`,
`webview-ui/src/components/chat/ChatTextArea.tsx`, `webview-ui/src/components/chat/AutoApproveDropdown.tsx`,
specs `useAutoApproveFrameAccent.spec.ts`, `ChatTextArea.composerA11y.spec.tsx`

## Problem

With bypass or autonomous auto-approve on, only the auto-approve chip turned orange. The popover frames
(mode list, API config, auto-approve menu...) and the composer focus outline stayed the theme's focus
blue, so the "you are in a risky mode" signal was easy to miss. The owner wants both to match the mode:
blue normally, orange in bypass/autonomous.

## Fix

- `index.css`: new token `--frame-accent` (default `--vscode-focusBorder`), exposed to Tailwind as
  `--color-frame-accent`; `:root[data-auto-approve="elevated"]` switches it to Tailwind `orange-600`
  (the same colour the auto-approve chip already used), with an oklch fallback.
- `useAutoApproveFrameAccent()` (called once in `App`) writes `data-auto-approve="elevated"` on `<html>`
  while `autoApprovalEnabled && mode in {bypass, autonomous}`. The root is used because popovers render
  in portals outside the chat subtree.
- `isElevatedAutoApproval()` is the single predicate; `AutoApproveDropdown` now uses it too, so chip and
  frames can never disagree.
- `PopoverContent` frame: `border-vscode-focusBorder` -> `border-frame-accent`.
- Composer focus outline and drag-over dashed border: `*-vscode-focusBorder` -> `*-frame-accent`.

## Tests

- `useAutoApproveFrameAccent.spec.ts`: predicate truth table; attribute set for bypass, cleared on the
  switch back to default, never set while auto-approval is off.
- `ChatTextArea.composerA11y.spec.tsx`: the single-outline assertion now names the new class.
- Verified in a real `vite build` that `.border-frame-accent`, `.outline-frame-accent` and the
  `data-auto-approve=elevated` override are emitted.

## Caveats

- Other focus rings (settings inputs, selects) keep the theme blue on purpose: the request was about
  popover windows and the composer.
