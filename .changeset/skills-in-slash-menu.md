---
"tumble-code": minor
---

Skills replace custom slash commands. The chat `/` menu now lists every skill available in the current mode, with its description, under its own "Skills" heading next to the built-in commands such as `/init`. Sending `/skill-name` gives the model the skill's instructions, the same text it gets when it loads the skill itself. When a skill has the same name as a built-in command, the built-in command wins. The Slash Commands settings section is gone, and command files in `~/.roo/commands` and `.roo/commands` are no longer read (they are left on disk untouched); turn them into skills to keep using them.
