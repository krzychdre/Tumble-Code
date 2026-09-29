# "Apply config to modes" list: line icons instead of emoji

## Problem

The popover that asks which modes should use an API configuration listed the raw mode
names, so the emoji baked into them (for example the crane and laptop) still showed.
The mode selector and the modes settings already draw monochrome line icons.

## Change

`ApiConfigSelector.tsx`: each row renders `ModeIcon` and `modeLabel(mode.name)`, the same
helpers the mode selector uses. The checkbox `aria-label` uses the stripped name too.

## Verification

ApiConfigSelector and ChatTextArea.lockApiConfig specs pass, eslint clean.
