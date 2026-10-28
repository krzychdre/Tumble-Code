---
"tumble-code": patch
---

Fixed: **A repository's own custom tools no longer run without asking.** With custom tools turned on, the tools in a project's `.roo/tools` folder load only after you agree to them, and you are asked again when they change; your own tools in `~/.roo/tools` load as before, and nothing loads while the experiment is off.
