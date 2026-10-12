---
"@tumble-code/cli": patch
---

The terminal UI draws images. An image the answer puts on a line of its own (`![chart](out/chart.png)`, relative to the workspace, or a `data:` URL) is drawn in the transcript in terminals that speak the kitty, iTerm2 or sixel image protocol (kitty, Ghostty, WezTerm, iTerm2, the VS Code terminal with images enabled, foot, xterm; not GNOME Terminal or Ptyxis, whose VTE 0.84 has no image support). The CLI asks the terminal at startup; `TUMBLE_IMAGES=off` turns images off and `TUMBLE_IMAGES=kitty|iterm|sixel` forces a protocol. Other terminals show `[image: chart] out/chart.png`.
