# Port plan — Zoo PR #163 → `feature/zoo-163-welcome-screen-scroll`

## §0 Context & credit

- **Upstream:** Zoo-Code PR #163 `Welcome screen fix` (commit `04738ea99`,
  merged 2026-05-18).
- **Author:** Naved Merchant <naved.merchant@gmail.com> — a human. Commit trailer:
  `Co-authored-by: Naved  Merchant <naved.merchant@gmail.com>`.

## §1 What it does

The welcome screen (shown when there are no task messages) used
`justify-center` + `h-full` on both the scroll container and its inner content.
When the welcome content is taller than the viewport, vertical centering pins it
so the top/bottom get clipped and the user cannot scroll to them — even though
the container has `overflow-y-auto`. Replacing the inner element's
`justify-center h-full` with `my-auto` (and dropping `justify-center` on the
outer flex container) keeps the content visually centered when there is room but
lets it scroll naturally when it overflows.

## §2 Scope cuts / landmines

- CSS/className change only — no logic, no behavior wiring, no i18n.
- No test: this is purely presentational; the upstream PR added none, and a
  className-equality assertion would be brittle and verify nothing meaningful
  (YAGNI).
- No TTS / router / cloud / Roo-branding involvement.

## §3 Edit (verified — our code matched upstream pre-fix exactly)

`webview-ui/src/components/chat/ChatView.tsx` lines 1596-1597:

- before:
    ```tsx
    <div className="flex flex-col h-full justify-center p-6 min-h-0 overflow-y-auto gap-4 relative">
    	<div className="flex flex-col items-start gap-2 justify-center h-full min-[400px]:px-6">
    ```
- after:
    ```tsx
    <div className="flex flex-col h-full p-6 min-h-0 overflow-y-auto gap-4 relative">
    	<div className="flex flex-col items-start gap-2 my-auto min-[400px]:px-6">
    ```

## §4 Verification (binary acceptance)

- `cd webview-ui && pnpm lint` → exit 0
- root `pnpm check-types` → 13/13
- Manual: with a short viewport the welcome content scrolls fully (no clipped
  top/bottom); with a tall viewport it stays centered.
