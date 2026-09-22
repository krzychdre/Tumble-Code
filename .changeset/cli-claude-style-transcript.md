---
"tumble-code": minor
---

- **The CLI is rebuilt around a scrollback transcript.** Finished messages are printed into the terminal's own scrollback instead of being re-rendered inside a live region, so the history scrolls with the terminal, survives a resize and can be copied out. Only the in-flight message stays live, and its body is clamped so a long answer or a large tool result cannot push the prompt off screen.
- **Answers are no longer lost at the end of a turn.** A streamed message that was still marked partial when the agent went idle is now promoted to the transcript instead of disappearing with the live region, and a message finalized under the same timestamp as its streaming updates replaces that entry in place rather than being dropped as a duplicate.
- **Tool calls and thinking are readable.** Reads, writes, searches, commands and generic tools each render a compact preview with a result line, thinking blocks are visible while the model is reasoning, and ctrl+o toggles a verbose transcript that reprints the whole conversation, including the full bodies the compact view truncates.
- **Provider parity with the extension.** The CLI's provider list, API key fields, base-url fields and environment variables are derived from the shared provider registry instead of a hardcoded list of four, so every provider the extension supports is selectable from the command line, minus the seven providers retired in this same release. `--base-url` is rejected for providers whose schema has no base-url field instead of being silently persisted.
- **Sign in to ChatGPT subscriptions from the terminal** with `auth codex login`, and manage per-command approvals with the `permissions` command.
- **The extension mirrors its provider settings** to `~/.roo/cli-settings.json`, so the CLI starts on the same provider and model without being configured twice.
- **Startup is quiet:** the bundled release no longer prints the dotenv injection banner, and Node's `DEP0040` punycode deprecation warning is gone because the bundle now resolves the userland package instead of the deprecated built-in.
- **ripgrep ships with the CLI**, so file search works on a machine without VS Code installed.
