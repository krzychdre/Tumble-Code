# Tumble Code Changelog

## 1.2.0

Released 2026-10-29

### New

- **Organizations in the self-hosted cloud.** An Authentik group with the attribute `tumble_organization` is an organization (a second group with `tumble_organization_admins` names its admins), and a task belongs to the organization selected in Tumble Code when it starts. Settings list your organizations and their members with a link to Authentik, where they are managed; the cloud now needs `AUTHENTIK_API_TOKEN` in `.env` (see its README).
- **Projects in the self-hosted cloud.** Settings now lead to a Projects page: every clone and worktree of a repository is one project, a folder without git is a project too, and folders that belong together can be merged. Each project has a recall setting, off by default, that will decide which earlier sessions Tumble Code may look up.
- **Searchable past sessions in the self-hosted cloud.** For a project whose recall is switched on, the cloud keeps a short summary of every session (what was asked, what was concluded, which files were touched) and searches it in milliseconds; a task page can keep its session out of recall.
- **Recall of past sessions.** When you are signed in to Tumble Code Cloud and recall is turned on for the project, the agent can search earlier sessions and read what was asked and concluded there. Every worktree of a repository counts as the same project.

### Improved

- **CLI: the input bar stays at the bottom of the terminal.** The prompt bar now docks to the bottom terminal row like Claude Code instead of floating under the transcript. Scrolling, `/clear` and resize keep it in place.
- **Self-hosted cloud metrics by project and by model.** The usage metrics page opens with a table of your projects (or models) with their tokens, cost, share of the cost, calls and tasks. A click on a name shows the whole page, charts and session quality included, for that project or model alone; the page remembers the grouping you picked.
- **Self-hosted cloud metrics for an organization's admin.** An admin of an organization picks it in a new Space selector on the usage metrics page and sees the organization's usage from every member, with a table per user next to the project and model ones; a click on a member shows the whole page for that member alone. Members who are not admins see only their own usage, as before.
- **Self-hosted cloud project names are unique in their space.** When two people's folders without git share a name, the second project is named after its owner, such as `notes (alice)`, and its page and the Projects list say it was renamed automatically until someone saves a name. Renaming a project to a name its space already uses is refused.
- **Self-hosted cloud dataset page in tabs.** The Dataset page is split into Overview, Export, Tasks and Recording, so the recording switch and your anonymization terms no longer sit in the middle of the figures, and every recorded task is listed page by page.
- **Self-hosted cloud projects as a list.** Settings / Projects is a paged table, one row per project, filtered by name or repository, by space and by whether recall is on. A project opens on its own page, where you rename it, choose its recall setting and merge it into another project by typing that project's name.
- **Self-hosted cloud stays fast with a long history.** The usage metrics, diagnostics and task list pages now read running totals the cloud keeps as requests arrive instead of every model request and task on each view, so with 200,000 tasks and 4.4 million requests an organization's all-time metrics open in about two seconds instead of over a minute and the task list in about a tenth of a second. The upgrade prepares the history stored before it once, which takes a few minutes on a history that large.
- **Self-hosted cloud settings in tabs.** The web panel's Settings has tabs for Retention, Projects and Organizations, and a page inside Settings shows where you are with a path back (Settings / Organizations / name).

### Fixed

