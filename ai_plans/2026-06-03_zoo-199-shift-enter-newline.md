# Port plan — Zoo PR #199 → `feature/zoo-199-shift-enter-newline`

## §0 Context & credit

- **Upstream:** Zoo-Code PR #199 `fix: keep Shift+Enter inserting new lines in
chat input` (commit `c17cdf6a1`).
- **Authors:** roomote[bot] (bot → dropped), Roomote (AI assistant → dropped),
  Naved Merchant <naved.merchant@gmail.com> (human). Commit trailer:
  `Co-authored-by: Naved  Merchant <naved.merchant@gmail.com>`.

## §1 What it does

When the chat input's `enterBehavior` is set to `"newline"` (Enter inserts a
newline, a modifier sends), the handler treated **Shift+Enter** as a send
trigger alongside Ctrl/Cmd+Enter. Shift+Enter is the universal "insert newline"
chord, so this stole it from users: holding Shift while pressing Enter sent the
message instead of adding a line break. The fix drops `event.shiftKey` from the
send condition so only Ctrl/Cmd+Enter sends and Shift+Enter falls through to the
browser's default newline insertion.

## §2 Scope cuts / landmines

- Single-condition change in one handler + its comment. No new state, no i18n.
- Does **not** touch the default (`enterBehavior !== "newline"`) branch, where
  Shift+Enter is _already_ the newline chord (`if (!event.shiftKey)`).
- No TTS / router / cloud / Roo-branding involvement.

## §3 TDD — failing test first

File `webview-ui/src/components/chat/__tests__/ChatTextArea.spec.tsx`, the
newline-mode test (currently named
`"should treat Ctrl/Cmd/Shift+Enter as send and plain Enter as newline in newline mode"`).

Rename it and change the Shift+Enter expectations so Shift+Enter is a newline,
not a send:

- title → `"should send only on Ctrl/Cmd+Enter and allow Shift+Enter in newline mode"`
- after the Shift+Enter event: `expect(onSend).toHaveBeenCalledTimes(2)` →
  `toHaveBeenCalledTimes(1)` (only the earlier Ctrl+Enter sent), and
  `expect(shiftEnterEvent.defaultPrevented).toBe(true)` → `.toBe(false)`.

Command (run from `webview-ui/`):
`npx vitest run src/components/chat/__tests__/ChatTextArea.spec.tsx -t "newline mode"`
Expect RED before the production edit.

## §4 Production edit

`webview-ui/src/components/chat/ChatTextArea.tsx` lines 492-493:

- before:
    ```tsx
    // New behavior: Enter = newline, Shift+Enter or Ctrl+Enter = send
    if (event.shiftKey || event.ctrlKey || event.metaKey) {
    ```
- after:
    ```tsx
    // New behavior: Enter = newline, Ctrl/Cmd+Enter = send
    if (event.ctrlKey || event.metaKey) {
    ```

## §5 Verification (binary acceptance)

- `npx vitest run src/components/chat/__tests__/ChatTextArea.spec.tsx` → GREEN
- root `pnpm check-types` → 13/13
- `cd webview-ui && pnpm lint` → exit 0
