---
"@tumble-code/cli": patch
---

The CLI footer no longer leaves a blank row under itself when a turn ends. While a turn was running the spinner occupied its own row plus a blank separator above the input border; at turn end the spinner row disappeared, and at the terminal bottom ink cannot move content down, so the freed row stayed empty. The input area now drops the separator while the spinner is visible, so the spinner takes the separator's place and the busy and idle frames have the same height (owner decision CLI-F2, option a).