- **A repository can no longer pre-approve commands on a fresh install.** The commands that run without asking come only from your own settings: the first folder opened after installing no longer copies its workspace setting into them, and the setting can no longer be set per workspace.
- **CLI: an answer full of escaped dollar signs no longer freezes the terminal.** A line with thousands of `\$` renders at once, and an escaped dollar such as the one in `echo \$HOME` no longer starts a formula.
- **CLI: the cloud sign-in ignores a callback that arrives before the sign-in started.** The terminal's sign-in listener now accepts only the callback carrying the state of the sign-in it opened, so a request sent to its port earlier can no longer end the sign-in.
- **CLI: an answer full of unclosed brackets no longer freezes the terminal.** Lines with thousands of `\[`, `\(`, `[` or `[a](` render at once, and a link whose address holds parentheses keeps its whole address.
- **CLI: settings, history and secrets files are readable by you only.** The CLI now creates `~/.roo` for its owner only and writes `cli-settings.json`, `cli-history.json` and its secrets file with owner-only permissions from the moment they are written, also when an older version left them readable by other users.
- **CLI: upgrades and installs are verified.** `tumble upgrade` runs the installer of the exact release it installs instead of the latest development version, and the installer checks the download against the release's published checksum before unpacking it.
- **Self-hosted cloud: a date at the end of the calendar no longer breaks the task list.** A filter date such as 9999-12-31 is now ignored instead of making the list fail on every visit, and malformed image uploads get a clear error instead of a server error.
- **Self-hosted cloud metrics stay readable whatever a client reports.** A model request reporting impossible usage (billions of tokens, a negative or astronomical cost, a model name with control characters or kilobytes long) no longer breaks an organization admin's metrics page or the upgrade: such a figure counts as zero and a name is cleaned and cut to 256 bytes.
- **Self-hosted cloud: an error report full of dashed words no longer stalls the server.** Grouping a report whose message was one long run of words joined by dashes took up to a second and held every other request; it now takes a moment and runs beside other requests instead of in front of them.
- **Self-hosted cloud: one long error report can no longer stall the server.** Grouping an error report with a long run of letters and digits in its message took seconds to minutes and held every other request; it now takes a moment, and reports are grouped as before.
- **Self-hosted cloud: parallel dataset uploads can no longer exhaust the server's memory.** The server now parses only a few recorded LLM exchanges at a time and asks the extension to retry the rest a few seconds later.
- **Self-hosted cloud: one account can no longer disturb another's data or pages.** A client can only link its own tasks and update its own task rows, one task's odd text or time no longer stops recall for everyone, single events and live updates are bounded in size and in database use, and long breakdown tables on the metrics page fold their smallest rows.
- **Self-hosted cloud: one odd message can no longer freeze a task or share page.** Messages full of unclosed formula openers, thousands of formulas, emphasis marks or unclosed HTML tags now render in a moment; a message too costly to format is shown as plain text.
- **Self-hosted cloud: signing out stops the live task view in open tabs.** A web panel tab left open no longer keeps receiving a task's live updates after its session was signed out or has expired.
- **Self-hosted cloud: a message with a malformed time no longer breaks its task page for good.** The task page and its share link open even when one stored message has no valid time.
- **Provider API keys never reach the cloud.** Everything sent to the cloud (diagnostics, synced and live task messages, recorded exchanges, error reports) now has every stored provider key, custom header value and code-index key removed, also when an error message quotes it, along with passwords written into a web address and short `sk-` keys.
- **Self-hosted cloud: the request rate limit now applies.** `RATE_LIMIT_REQUESTS_PER_MINUTE` limits every page and API route per client address and route, as documented; before, it only applied to the health check. The extension's own event, image and LLM-exchange uploads stay outside it.
- **Self-hosted cloud: a huge retention limit no longer breaks the settings page.** The retention form now refuses numbers above its maximum with a message instead of saving them, and a too large age saved earlier no longer makes the settings page and the scheduled cleanup fail.
- **Self-hosted cloud: hiding secrets in long texts no longer stalls the server.** Some texts, such as many blank lines or a broken private key, made secret redaction for recall and dataset exports take seconds; it now takes the same time as any other text, and recall cards are built without holding up other requests.
- **Self-hosted cloud: share links can be revoked and follow the organization's expiry.** The task page shows a task's share link with a "Stop sharing" button that turns it off at once. A link shared within an organization now stops working after the organization's share expiration period.
- **Self-hosted cloud: switching task sharing off now works.** `ENABLE_TASK_SHARING=false` and `ALLOW_PUBLIC_TASK_SHARING=false` now hold for tasks without an organization too, and they also close the links shared before the switch: a public link then needs a sign-in, and with sharing off only the task's owner can open it.
- **Self-hosted cloud: shared pages no longer reveal their address to other sites.** Images and links on a web panel page, a shared task above all, no longer tell other sites the page's address, and downloads keep their names whatever characters a task id holds.
- **Self-hosted cloud: a sign-in finishes only in the browser that started it.** A sign-in link opened by somebody else, or a sign-in page handed to another browser, can no longer complete there, and reusing an old sign-in link shows an error page instead of a server error.
- **Self-hosted cloud: long streamed answers no longer slow the server down.** Saving a message while it streams now costs the same for every chunk however long the message gets, and the server keeps only a bounded number of unsaved chunks in memory.
- **Self-hosted cloud task duration counts only the model's time.** A task's duration on the task list and the usage metrics page is now the sum of its model requests, each from sending it to the end of the answer, so waiting for you, approvals, running commands and continuing a task days later no longer count. A task with subtasks shows the duration of the whole run, where time in which several subtasks worked at once counts once. Tasks recorded before this version show no duration.
- **Self-hosted cloud: a message full of `<task>` tags can no longer stall the server.** Working out a task's title from such a message took seconds to minutes and held every page and live connection; it now takes a moment, with the same titles as before.
- **Self-hosted cloud task list groups by project.** The task list now groups and filters by the same projects as the metrics and projects pages: every clone and worktree of a repository is one group, named after the project, and the search finds a project's name. Each task still shows the folder it ran in.
- **Self-hosted cloud task list remembers your view.** The task list now reopens with the filters, grouping and sort you last used and with the groups and subtask trees you left open; everything else starts closed. The project and model filters always offer every project and model, also after you picked one.
- **Commands run only in a directory of the workspace.** A working directory the model picks for a command must now lie in the workspace, and the `.rooignore` and protected-file checks look at the files the command would really touch from there, so a command that runs elsewhere has to say so in its own text, where you see it.
- **Searching commits after `@` can no longer run a command.** Text typed in the commit search, including quotes, `$(...)` or backticks, is searched for as text, and the search waits until you stop typing instead of running git on every keystroke.
- **Dataset page lists projects to leave out, not every folder.** The self-hosted cloud's dataset page now offers each project once, with every clone and agent worktree of it included, and leaving a project out keeps all of its tasks out of the export.
- **More wrappers can no longer carry a denied command past the deny list.** Commands run through `su -c`, `script -c`, `busybox`, `strace`, `chrt`, `cpulimit`, `fakeroot`, `firejail`, `systemd-run`, `parallel`, `ssh` and `gdb --args` are checked like the command itself, `find -delete` counts as `rm`, and inline code (`python3 -c`, `node -e`, `gdb -ex`, `vim -c`, an awk program calling `system()`) asks for approval while your deny list has entries.
- **A denied command can no longer slip past the deny list inside another command.** Commands run through `env`, `nice`, `sudo`, `timeout`, `xargs`, `find -exec`, `sh -c`, `eval`, `npx`, `git -C` and similar wrappers are checked like the command itself, and a wrapper in your allowed list no longer approves whatever it runs: that has to be allowed too.
- **Searching a saved tool output or the task history can no longer freeze the extension with a choice inside a repeat.** Patterns such as `(a|a)*b` or `(a{1,5})+b`, which could take seconds to minutes on one line, are searched for as plain text, like the nested repeats before them.
- **Signing out of the cloud always signs you out.** A session token that was being renewed at the moment you signed out no longer keeps you signed in, and the CLI's `tumble auth cloud status` shows signed out right away.
- **Deleting a project MCP server no longer starts the ones you declined.** Removing one server from a project's `.roo/mcp.json` restarts only the servers you agreed to; the others still wait for your consent.
- **An MCP tool's "always allow" now comes from the server that runs it.** When a project and your global settings have an MCP server of the same name, the project's server no longer borrows the global server's "always allow" for a tool of the same name.
- **Mermaid diagrams in chat no longer keep links or click actions.** Diagrams written by the model render in Mermaid's strict mode, so a `javascript:` link or a click callback in the diagram text is dropped instead of becoming part of the chat view.
- **Links in the chat only open web pages and mail.** A link that would run a VS Code command, open a local file or start another program is no longer opened, in the extension and in the CLI, and on Windows the CLI no longer passes a link through the command prompt.
- **A link can no longer swap your OpenRouter key.** "Get OpenRouter API Key" now starts a sign-in that only this window can finish, protected by PKCE; an OpenRouter sign-in link you did not start is ignored instead of replacing the key in your profile.
- **Temporary copies of your conversations are no longer readable by other users of the machine.** Markdown previews, task history and diagnostics files, images opened from the chat, the zsh startup folder, custom tool builds and the CLI's run folder now go into folders only you can open, so another account can no longer read them or redirect the writes.
- **A repository's own custom tools no longer run without asking.** With custom tools turned on, the tools in a project's `.roo/tools` folder load only after you agree to them, and you are asked again when they change; your own tools in `~/.roo/tools` load as before, and nothing loads while the experiment is off.
- **Opening a repository no longer starts its MCP servers without asking.** The servers in a project's `.roo/mcp.json` start only after you agree to the commands or addresses they use, and you are asked again when those change. The CLI asks in the terminal; a run without a terminal starts only the servers you already agreed to.
- **Protected settings stay protected on Windows when code writes the path with `/`.** An auto-approved `node -e` or `python -c` command that names VS Code's settings folder with forward slashes now asks first, as it already did with backslashes.
- **Protected configuration files stay protected from shell commands and from subfolders.** A command that would write a protected file such as `.roo/mcp.json` or `.vscode/settings.json` now asks first, even when the command itself is auto-approved, and protection also covers the workspace root when a task runs in a subfolder, your own `~/.roo` and VS Code's user settings, and links that lead to those files.
- **Shell commands can no longer rewrite your global MCP settings without asking.** A command that writes a protected file through `~`, `$HOME`, a path only known when it runs, or inline code such as `python3 -c` that names a protected location now asks first, even when the command itself is auto-approved.
- **Searching a saved tool output can no longer freeze the extension.** A search pattern that would take forever to match is searched for as plain text, as task history search already does.
- **A slow search pattern can no longer freeze the extension.** Searching a saved tool output or the task history now stops after 2 seconds, however the pattern is written, and tells the model to search for something simpler.
- **Your cloud sign-in token is no longer saved with requests waiting to be retried.** Requests that failed and wait for another try are stored without the token, a retry signs them with the current one, a token saved by an earlier version is removed, signing out always empties the waiting list, and the CLI keeps its state files readable by you only.
- **`.rooignore` holds up better against shell commands.** Reads through `dd if=`, `git show REV:path`, `git cat-file` and globs such as `cat sec*/key.txt` are blocked like other reads, and commands whose reads cannot be checked (a recursive `grep -r`, `tar`, `cp -r` or `find -exec cat` over a folder holding ignored files, inline `python3 -c` code, a path from a variable) now ask for your approval instead of running automatically.
- **Files in `.rooignore` can no longer be read through a slightly different command.** Commands that read or copy files are checked however the path is written: quoted, absolute, built from `$(pwd)`, after `cd`, inside `sh -c`, `sudo` or `$(...)`, and with more readers such as `cp` and `base64`.
- **A task id can no longer point task files outside the task storage.** A new task started with an id that is no plain name is refused instead of writing its conversation and checkpoint repository wherever the id pointed.
- **Task sync uploads only images inside the workspace.** An image a chat message points to is sent to Tumble Code Cloud only when the file really lies in the task's workspace, so a path outside it, or a link in the repository leading out of it, no longer uploads your other files.
- **Self-hosted cloud: usage from before the upgrade lands in the right quarter of an hour on SQLite.** When the usage summary was first built on a SQLite install, an event in the last microseconds of a quarter (for example 10:14:59.999999) was counted in the next quarter; it is now counted where ingest counts it.
- **`web_fetch` can no longer reach this machine or the local network through another spelling of a name.** A trailing dot (`localhost.`) no longer gets past the check, and a public-looking name whose address is local or private (such as `127.0.0.1.nip.io`) is refused too, also after a redirect.
- **Self-hosted cloud: a long space name no longer runs off a project's page on a phone.** The hints on a project's page now wrap a space name written as one long word instead of letting it spill past the screen edge.
- **A symlink in the workspace that points elsewhere now counts as outside the workspace.** Reading or editing through such a link asks like any other file outside the workspace, and the changed-files panel no longer shows the contents of a file a link points to outside the workspace.

