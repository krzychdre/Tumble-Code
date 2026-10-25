# Tumble Code Changelog

## 1.1.0

Released 2026-10-24

The first Tumble Code release on the Visual Studio Marketplace. Tasks keep running in the background, parallel subagents report into the task history, and the chat has a calmer look, full keyboard access and much faster streaming in long tasks. The CLI is rebuilt around the terminal's own scrollback and supports every provider of the extension. Tumble Code now needs VS Code 1.102 or newer.

### New

- **Tasks keep running in the background.** Opening another task or the home screen no longer stops a working task. The task history marks working tasks with a spinner and tasks that wait for you with an attention icon, and lists them first.
- **Parallel subagents in the background.** `run_parallel_tasks` returns as soon as the first subagent finishes and `wait_for_subagents` collects the rest, so you can keep talking to the task meanwhile. Subagents are no longer cut off after 50 turns; they stop only when they are stuck, and say why.
- **Subagent transcripts.** Open the whole conversation of a subagent from the subagents panel or the task history, and stop, answer or guide it from there. Subagents appear in the history as subtasks, with their own cost and tokens.
- **Several editor tabs.** Work in several Tumble Code tabs at once. Open one with the Tumble button in the editor title bar, the "Open In New Tab" button or the new Tumble Code entry in the status bar.
- **Pinned tasks.** Pin a task to keep it at the top of the task history and the recent tasks.
- **Skills in the `/` menu.** Skills replace custom slash commands: the menu lists every skill of the current mode, and `/skill-name` runs it.
- **Vision is a built-in mode.** It turns images into text descriptions for modes whose model cannot see images.
- **Model size for small models.** A provider profile can run in standard, slim or compact mode. Compact uses a short system prompt and a minimal toolset for models with a small context.
- **Reasoning effort for Claude.** Anthropic, Vertex and Bedrock profiles choose the reasoning effort (low to max, as each model offers), also with thinking off.
- **Return reasoning to the model.** OpenAI-compatible profiles can send the model's reasoning back to it (GLM, DeepSeek R1, local vLLM) and shorten old reasoning when the context fills up. This replaces the "Enable R1 model parameters" toggle.
- **Max concurrent requests per profile.** Limits how many requests one provider takes at once, for example the parallel slots of a local server.
- **New models.** Claude Opus 5, Opus 5.5, Sonnet 5, Sonnet 5.5, Haiku 5.5 and Fable 5.1; GPT-6 Astra, Sol and Luna; Gemini 4 Argon and 3.8 Flash; Grok 4.6; Kimi K3; DeepSeek V4.1 Flash; GLM-5.3, now the Z.ai default.
- **Readable diffs in a narrow sidebar.** Unchanged lines fold away, the file header keeps its +N -M counts in view, and "Open diff" shows the patch in an editor tab.
- **CLI: rebuilt around the terminal scrollback.** Finished messages go into the terminal's own scrollback, so the history scrolls, survives a resize and can be copied. Tool calls get compact previews, file edits show a coloured diff, and ctrl+o shows everything, live while a block still runs.
- **CLI: every provider of the extension.** The CLI offers the same providers as the extension, starts with the provider settings the extension mirrors to `~/.roo/cli-settings.json`, and signs in to ChatGPT with `auth codex login`.
- **CLI: MCP servers.** Global servers live in `~/.roo/mcp.json`, the `/mcp` panel shows, restarts and toggles them, and an MCP approval names the server, the tool and its arguments.
- **CLI: new commands and settings.** `/clear`, `/model`, `/login` and `/logout`; `tumble auth cloud login`; per-model context window and prices, and a configurable command timeout, in `~/.roo/cli-settings.json`.
- **CLI: password prompts.** A command that asks for a password (a private git clone, an ssh key passphrase) asks in a prompt inside the CLI; the answer never reaches the transcript or the model.
- **CLI: clearer status.** A context bar in the footer, a step timer next to the total time, and the cloud connection in the status line.

