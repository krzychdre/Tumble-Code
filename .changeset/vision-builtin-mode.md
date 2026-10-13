---
"tumble-code": minor
---

Vision is now a built-in mode next to Architect, Code, Ask, Debug and Orchestrator, so the extension and the CLI always have it. It turns images into precise text descriptions for modes whose model cannot see images. Pin an API profile with a vision-capable model to it (in the CLI: `modes.vision` in `cli-settings.json`); until then the read_file image note does not offer it. A custom mode with the slug `vision` still overrides the built-in one.
