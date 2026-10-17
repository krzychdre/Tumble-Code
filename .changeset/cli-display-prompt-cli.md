---
"@tumble-code/cli": patch
---

In the CLI's terminal UI the model now knows what the terminal shows: the system prompt tells it to show an image with `![description](path)` on a line of its own and that a mermaid block is drawn as a diagram, or, in a text-only terminal, that images cannot be shown. A model no longer links a picture and claims it is displayed.