### Improved

- **Much faster in long tasks.** The chat view receives each new message on its own instead of the whole conversation again (73 GB down to 1.2 GB over 1,054 real tasks), streaming no longer re-reads the tool history on every token, and large tool calls and long reasoning refresh ten times a second.
- **The chat panel opens faster.** It loads only English plus your language, and loads the math renderer, the diagram engine and the plan review screen the first time they are needed.
- **One calm look.** The chat, settings, MCP, marketplace and history share one frame style, and buttons that used to appear only under the mouse are always visible.
- **Keyboard and screen readers.** Tool rows, menus, dialogs, the mode picker, the to-do list and the task history work with the keyboard, and about fifty icon buttons have names that screen readers announce.
- **Task history.** Every task shows its mode, start time, result, cost and tokens, and the cost includes all its subtasks and subagents.
- **Stop stops the server.** Stop now closes the model request on every provider, so the server stops generating and billing at once.
- **Cheaper memory.** The memory writers ask one short question (about 2,000-3,000 tokens instead of 40,000-60,000), work with small local models, write notes in English and also run after a normally finished chat.
- **Smarter retries.** An invalid key, a forbidden request or an unknown model (401, 403, 404) stops instead of retrying forever, a silent connection times out after the API request timeout, and a "context window exceeded" retry really sends a smaller request.
- **System prompt.** Each mode is told which tools it lacks and how to delegate, the model gets the local time, and a DOING TASKS section gives it engineering defaults.
- **Diagrams and code.** Mermaid diagrams follow the colour theme, and code blocks highlight 41 more languages.
- **Diagnostics in the output panel.** Warnings and errors go to View > Output > Tumble Code with their time and level; detailed debug lines appear while the debug setting is on.
- **Smaller extension.** About 20 MB less to download: unused parsing grammars, libraries and Microsoft's deprecated webview UI toolkit are gone.
- **Provider cleanup.** Seven redundant providers are retired (Poe, Unbound, Requesty, Vercel AI Gateway, Baseten, SambaNova, Fireworks), models their providers shut down are gone, and OpenRouter, Vertex and Bedrock default to Claude Opus 5. Saved profiles keep loading.
- **Removed: AI image generation.** The experimental `generate_image` tool and its settings are gone; attaching and reading images work as before.

### Fixed

- **Costs that were too low.** Anthropic and MiniMax now count the real output tokens, cache writes are counted on OpenAI and OpenAI-compatible servers, Claude Opus 5 and Sonnet 5 get prompt caching on Anthropic, and stale prices (Sonnet 5, GPT-5.6, DeepSeek, Z.ai) are corrected.
- **Polish and other non-English letters** no longer show up as `\u0142`-style codes in results, questions, to-do lists and subtask messages, also in older tasks.
- **Answers shown twice or late.** A plain-text final answer is shown once, and streamed text no longer lags one chunk behind.
- **Settings stay in step.** Switches and MCP controls agree between the sidebar and editor tabs, Save no longer flips MCP or `.rooignore` settings, and a settings import no longer breaks provider profiles.
- **MCP servers.** A failed server stays listed with its error and can be restarted, editing the settings file restarts only the changed server, and no server process is left behind when VS Code closes.
- **Codebase indexing.** A file saved without changes no longer drops out of the index, stale entries are removed reliably, a wrong vector dimension is explained at once, and added workspace folders are indexed.
- **File edits.** `apply_diff` tolerates more formatting slips and reports every failed block, HTML entities are written as the model sent them, and `write_to_file` always writes to the requested path.
- **Storage.** A damaged task file is kept as `.corrupt-<time>` instead of being overwritten, writes survive a power loss, and storage errors show in a banner with the cause.
- **Security.** Command auto-approval follows bash quoting rules, so a denied command can no longer slip through next to an allowed one; commands denied in VS Code settings are honoured; shipped libraries are updated to patched releases.
- **Self-hosted cloud.** Editor-tab tasks appear in the cloud, the web Resume button resumes the task, web commands reach the task and window they are meant for, and the bridge reconnects after a server restart.
- **Subtask loops.** A subtask can no longer delegate to its own mode, and subtasks nest at most five levels deep.
- **Chat rendering.** Formulas render again, prices such as "$5 and $10" stay plain text, and file links (including Windows paths) open the file.
- **LM Studio and Windows freezes.** An unresponsive LM Studio no longer blocks a task, and Windows no longer looks up the OS name before every request.
- **Terminal and search.** Commands keep your system locale, file search finds ripgrep on VS Code 1.130 and later, and an invalid search pattern is reported to the model.
- **Background tasks use their own mode.** A background task, subagent or subtask gets the tools, rules and MCP servers of its own mode.
- **CLI.** MCP tools no longer hang in the default `allow` mode, a password-asking command can no longer freeze the interface, options after the prompt are reported instead of ignored, and fast arrow keys select the right item.

