---
"@tumble-code/cli": patch
---

A `models` entry in cli-settings.json can set `modelSize` to `"standard"`, `"slim"` or `"compact"` (with `hideMcp` for `"slim"`), the same choice as "Model size" in the VS Code profile settings, so a small model gets the slim toolset or the compact mode (short system prompt, minimal tools, tighter limits, no subtasks). It works with every provider and follows the model through every mode and `/model`.
