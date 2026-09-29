# Welcome screen: neutral copy, no links; composer hint row removed

## Problem

- The welcome tips linked to the original Roo Code docs (`buildDocLink(...)`), and the
  "Check our docs to get started" line did too. The fork has no docs site of its own.
- The copy ("a whole AI dev team", "modes that don't swerve", "no markup or lock-in")
  was upstream marketing, not a neutral description.
- The composer hint row ("Enter send · Shift+Enter new line · @ mention · / command")
  took a full line of vertical space under the input on every screen.

## Change

- `RooTips.tsx`: tip titles are plain emphasized text instead of `Link`s; the `chat:docs`
  paragraph is gone. No link is left on the welcome screen.
- `chat.json` (all 18 locales): new neutral `about` and `rooTips.*` strings, `docs` and
  `composerHint` keys removed.
- `ChatTextArea.tsx`: the hint row and its key-name computation are removed. The input
  placeholder still explains `@` and `/`, and the send key behaviour is unchanged.
- Specs: `RooTips.spec.tsx` asserts no links; the composer a11y spec asserts the hint row
  is absent.
