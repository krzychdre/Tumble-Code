# r4 D5 batch 1: app shell without setState in effects

## Status

Done.

## Related plans

- `ai_plans/2026-10-23_17-20_maintenance-audit-round-4.md` (D5, `react-hooks/set-state-in-effect`)

## Touched files

- `webview-ui/src/App.tsx`
- `webview-ui/src/i18n/TranslationContext.tsx`
- `webview-ui/src/hooks/useOrganizationSwitch.ts`
- `webview-ui/src/hooks/useCloudUpsell.ts`, `webview-ui/src/components/chat/ShareButton.tsx`
- specs: `App.spec.tsx`, `TranslationContext.spec.tsx`, `ShareButton.spec.tsx`

## Problem

Six `set-state-in-effect` findings: each effect copied a prop or store value into state one render late.

## Change

All six adjust state while rendering (React docs, "You Might Not Need an Effect"):

- `App`: the announcement opens when it becomes due on the chat tab (a previous-value state); the
  `didShowAnnouncement` message stays in an effect keyed on that flag. The import redirect remembers the handled
  import in state instead of a ref.
- `TranslationProvider`: the "hydrated UI has shown" latch is set in render.
- `useOrganizationSwitch`: follows the signed-in organization with a previous-value state.
- `useCloudUpsell`: closes the upsell when a sign-in started from it completes (previous-value state on "signed
  in for sharing"). The `onAuthSuccess` and `autoOpenOnAuth` options had no caller that enabled them and are gone.
  `ShareButton` opens its popover in render once its own sign-in completes.

## Tests

New cases, green before and after the change: App announcement (opens when due, reported once, reopens after a
tab visit), TranslationContext (a later switch keeps the current language visible), ShareButton (sign-in from the
upsell closes it and opens the popover; a sign-in elsewhere changes neither).

Mutation checks, each turned a spec red: no `setShowAnnouncement(true)`; `didShowAnnouncement` posted
unconditionally; no import redirect; no organization follow; no latch; no upsell close; no `initiatedAuth` guard;
no popover open.
