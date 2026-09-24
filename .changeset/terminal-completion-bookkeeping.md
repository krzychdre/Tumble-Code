---
"tumble-code": patch
---

Commands that keep running in the background now report their remaining output and their end to the model when they finish in the CLI, and in the extension when terminal shell integration is disabled, and stopping a backgrounded command in a VS Code terminal (user timeout, cancelling the task) now actually interrupts it.
