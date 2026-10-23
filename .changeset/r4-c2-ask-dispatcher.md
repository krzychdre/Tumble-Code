---
"tumble-code": patch
---

CLI print mode with `--exit-on-error`: a failed API request now ends the run through the normal shutdown (the extension is disposed, then the CLI exits with code 1 and prints "[CLI] Error: API request failed: ..."), instead of the ask handler killing the process on the spot. The yes/no prompts of print mode share one helper.
