---
"tumble-code": patch
---

The whole execute_command row in the chat can now be folded away, not just its output. A command can be as long as its output when a script is passed through a heredoc, so the collapsed row shows only the header with a one-line preview of the command, and the command block, the terminal output and the auto-approve pattern selector are not rendered at all until the chevron is used. The one exception is a command that is waiting for manual approval: that row opens by itself so the full command is visible before the Run Command / Reject decision, and collapsing it by hand still wins.