## 1.1.2

Released 2026-10-25

### Fixed

- **The extension page no longer freezes VS Code.** Checkpoints now live in `~/.roo/checkpoints` instead of the extension's data folder, which VS Code walks whenever you open the Tumble Code page or switch its tabs. Checkpoints taken by earlier versions stay where they were; move `<data folder>/tasks/<task id>/checkpoints` to `~/.roo/checkpoints/<task id>` if you want to keep using them.

## 1.1.1

Released 2026-10-25

The CLI now ships in the same release as the extension, under the same version number, and it draws images, diagrams and math formulas in terminals that can show them.

### New

- **CLI: `/copy`, `/export`, `/resume` and Ctrl+R.** Copy the last answer or code block, save the conversation as Markdown, reopen an earlier task of the workspace, and search your previous prompts as in bash.
- **CLI: `tumble doctor`.** Checks Node.js, the extension bundle, ripgrep, the global MCP servers file and the cloud API, one line per check.
- **CLI: images and diagrams.** In terminals that draw images (kitty, Ghostty, WezTerm, iTerm2, foot, xterm, the VS Code terminal) the CLI shows the images an answer points to, and it draws mermaid diagrams everywhere, with box-drawing characters where images are not available. `TUMBLE_IMAGES=off` turns images off.
- **CLI: math formulas.** A formula on a line of its own is drawn as an image where the terminal can show one; everywhere else formulas read as Unicode text, for example `∫_(-∞)⁰ (3x³ + 6x + ½) dx`.
- **CLI: per-model settings.** A `models` entry in `~/.roo/cli-settings.json` can set its own provider, base URL and API key, a model size (standard, slim or compact), a limit of concurrent requests and shortening of old reasoning; `maxParallelSubagents` caps all subagents at once.

