---
"tumble-code": patch
---

In the CLI, picking a file whose path contains spaces from the `@` file list now inserts a mention the agent can read (spaces escaped as `\ `, as the VS Code chat does). Before, the agent saw only the part of the path before the first space.
