# Mention menu stops closing on blur after the first click in it

Branch: `fix/mention-menu-blur-close` (from origin/main eaeb9676a).

## Defect

`webview-ui/src/components/chat/hooks/useMentionMenu.ts` (the mention logic moved there in S5, #569)
keeps a flag `isMouseDownOnMenu`. `handleMenuMouseDown` (passed to `ContextMenu` as `onMouseDown`)
sets it to true so the textarea blur caused by that mousedown does not close the menu.
`handleMenuBlur` closes the menu only while the flag is false.

## Root cause evidence

`grep -n setIsMouseDownOnMenu` on eaeb9676a: the setter is called in exactly one place,
`setIsMouseDownOnMenu(true)`. Nothing sets it back to false, so after the first mousedown in the
menu every later blur keeps the menu open (until the component remounts). The two new cases in
`ChatTextArea.mentionMenu.spec.tsx` fail on main with the menu still rendered.

## Fix

- The flag becomes a ref (`isMouseDownOnMenuRef`): nothing renders it, and the callbacks no longer
  change identity with it.
- `handleMenuBlur` consumes it: if set, it clears it and keeps the menu; otherwise it closes.
- `handleMenuMouseDown` also adds a one-shot `mouseup` listener on `window` that clears it, for a
  mousedown that causes no blur (the textarea was not focused). The event order of a click is
  mousedown, blur, mouseup, so the listener never clears the flag before the blur check.

## Dead state removed

`textAreaBaseHeight` in `ChatTextArea.tsx` was only read inside its own setter condition in
`onHeightChange`. Its last real reader (`height: textAreaBaseHeight || 31`) was removed in
111abdbb2 (2024-12-23). The state and the condition are removed; `onHeightChange` is still
forwarded.

## Tests

`ChatTextArea.mentionMenu.spec.tsx`, closing group: a later blur after a full click in the menu
closes it; a blur after a menu mousedown that ended with a mouseup and no blur closes it.
