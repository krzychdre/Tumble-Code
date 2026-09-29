# Mode selector: outline icons instead of emoji

**Status:** done on `feat/mode-selector-line-icons`
**Touched:** `webview-ui/src/components/chat/modeIcon.tsx` (new), `webview-ui/src/components/chat/ModeSelector.tsx`, specs `modeIcon.spec.ts`, `ModeSelector.spec.tsx`

## Problem

The mode list and the mode chip in the composer showed colourful emoji (🏗️ 💻 ❓ 🪲 🪃 🌐). The owner wants
monochrome outline icons that match the rest of the UI.

## What was happening

The emoji are not icons at all: they are part of the mode `name` (`packages/types/src/mode.ts`, and the
same for custom modes such as `.roomodes`), and `ModeSelector` printed the name verbatim.

## Fix

- `modeIcon.tsx` maps the mode slug to a lucide outline icon drawn in `currentColor`
  (architect: DraftingCompass, code: CodeXml, ask: CircleQuestionMark, debug: Bug, orchestrator: Workflow,
  translate: Languages, reviewer: ScanEye, vision: Eye; any other slug: Blocks).
- `modeLabel(name)` strips one leading emoji (with variation selector, ZWJ sequence, skin tone) and the
  space after it; a name that is only an emoji is kept as is.
- `ModeSelector` shows icon + stripped label in the trigger chip and in every list row.

The names themselves are untouched: they still reach prompts, settings and the CLI unchanged, and fuzzy
search still matches on the full name. The change is display only.

## Tests

- `modeIcon.spec.ts`: every built-in name, a ZWJ + skin-tone emoji, trailing emoji, emoji-only name.
- `ModeSelector.spec.tsx`: trigger shows `Code` (no emoji) plus an svg; each list row has an svg and a
  label without emoji.

## Caveats

- Other places that print a mode name (settings Modes view, history rows, CLI) still show the emoji.
- A custom mode gets its own icon only if its slug is in the map; everything else gets the generic one.
