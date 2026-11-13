# r4 D5 batch 4: marketplace, modes and cloud views without setState in effects

## Status

Done.

## Related plans

- `ai_plans/2026-10-23_17-20_maintenance-audit-round-4.md` (D5, `react-hooks/set-state-in-effect`)

## Touched files

- `webview-ui/src/components/marketplace/MarketplaceView.tsx`
- `webview-ui/src/components/marketplace/components/MarketplaceInstallModal.tsx`
- `webview-ui/src/components/modes/ModesView.tsx`
- `webview-ui/src/components/cloud/CloudView.tsx`
- their specs

## Problem

Six `set-state-in-effect` findings.

## Change

- `MarketplaceView`: the fetch on open runs once when the manager has no items (it read the
  `hasReceivedInitialState` flag, which only ever gated that one fetch). The refetch on an organization settings
  change compares against the previous version in a ref instead of a state.
- `MarketplaceInstallModal`: another item resets method, values, error and success in render (previous-value
  state). Picking a method recomputes the parameter values in the select's handler. Both use one helper for the
  effective parameters, which the component used to compute twice.
- `ModesView`: follows the backend mode in render (previous-value state).
- `CloudView`: a completed sign-in ends the progress and the manual URL entry in render. `wasAuthenticatedRef`
  and `timeoutRef` were never read or set and are gone, with the unmount cleanup of the latter.

## Tests

New cases, green before and after: MarketplaceView fetches once on open without items and again after each
organization version change (also back to -1 and to 1); the install modal installs with the last method's
parameters and starts over for another item; ModesView follows an outside mode switch; CloudView ends the
sign-in progress on sign-in.

Mutation checks, each turned a spec red: every render-time reset removed, the open fetch forced on and off, the
ref update dropped, the method handler's value update dropped.
