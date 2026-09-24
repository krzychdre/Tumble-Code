---
"tumble-code": patch
---

Fixes ported from the Zoo-Code fork:

- **Terminal keeps your locale.** Commands no longer run with `en_US.UTF-8` forced over a UTF-8 system locale such as `pl_PL.UTF-8`, which printed `setlocale` warnings and changed program output.
- **File search on newer VS Code.** ripgrep is found again in the package layout used by VS Code 1.130 and later; before, file search and listing failed, and a missing ripgrep broke the whole environment summary sent to the model.
- **Tasks use their own mode.** A background task, subagent or delegated subtask now gets the tools, rules, skills and MCP servers of its own mode instead of the mode of the task you are looking at. Deleting a custom mode also moves the running task out of it.
- **Codebase search** searches the index of the task's workspace folder, not the folder of the active editor.
- **Follow-up suggestions.** Blank or missing suggestion answers from the model no longer break the chat or get auto-approved as an empty reply.
- **Reasoning display.** When a model sends reasoning and answer text in one chunk, the reasoning is shown first instead of splitting the answer into extra rows (OpenAI-compatible servers, Z.ai, DeepSeek, LiteLLM, Qwen Code).
- **Reasoning effort settings.** The selector no longer shows a blank value after switching to a model that does not offer the saved effort, and it shows the model's default effort when none is saved.
- **Providers.** A custom Anthropic model id is used as entered instead of being replaced by the default model; OpenAI Codex one-shot requests (prompt enhancement, condensing) no longer fail with HTTP 400; Claude on Vertex no longer crashes on an empty completion; token usage is reported again for hosts whose name merely contains "x.ai".
- **Reliability.** Interrupted tool calls are saved as errors in the task history; creating `mcp_settings.json` from the CLI and the extension at the same time no longer overwrites it with an empty file; a child task view no longer jumps back to Home during rapid state updates; a non-text VS Code terminal profile setting no longer throws.
- **Architect mode** now tells the model to save plans in `./plans` relative to the workspace, instead of `/plans`, which models took as an absolute path.
