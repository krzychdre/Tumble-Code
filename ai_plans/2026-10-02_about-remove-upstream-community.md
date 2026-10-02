# About settings: remove the upstream "Contact & Community" block

Date: 2026-10-02
Branch: `fix/about-remove-upstream-community`

## Problem

Settings > About showed a "Contact & Community" block whose links all led to the
upstream Roo Code project, not to Tumble Code:

- bug report and feature request: `github.com/RooCodeInc/Roo-Code/issues/new?...`
- security policy: `github.com/RooCodeInc/Roo-Code/security/policy`
- community: `reddit.com/r/RooCode`, `discord.gg/roocode` (the visible text said
  TumbleCode, the hrefs did not)

The telemetry description's "privacy policy" link also pointed at
`roocode.com/privacy`.

## Change

- `webview-ui/src/components/settings/About.tsx`: the whole block is gone. The
  "Enable debug mode" toggle lived inside that block, so it moves into the first
  section, under the telemetry toggle (same `settingId`, so search still finds it).
- The privacy link now points at the fork's own policy:
  `https://github.com/krzychdre/Tumble-Code/blob/main/PRIVACY.md`.
- Translation keys `about.bugReport`, `about.featureRequest`,
  `about.securityIssue`, `about.community`, `about.contactAndCommunity` removed
  from all 18 webview locales.

## Tests

- `About.spec.tsx`: the three "renders the ... section" cases are replaced by one
  asserting no anchor points at roocode / RooCodeInc / reddit / discord, and one
  asserting the debug toggle is still there.
- `link.call-sites.spec.tsx`: the About case now checks only the privacy link.

## Out of scope (still pointing upstream)

`ErrorBoundary.tsx`, `chat/rows/renderers/say/ApiRequestRows.tsx`,
`cloud/CloudView.tsx` still contain roocode / RooCodeInc links.