## 1.0.0

Released 2026-08-26

Tumble Code is a new tool: the community fork of Roo Code, refocused on local inference engines (Ollama, LM Studio, llama.cpp and other locally hosted models) so you can run AI coding assistance on your own hardware without paying per token. The display name, publisher, URLs and output channel read "Tumble Code"; command and view IDs (`roo-cline.*`) are kept, so your keybindings keep working. Settings moved from `roo-cline.*` to `tumble-code.*`, and the first launch offers to migrate them from Roo Code.

### New

- **Vision mode.** Gives text-only models eyes: any mode can hand an image to Vision mid-task and get back a text description.
- **Reviewer mode.** Reviews a change against the task's intent, reads the code around it, consults recorded decisions and ends with a clear verdict.
- **Self-hosted cloud.** A backend you run yourself (a Dockerized Python API with Authentik sign-in) for task sharing and remote control, with a web dashboard of tasks, costs and usage metrics.
- **Agent interchange with Claude Code.** Tumble Code and Claude Code on the same machine hand tasks to each other and read each other's plans and sessions.
- **Background model.** A separate, cheaper model for context compaction and memory, with a fallback to the task's model.
- **Parallel subagents with worktrees.** Subagents run side by side in separate git worktrees.
- **Semi and fully autonomous auto-approve.** The auto-approve control shows the active level through its icon, border and label.
- **Per-mode MCP allowlist.** Choose which MCP tools each mode may use.
- **Architect plan approval.** Architect mode produces a plan you approve before work starts.
- **More.** Eager web search in Ask mode, a context usage bar, a terminal shell choice, custom notification sounds, GitHub-style alerts in the chat, and one API profile for several modes at once.
- **New models.** Claude Opus 4.7 and 4.8, Fable 5, GLM-5.1 and 5.2, DeepSeek V4, Gemini 3.5 Flash, GPT-5.5 and 5.6.

### Improved

- **Fewer wasted tokens.** Compaction no longer re-bills the whole context every other turn, models call more tools per turn and re-read files less, and a lighter, non-destructive compaction keeps long tasks coherent.

### Fixed

- **Diff view.** No more crashes, silent save failures or stale dirty tabs.
- **Terminal.** Running processes stop when a task is cancelled.
- **Providers.** Custom Gemini model ids are honoured, truncated Grok diffs are repaired, temperature is left out for models that reject it, and LM Studio loads models before the base URL is saved.
- **Code indexing.** Retries connection failures and explains a vector dimension mismatch.
- **Chat.** No crash on very large transcripts, no repeated celebration sound, and Shift+Enter keeps inserting newlines.
- **Translations.** Missing texts filled in across 17 languages.

## Before 1.0.0

Tumble Code continues [Roo Code](https://github.com/RooCodeInc/Roo-Code). Its releases up to 3.53.1 are in the [Roo Code changelog](https://github.com/RooCodeInc/Roo-Code/blob/main/CHANGELOG.md).