### Improved

- **CLI: clean exits.** Ctrl+C, a kill signal or a crash restore the terminal and print the error with the path of the debug log, and `NO_COLOR` turns colour off.
- **CLI: diffs show the change in long lines.** When the change sits beyond the visible width, the diff starts just before it, and the changed columns are highlighted.
- **CLI: local time.** `tumble list` and `/export` show local time with its offset, and a new `timeZone` setting covers systems without a time zone.
- **CLI: messages typed while the task works are queued**, as in VS Code, and a task waiting for its subagents answers them right away.
- **CLI: commands that could not work are gone.** `tumble auth login`, `logout` and `status` and `tumble list models` are removed; `tumble auth codex` stays.
- **CLI: the same defaults as the extension.** Claude models run at their own default reasoning effort, and OpenRouter defaults to Claude Opus 5.
- **One release for the extension and the CLI.** Both ship together under one version number, with one changelog. The installer and `tumble upgrade` take the CLI from the latest Tumble Code release.

### Fixed

- **CLI: settings that were silently ignored.** The base-URL environment variables (`OPENAI_BASE_URL`, `ANTHROPIC_BASE_URL` and the others) are read, a reasoning effort for the `openai` provider reaches the model, and `--base-url` with `mistral` stops with an error instead of being dropped.
- **CLI: print and JSON output.** No message is skipped or printed twice, and a resumed task no longer emits stray events from its history.
- **CLI: typing and layout.** The first characters typed right after start are no longer scrambled, no blank row stays under the footer, and an oversized image no longer freezes or crashes the CLI.
- **CLI: no exit when the cloud profile cannot be read.** A signed-in CLI no longer stops in the middle of a task when the cloud answers the session refresh but fails to return the user profile; the failure is logged instead.
- **Commit search without a match.** Searching commits in the chat input for text that matches nothing no longer shows one empty commit.
- **Clear errors from Z.ai and Moonshot.** A refused or failed request now names the provider and the cause, for example `Connection error. (connect ECONNREFUSED 127.0.0.1:8080)`, instead of a bare "Connection error.".
- **Reading an empty file.** The agent is told that an empty file is empty instead of being shown a single blank line.

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
