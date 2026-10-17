# @tumble-code/cli

Command Line Interface for Tumble Code - Run the Tumble Code agent from the terminal without VSCode.

## Overview

This CLI uses the `@tumble-code/vscode-shim` package to provide a VSCode API compatibility layer, allowing the main Tumble Code extension to run in a Node.js environment.

## Installation

### Quick Install (Recommended)

Install the Tumble Code CLI with a single command:

```bash
curl -fsSL https://raw.githubusercontent.com/krzychdre/Tumble-Code/main/apps/cli/install.sh | sh
```

**Requirements:**

- Node.js 22 or higher
- macOS Apple Silicon (M1/M2/M3/M4) or Linux x64

**Custom installation directory:**

```bash
ROO_INSTALL_DIR=/opt/roo-code ROO_BIN_DIR=/usr/local/bin curl -fsSL ... | sh
```

**Install a specific version:**

```bash
ROO_VERSION=0.1.0 curl -fsSL https://raw.githubusercontent.com/krzychdre/Tumble-Code/main/apps/cli/install.sh | sh
```

**Offline machines and flaky networks:**

The installer never stalls on a bad network. It checks the npm registry with a short timeout before installing, every
`npm install` runs under a wall-clock budget (default 180 seconds) with a progress heartbeat, npm's output is kept and
shown when something fails, and the new release is staged first - a failed install leaves an existing installation
untouched.

```bash
ROO_NPM_TIMEOUT=300 curl -fsSL ... | sh      # allow more time on a slow link
ROO_CONNECT_TIMEOUT=30 curl -fsSL ... | sh   # allow more time to connect
```

### Updating

Re-run the install script to update to the latest version:

```bash
curl -fsSL https://raw.githubusercontent.com/krzychdre/Tumble-Code/main/apps/cli/install.sh | sh
```

Or run:

```bash
tumble upgrade
```

### Checking the installation

```bash
tumble doctor
```

`doctor` prints one line per check, `[pass]`, `[warn]` or `[fail]`: the Node.js version (22 or newer), the extension
bundle (`--extension <dir>` checks another one), the ripgrep binary the file search uses, the global MCP servers file
and whether the cloud API (`TUMBLE_CODE_API_URL`, default `https://app.tumblecode.dev`) answers within 3 seconds. It exits
with 1 when a check fails. An unreachable cloud is only a warning: sessions run without it.

After a crash the CLI prints the error, the path of the debug log (`~/.roo/cli-debug.log`) and, when the run had no
`--debug`, a hint to run again with it so the log gets written.

### Uninstalling

```bash
rm -rf ~/.roo/cli ~/.local/bin/tumble
```

### Development Installation

For contributing or development:

```bash
# From the monorepo root.
pnpm install

# Build the main extension first.
pnpm --filter roo-cline bundle

# Build the CLI.
pnpm --filter @tumble-code/cli build
```

## Usage

### Interactive Mode (Default)

By default, the CLI auto-approves actions and runs in interactive TUI mode:

```bash
export OPENROUTER_API_KEY=sk-or-v1-...

tumble -w ~/Documents/my-project "What is this project?"
```

Options go before the prompt. Anything after the prompt is treated as an
extra argument, and the CLI stops with `error: too many arguments` instead of
silently ignoring it.

You can also run without a prompt and enter it interactively in TUI mode:

```bash
tumble -w ~/Documents/my-project
```

In interactive mode (see [Terminal UI](#terminal-ui) for the full visual grammar and keyboard reference):

- Tool executions are auto-approved
- Commands are auto-approved
- Followup questions show suggestions with a 60-second timeout, then auto-select the first suggestion
- Browser and MCP actions are auto-approved, every MCP tool included, whether or not its server's config lists it under `alwaysAllow`

### Resuming a task

`tumble --resume` starts with a picker of this workspace's earlier tasks; inside a session `/resume` (or typing `#`)
opens the same picker. `-c` resumes the most recent task directly, `--session-id <id>` a given one.

### Copying and exporting

`/copy` puts the last answer on the clipboard and `/copy code` only its last fenced code block. The CLI sends the text
with the OSC 52 terminal escape, which most modern terminals accept (under tmux set `set -g set-clipboard on`); it
cannot tell whether the terminal took it, so if the clipboard stays empty use `/export`. `/export` saves the
conversation as Markdown, by default to `tumble-export-YYYY-MM-DD-HHMMSS.md` in the workspace, or to the file you name
(relative to the workspace); it never overwrites a file and prints the path it wrote.

### Approval-Required Mode (`--require-approval`)

If you want manual approval prompts, enable approval-required mode:

```bash
tumble --require-approval -w ~/Documents/my-project "Refactor the utils.ts file"
```

During an interactive session, use `/permissions` to see the current approval
mode and the available options. Select automatic approval with `/permissions
allow` or manual approval with `/permissions ask` without restarting the CLI.
The command changes only the active session; startup flags and saved CLI
settings still determine the initial mode of the next session.

To change the model while the session runs, type `/model`: it opens a list
of the models of `~/.roo/cli-settings.json` (their `models` entries, and the
model in use when it has none), titled with the mode it changes, the one in
use marked, each with its reasoning effort, context window and size, and
"text only" for a model that cannot see images.

```
╭───────────────────────────────────────────────────╮
│ Model for code mode                               │
│ ❯ ● GLM-5.3-NVFP4 (reasoning max, 262,144 tokens, text only) │
│     Qwen3.8-27B (262,144 tokens)                             │
│     Qwen3.8-4B (32,768 tokens, compact)                      │
│                                                              │
│ ↑↓ select · enter switch · esc close                         │
╰──────────────────────────────────────────────────────────────╯
```

It opens on the model in use. `↑`/`↓` move, `Enter` switches to the
highlighted model (on the one in use it only closes the list), `Esc` closes
it without a change; Shift+Tab does not change the mode while the list is
open. With no `models` entries to choose from, `/model` prints the model in
use and how to add entries instead.

`/model <id>` does the same switch without the list. Either way `<id>` runs in
the current mode at once, with what its `models` entry says (reasoning effort,
context window, prices, returned reasoning, connection); the next request goes
to it, while a reply already streaming finishes on the old model. Other modes
keep their models. Any id the provider serves works with `/model <id>`, also
one without an entry (for the `openai` provider it then runs with a
128,000-token window, no prices and no reasoning effort, and the CLI says so).

Like a mode in VS Code keeps the API profile chosen in it, the mode keeps the
model: a switch from the list or from `/model <id>` saves the choice in
`~/.roo/cli-settings.json`, so later sessions run `<id>` in that mode too,
and the confirmation names the key it went to:

- where the file names the mode's model in `modes.<mode>.model`, that value
  is changed in place;
- otherwise the mode is added to the `modes` list of the model's `models`
  entry (see [Settings per mode](#settings-per-mode)), creating the entry when
  needed, and taken out of the list of the model it ran before.

Nothing else in the file changes. The file is read again right before the
write, so an edit you made during the session is kept, and it is replaced
atomically with its permissions (a `chmod 600` file stays `600`); it is
written with tab indentation. `/model` with the model the mode already runs
writes nothing. A run with `--provider`, `--model`, `--base-url` or
`--api-key` (which ignores the file's mode models) and an `--ephemeral` run
switch for the session only and say so. When the write fails, the switch
still holds for the session and the message names the error.

In approval-required mode:

- Tool, command, browser, and MCP actions prompt for yes/no approval
- Followup questions wait for manual input (no auto-timeout)

### Print Mode (`--print`)

Use `--print` for non-interactive execution and machine-readable output:

```bash
# Prompt is required
tumble --print "Summarize this repository"

# Create a new task with a specific session ID (UUID)
tumble --print --create-with-session-id 018f7fc8-7c96-7f7c-98aa-2ec4ff7f6d87 "Summarize this repository"
```

## Terminal UI

The interactive TUI uses a **print-and-forget transcript** model inspired by Claude Code. Finalized messages are written once into your terminal's native scrollback via ink's `<Static>`; only the dynamic tail (in-flight message, spinner, dialogs, input) re-renders. There is no in-app scroll viewport — use your terminal's native scrollback (mouse wheel, Shift+PgUp, tmux copy-mode) to review history.

### Visual grammar

```
✻ Welcome to Tumble Code v0.1.17                ← welcome banner (brand orange ✻)

  cwd: ~/Projekty/QUB-IT/Roo-Code                 dim, indent 2
  openai · gpt-5 [medium] · mode: code            dim, indent 2

❯ fix the failing test in foo.ts                ← user turn: subtle bg band + pointer

● I'll look at the test file first.             ← assistant: bullet + markdown

● Read(src/foo.test.ts)                         ← tool call: status bullet + bold name(args)
  ⎿  Read 42 lines                              ← tool result: ⎿ connector, dim

∴ Thinking…                                     ← collapsed thinking, dim italic

✳ Rummaging… (esc to interrupt · total 2m 05s · step 12s · ↓ 1.2k tokens)   ← spinner while loading

────────────────────────────────────────────────  ← input frame top border
 ❯ type your message…                             ← prompt char + input
────────────────────────────────────────────────  ← input frame bottom border
  ? for shortcuts                  code · gpt-5 · 38%   ← footer: hints left, status right
```

| Glyph | Meaning                                                                                                |
| ----- | ------------------------------------------------------------------------------------------------------ |
| `✻`   | Welcome banner (brand orange)                                                                          |
| `❯`   | User-prompt rows and the input prompt char (subtle/prompt-border color)                                |
| `●`   | Assistant messages and tool-call status bullets (color: running = blink, success = green, error = red) |
| `⎿`   | Tool-result connector (dim)                                                                            |
| `∴`   | Collapsed thinking (dim italic)                                                                        |
| `✳`  | Spinner frame (brand orange, ping-pong animation) with a word + turn and step time + tokens out        |

User-prompt rows render on a subtle background band. Assistant text is rendered as markdown (bold, italic, inline code, fenced code blocks, lists, blockquotes, links). Tool results are dim and truncated to 5 lines with a `… +N lines` tail. The spinner cycles through a whimsical verb (`Pondering`, `Rummaging`, `Brewing`, `Tumbling`, …) chosen deterministically per turn.

### Images

In a terminal that can draw images, an image the answer puts on a line of its own (`![chart](out/chart.png)`, a
path relative to the workspace) is drawn in the transcript. The CLI asks the terminal at startup which image
protocol it speaks:

| Terminal                         | Protocol | Notes                                                                                         |
| -------------------------------- | -------- | --------------------------------------------------------------------------------------------- |
| kitty, Ghostty, WezTerm, Konsole | kitty    |                                                                                               |
| iTerm2                           | iTerm2   |                                                                                               |
| VS Code terminal                 | sixel    | Needs `"terminal.integrated.enableImages": true`.                                             |
| GNOME Terminal, Ptyxis           | none     | VTE 0.84 has no image support: its sixel code is stubbed out and `enable-sixel` does nothing. |
| xterm                            | sixel    | Start it with `-ti vt340`; `-xrm 'XTerm*numColorRegisters: 256'` gives full colour.           |
| foot                             | sixel    |                                                                                               |

Elsewhere, and in the live area at the bottom while an answer streams, the image reads `[image: chart] out/chart.png`.

A ` ```mermaid ` block in an answer is drawn as a diagram: as an image in those terminals, and in box-drawing
characters everywhere else (plain terminals, and the live area while the answer streams). Flowcharts, state,
sequence, class and ER diagrams and XY charts are supported; other kinds, a diagram wider than the terminal in text
form, and a block that is still streaming show the code.
`TUMBLE_IMAGES=off` turns images off; `TUMBLE_IMAGES=kitty|iterm|sixel` forces a protocol, for example inside tmux
with passthrough enabled.

The theme is the Tumble "Hardcore" palette mapped to Claude Code's semantic key system: brand orange for the `✻` welcome glyph and spinner, permission purple for dialog borders and focused select rows, subtle gray for `❯` prompt chars and `⎿` connectors, and a dark background band for user turns.

### Keyboard shortcuts

| Key            | Action                                                                |
| -------------- | --------------------------------------------------------------------- |
| `Ctrl+C` twice | Exit the CLI                                                          |
| `Shift+Tab`    | Cycle modes (code → architect → ask → debug → …)                      |
| `Ctrl+T`       | Toggle the TODO viewer                                                |
| `Ctrl+R`       | Search previous prompts (again for older; `Enter` fills the prompt)   |
| `Esc`          | Cancel a running task, or close the TODO viewer, a panel, or a dialog |
| `y` / `n`      | Approve / reject in approval dialogs (accelerators)                   |
| `↑` / `↓`      | Navigate autocomplete picker and dialog lists                         |
| `1`-`9`        | Jump-select a numbered option in dialogs                              |
| `Enter`        | Confirm the focused option                                            |

### Approval dialogs

When `--require-approval` is active, actions prompt for yes/no approval in a permission-bordered box (purple round border) with a bold title (`Bash command`, `Write file`, `MCP tool`, …), the relevant details (command, path, server+tool), and a numbered `1. Yes` / `2. No` list. Press `y` or `n` for the legacy accelerators, or use `↑`/`↓` + `Enter`, or `1`/`2` to jump-select.

### Followup questions

When the agent asks a followup question, a permission-bordered dialog renders the question as a bold title, numbered suggestions, and a final `Type my own answer…` option. An auto-accept countdown (`Auto-selecting "{label}" in {n}s — press any arrow key to cancel`) runs at the bottom; press any arrow key to cancel and choose manually. Selecting `Type my own answer…` reveals the input area for a free-form reply.

## Options

| Option                                  | Description                                                                                                             | Default                                                                                                                       |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `[prompt]`                              | Your prompt (positional argument, optional)                                                                             | None                                                                                                                          |
| `--prompt-file <path>`                  | Read prompt from a file instead of command line argument                                                                | None                                                                                                                          |
| `--create-with-session-id <session-id>` | Create a new task using the provided session ID (UUID)                                                                  | None                                                                                                                          |
| `-w, --workspace <path>`                | Workspace path to operate in                                                                                            | Current directory                                                                                                             |
| `-p, --print`                           | Print response and exit (non-interactive mode)                                                                          | `false`                                                                                                                       |
| `-e, --extension <path>`                | Path to the extension bundle directory                                                                                  | Auto-detected                                                                                                                 |
| `-d, --debug`                           | Enable debug output (includes detailed debug information, prompts, paths, etc)                                          | `false`                                                                                                                       |
| `-a, --require-approval`                | Require manual approval before actions execute                                                                          | `false`                                                                                                                       |
| `-k, --api-key <key>`                   | API key for the LLM provider (keyless providers ignore it)                                                              | From env var                                                                                                                  |
| `--provider <provider>`                 | API provider (anthropic, openrouter, ollama, gemini, etc.)                                                              | `openrouter`                                                                                                                  |
| `-m, --model <model>`                   | Model to use (openrouter: `anthropic/claude-opus-4.6`; openai, ollama, lmstudio: required)                              | Provider default                                                                                                              |
| `--base-url <url>`                      | Base URL override for the selected provider (when supported)                                                            | None                                                                                                                          |
| `--mode <mode>`                         | Mode to start in (code, architect, ask, debug, etc.)                                                                    | Settings, else `code`                                                                                                         |
| `--terminal-shell <path>`               | Absolute shell path for inline terminal command execution                                                               | Auto-detected shell                                                                                                           |
| `-r, --reasoning-effort <effort>`       | Reasoning effort level for every model of the run (unspecified, disabled, none, minimal, low, medium, high, xhigh, max) | The model's entry, else a Claude model's own default (anthropic, vertex, bedrock), else `medium` (`unspecified` for `openai`) |
| `--consecutive-mistake-limit <n>`       | Consecutive error/repetition limit before guidance prompt (`0` disables the limit)                                      | `10`                                                                                                                          |
| `--command-execution-timeout <seconds>` | Seconds a shell command may run before it is stopped (`0` means no limit)                                               | Settings, else `300`                                                                                                          |
| `--ephemeral`                           | Run without persisting state (uses temporary storage)                                                                   | `false`                                                                                                                       |
| `--oneshot`                             | Exit upon task completion                                                                                               | `false`                                                                                                                       |
| `--output-format <format>`              | Output format with `--print`: `text`, `json`, or `stream-json`                                                          | `text`                                                                                                                        |

## Auth Commands

### ChatGPT Plus/Pro (OpenAI Codex OAuth)

ChatGPT subscription access is separate from usage billed through an
`OPENAI_API_KEY`. Sign in once, then select the `openai-codex` provider:

```bash
tumble auth codex login
tumble --provider openai-codex --model gpt-5.6-sol
```

The browser flow supports eligible ChatGPT Plus, Pro, Team, and Enterprise
accounts. The authorization URL is always printed for remote/headless shells.
The callback listener uses `127.0.0.1:1455`, so when the CLI runs over SSH that
port must reach the machine running the CLI. `--ephemeral` is intentionally not
supported because it discards the OAuth credential store.

| Command                    | Description                                      |
| -------------------------- | ------------------------------------------------ |
| `tumble auth codex login`  | Sign in with an eligible ChatGPT subscription    |
| `tumble auth codex logout` | Remove stored OpenAI Codex credentials           |
| `tumble auth codex status` | Show the OpenAI Codex subscription sign-in state |

### Tumble Code Cloud

Signing in to a Tumble Code Cloud is optional. While signed in, every run sends
the same data the VS Code extension sends (`LLM Completion` events with tokens,
cost, model and mode, exceptions, error reports and, when switched on in the
cloud, LLM exchanges); signed out, it sends nothing. Name the cloud first, in
`~/.roo/cli-settings.json` (or with the `TUMBLE_CODE_API_URL` environment
variable):

```json
{ "cloudApiUrl": "https://cloud.example.com" }
```

```bash
tumble auth cloud login
tumble auth cloud status
```

`login` prints the sign-in URL and opens it in the browser. After you sign in,
the browser comes back to a one-shot listener on `127.0.0.1` (a random port,
open for at most 5 minutes; Ctrl+C cancels) and the CLI stores the session.
When the browser runs on another machine (an SSH session), it cannot reach that
listener: copy the address it ends on (it contains `/auth/clerk/callback?code=`)
from its address bar and paste it into the terminal. The session lives in the
CLI's extension storage (`~/.vscode-mock/global-storage/secrets.json`, readable
only by you), so a `--ephemeral` run is always signed out.

| Command                    | Description                                                                          |
| -------------------------- | ------------------------------------------------------------------------------------ |
| `tumble auth cloud login`  | Sign in to the configured Tumble Code Cloud in the browser                           |
| `tumble auth cloud logout` | Sign out and remove the stored session                                               |
| `tumble auth cloud status` | Show whether you are signed in, as whom, and to which cloud (exit 1 when signed out) |

In an interactive session, `/login` does the same without leaving the CLI: the
sign-in URL and the result appear in the transcript, and the footer shows the
cloud status. From an SSH session, copy the address the browser ends on and
type `/login <callback-url>` (not the cloud server address, which goes in `cloudApiUrl`). `/logout` signs out. The cloud URL is read when the
CLI starts, so restart it after changing `cloudApiUrl`.

## Settings File

`~/.roo/cli-settings.json` holds your defaults, so a bare `tumble` needs no
flags. You write it; the CLI changes it in one place only: `/model` saves the
model it gives a mode (see [Usage](#usage)), and the VS
Code extension never changes it. Flags apply to the run they are given on and are never saved. When no
provider is configured anywhere, the interactive session starts on `openrouter`
and prints a one-line hint saying where to set one.

```json
{
	"provider": "openai",
	"baseUrl": "http://192.168.50.194:11111/v1",
	"model": "GLM-5.3-Flash-NVFP4",
	"apiKey": "1111",
	"mode": "code",
	"models": {
		"GLM-5.3-Flash-NVFP4": { "reasoningEffort": "high" }
	}
}
```

| Key                       | Meaning                                                           |
| ------------------------- | ----------------------------------------------------------------- |
| `provider`                | Provider id, as for `--provider`                                  |
| `model`                   | Model id; used only while `provider` is the active provider       |
| `baseUrl`                 | Base URL; used only while `provider` is the active provider       |
| `apiKey`                  | API key; used only while `provider` is the active provider        |
| `apiKeyEnv`               | Name of the env var holding the key, instead of `apiKey`          |
| `mode`                    | Mode a new session starts in                                      |
| `requireApproval`         | `true` asks before actions, as `--require-approval`               |
| `consecutiveMistakeLimit` | As for `--consecutive-mistake-limit`                              |
| `commandExecutionTimeout` | Seconds, as for `--command-execution-timeout`; see the note below |
| `oneshot`                 | `true` exits when the task completes, as `--oneshot`              |
| `modes`                   | Settings per mode, see below                                      |
| `models`                  | Per model: connection, effort, window, prices, images, size       |
| `mcpSettingsPath`         | File with the global MCP servers, see [MCP Servers](#mcp-servers) |
| `cloudApiUrl`             | Cloud API URL, see [Tumble Code Cloud](#tumble-code-cloud)        |
| `timeZone`                | IANA zone such as `Europe/Warsaw`, see the note below             |

[`examples/cli-settings.example.json`](examples/cli-settings.example.json) sets
every one of these keys, with each explained in
[`examples/README.md`](examples/README.md).

Times the CLI shows (`tumble list`, `/export`) and the current time the model
is told are local. The zone comes from `TZ`, else the system (`/etc/localtime`);
a container without either runs in UTC. Set `timeZone` there; it overrides `TZ`.

The file may hold an API key, so keep it readable only by you (`chmod 600
~/.roo/cli-settings.json`); the CLI warns when other users can read it. To keep
the key out of the file, use `"apiKeyEnv": "MY_KEY_VAR"` instead: the CLI reads
the key from that variable and stops with an error naming it when it is unset.

Precedence: flag > settings file > built-in default. Provider, model and base
URL also fall back to the CLI's own extension state in
`~/.vscode-mock/global-storage` before the built-in default.

Note on `commandExecutionTimeout`: a shell command the agent runs is stopped
once it has run this many seconds (default 300), and the model is told not to
run it again. Raise it for long jobs such as builds or scrapers, or set `0` for
no limit (you can still stop a command yourself). The value is whole seconds,
at most 2147483; anything else stops the run at startup, because the extension
would read `"10m"` as no limit and a larger number as an instant timeout. The
model's own `timeout` parameter does not extend it.

### Settings per mode

`modes` gives a mode its own provider settings. An entry names only what it
changes and inherits the rest from the top level; switching modes (by you, by
the model, or into a subtask) applies the entry of the new mode, and modes
without an entry use the top level.

```json
{
	"provider": "openai",
	"baseUrl": "http://192.168.50.194:11111/v1",
	"apiKey": "1111",
	"model": "GLM-5.3-Flash-NVFP4",
	"modes": {
		"architect": { "model": "GLM-5.3-NVFP4" },
		"ask": { "provider": "openai-codex", "model": "gpt-5.6-sol" }
	}
}
```

- An entry may set `provider`, `model`, `baseUrl`, `apiKey` and `apiKeyEnv`.
  Keys are mode slugs as listed by `tumble list modes`. The reasoning effort
  comes with the model, from its `models` entry (see below).
- An entry that names a different provider inherits none of the top-level
  `model`, `baseUrl` or key, which belong to the top-level provider; it gets
  that provider's defaults unless it sets them (`ask` above).
- Every entry is checked at startup, so a missing key or an invalid value fails
  immediately and names the mode.
- Passing any of `--provider`, `--model`, `--base-url` or `--api-key` makes
  that run use one configuration for every mode: the flags on top of the top
  level, with `modes` ignored. `--reasoning-effort` keeps the modes and sets
  the level for every model of the run.
- When you switch modes (Shift+Tab or the `!` picker), the notice names the
  model the new mode runs with, `/model` changes included:
  `Switched to Architect (GLM-5.3-NVFP4)`. The footer shows the model in use
  after any switch, also one the model or a subtask makes.
- The built-in `vision` mode describes images for modes whose model cannot
  see them, so it needs a model that can: give it one with an entry such as
  `"vision": { "model": "qwen3.6-35b" }`. When `read_file` meets an image the
  current model cannot see, the note it returns names the modes whose model
  can, and the model can hand the image to one of them with `new_task`.

A model can name its modes itself: `modes` in its `models` entry lists the
slugs of the modes that run it. This is the same as writing
`"modes": { "<slug>": { "model": "<id>" } }` for each of them, so a listed
mode gets the model when the session starts in it, on every mode switch, in
subtasks and on resume, together with the model's own connection, reasoning
effort and size:

```json
{
	"provider": "openai",
	"baseUrl": "http://192.168.50.194:11111/v1",
	"apiKey": "1111",
	"model": "GLM-5.3-NVFP4",
	"models": {
		"GLM-5.3-NVFP4": { "reasoningEffort": "high" },
		"Qwen3.8-27B": { "reasoningEffort": "xhigh", "modes": ["code", "debug"] }
	}
}
```

- `code` and `debug` run `Qwen3.8-27B`; every other mode runs the top-level
  `GLM-5.3-NVFP4`.
- A `modes` entry for a listed mode still applies; the list only supplies its
  `model`. Naming the same model in both places is fine.
- A mode runs one model, so the run stops at startup when two models list the
  same mode, or when a model lists a mode whose `modes` entry names another
  model; the error names both places. Errors about a listed mode name
  `models.<id>.modes`.
- Like `modes`, the lists are ignored for a run given any of `--provider`,
  `--model`, `--base-url` or `--api-key`.
- `/model` shows each model's modes next to its other settings, and
  `/model <id>` writes these lists when it saves a choice.

### Connection per model

A model served somewhere else than the top level says, on another server or by
another provider, carries its own connection in its `models` entry:
`provider`, `baseUrl`, `apiKey` and `apiKeyEnv`, the same keys as at the top
level and in `modes`.

```json
{
	"provider": "openai",
	"baseUrl": "http://192.168.50.194:11111/v1",
	"apiKey": "1111",
	"model": "GLM-5.3-Flash-NVFP4",
	"modes": {
		"debug": { "model": "Qwen3.8-4B" },
		"ask": { "model": "claude-sonnet-5-5" }
	},
	"models": {
		"Qwen3.8-4B": { "baseUrl": "http://192.168.50.194:22222/v1" },
		"claude-sonnet-5-5": { "provider": "anthropic", "apiKeyEnv": "ANTHROPIC_API_KEY" }
	}
}
```

- The entry's connection applies wherever the model runs: the top level, a
  mode entry, `--model` and `/model`. It overrides the top level and the mode
  entry; only the flags (`--provider`, `--base-url`, `--api-key`) override it.
- An entry that names only a `baseUrl` or a key keeps the provider of the
  level it runs in and inherits what it does not set (`Qwen3.8-4B` above keeps
  `openai` and the key `1111`). An entry that names a different provider
  inherits no base URL or key, as a mode entry does (`claude-sonnet-5-5` reads
  its key from `ANTHROPIC_API_KEY`).
- `/model` switches the connection with the model: to the entry's provider and
  server, and back to the mode's for a model without a connection of its own.
- Every entry with a connection is checked at startup, so a missing key or a
  base URL its provider has no field for fails at once and names the model.
  An `apiKey` here counts for the `chmod 600` warning like any other.

### Reasoning effort per model

How much a reasoning model thinks before it answers is set per model, because
the levels are the model's own: GLM-5.3 accepts `low`, `high` and `max`, while
another model on the same server rejects `max`. `reasoningEffort` in the
model's `models` entry takes any level of `--reasoning-effort`:

```json
{
	"models": {
		"GLM-5.3-NVFP4": { "reasoningEffort": "max" },
		"Qwen3.8-27B": { "reasoningEffort": "high" }
	}
}
```

- The level follows the model wherever it runs: the top level, a `modes` entry,
  `--model` or `/model`. A model without an entry gets nothing for the `openai`
  (OpenAI-compatible) provider, which knows nothing about its models and so
  sends `reasoning_effort` only when one is configured, and `medium` for every
  other provider.
- It works with every provider, not only `openai`. For most providers it
  reaches the model only when the provider's model information says the model
  supports a reasoning effort; for `openai` the CLI sends exactly what you
  configure (GLM models also get their thinking switch from it).
- `--reasoning-effort` sets one level for every model of that run, so
  `tumble --reasoning-effort low` sends `low` even where an entry says `max`.
  The welcome line shows the level in use in brackets after the model.
- `reasoningEffort` at the top level or in a `modes` entry, where it used to
  live, is ignored with a warning at startup that names the model entry to move
  it to. A level that is not one of `--reasoning-effort`'s fails at startup and
  names the model.

### Context window per model

An OpenAI-compatible server (the `openai` provider) lists its models without
their sizes, so without help the CLI assumes 128,000 tokens for every one of
them. That number decides when the conversation is condensed (summarised to
free room) and what the footer's context bar measures against. `models` tells
the CLI the real size, keyed by the model id exactly as the server names it:

```json
{
	"provider": "openai",
	"baseUrl": "http://192.168.50.194:11111/v1",
	"model": "GLM-5.3-NVFP4",
	"models": {
		"GLM-5.3-NVFP4": { "contextWindow": 262144 }
	}
}
```

- An entry applies wherever its model runs: the top level, a `modes` entry,
  `--model` or `/model`.
- Use the size the server actually serves (for vLLM, its `--max-model-len`),
  which can be smaller than what the model supports. Condensing starts when the
  context passes about 90% of this size.
- Only the `openai` provider takes the size from here. Other providers size
  their models from their own model lists; an entry for a model one of them
  runs is ignored with a warning at startup.
- A size that is not a whole number above 0 fails at startup and names the
  model.

### Prices per model

The same server lists no prices either, so every request of an `openai` model
costs $0: the task cost in `--output-format json` and the cost sent to Tumble
Code Cloud (the metrics and cost pages) stay at zero. The same `models` entry
takes the prices the VS Code settings set for an OpenAI-compatible model, in
US dollars per million tokens:

```json
{
	"models": {
		"GLM-5.3-NVFP4": {
			"contextWindow": 262144,
			"inputPrice": 0.6,
			"outputPrice": 2.2,
			"cacheReadsPrice": 0.11
		}
	}
}
```

| Key                | Charged for                                                    |
| ------------------ | -------------------------------------------------------------- |
| `inputPrice`       | input tokens not served from the server's prompt cache         |
| `outputPrice`      | output tokens, reasoning included                              |
| `cacheReadsPrice`  | input tokens the server reports as read from its prompt cache  |
| `cacheWritesPrice` | input tokens the server reports as written to its prompt cache |

- A price left out counts as 0, except `cacheWritesPrice`, which falls back to
  `inputPrice`.
- For a model on your own hardware there is no bill; set the prices of a
  comparable hosted model if you want the cloud to show what the work would
  have cost there.
- Like the size, prices apply wherever the model runs and only with the
  `openai` provider; other providers price their models from their own lists,
  and an entry for one of their models is ignored with a warning at startup.
- A price that is not a number of 0 or more fails at startup and names the
  model and the key.

### Returning reasoning to the model

A reasoning model thinks before it answers, and by default the CLI keeps that
reasoning to itself: the next request carries only the model's answers and tool
calls. A model built for interleaved (preserved) thinking, such as GLM-5.3,
works better when it sees what it thought in earlier turns. `preserveReasoning`
in the model's `models` entry sends that reasoning back with every request, the
same as "Return reasoning to the model" in the VS Code settings:

```json
{
	"models": {
		"GLM-5.3-Flash-NVFP4": { "contextWindow": 1048576, "preserveReasoning": true }
	}
}
```

- Each earlier answer carries its reasoning in both `reasoning_content` (the
  name the Z.ai and DeepSeek APIs read) and `reasoning` (the name vLLM reads).
  For a GLM model the request also asks the server to keep it
  (`thinking.clear_thinking: false`).
- It is a property of the model and its server, so it lives in `models` and
  follows the model through every mode that runs it. It defaults to `false`.
- The reasoning counts as input, so requests grow; leave it off for a model or
  server that does not read it back.
- Like the size and the prices, it applies only with the `openai` provider. A
  value other than `true` or `false` fails at startup and names the model.

Returned reasoning fills the context window: in tasks with a lot of thinking it
was 20-38% of the history sent to the model. `trimOldReasoning` shortens it
once the context fills up, the same as "Shorten old reasoning when the context
fills up" in the VS Code settings:

```json
{
	"models": {
		"GLM-5.3-Flash-NVFP4": { "preserveReasoning": true, "trimOldReasoning": true }
	}
}
```

- Nothing changes until the context reaches the point where the CLI would
  otherwise start freeing room (cutting old tool results, then condensing).
  Then the long reasoning blocks of older turns are shortened first, oldest
  first, until enough room is free; the reasoning of the last three answers
  and blocks under about 500 tokens stay whole.
- A shortened block keeps its beginning, its last paragraph and every
  paragraph that states a finding ("found", "root cause", "confirmed" and the
  like); a note in its place says how many paragraphs were left out. In
  measured tasks that kept about half of the reasoning.
- Only the copy sent to the model changes: the task history keeps every block
  whole. A block once shortened is shortened the same way in every later
  request, so the server's prompt cache keeps matching.
- It needs `preserveReasoning`: without it no reasoning is sent back and there
  is nothing to shorten. It defaults to `false`, applies only with the
  `openai` provider, and a value other than `true` or `false` fails at startup
  and names the model.

### Text-only models

An OpenAI-compatible server does not say whether a model can see images, and
the CLI assumes every `openai` model can. A text-only model such as GLM-5.3
should say so with `supportsImages: false`, so that it hands an image to a mode
whose model can see it (a vision mode) instead of receiving an image it cannot
read:

```json
{
	"models": {
		"GLM-5.3-NVFP4": { "contextWindow": 262144, "supportsImages": false },
		"Qwen3.8-27B": { "contextWindow": 262144, "supportsImages": true, "modes": ["vision"] }
	}
}
```

- When the text-only model reads an image with `read_file`, it gets a note
  instead of the image. The note names the modes whose model can see images
  (here `vision`, which runs `Qwen3.8-27B`) and tells the model to delegate the
  image there with `new_task`, or, when no mode can, to go on without it.
- A mode counts as seeing images when the model it runs does: its own model
  (from `modes.<mode>.model` or a `modes` list in `models`), else the top-level
  model. With a text-only top-level model, only the modes bound to a model with
  `supportsImages: true` (or with no `supportsImages` at all) are named.
- Images already in the conversation, for example from an earlier mode, are
  replaced with a short text note in every request to a text-only model.
- An image you name with `@` in the prompt is not shown to a text-only model
  either: it sees the path, and reading the file gets it the note above.
- It defaults to `true`. Like the size and the prices it applies only with the
  `openai` provider: other providers know from their own model lists which
  models see images, and an entry for one of their models is ignored with a
  warning at startup. A value other than `true` or `false` fails at startup and
  names the model.
- `/model` lists a model with `supportsImages: false` as "text only".

### Model size

A small model gets lost in the full system prompt and the full tool list.
`modelSize` in the model's `models` entry picks how much of both it gets, the
same choice as "Model size" in the VS Code profile settings:

```json
{
	"models": {
		"Qwen3.8-4B": { "contextWindow": 32768, "modelSize": "compact" },
		"Qwen3.8-27B": { "modelSize": "slim", "hideMcp": false }
	}
}
```

| Value      | What the model gets                                                                                                                                                        |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `standard` | the full system prompt and every tool (the default)                                                                                                                        |
| `slim`     | the full system prompt and one obvious tool per job, without the alternative edit tools, parallel tasks and slash commands; MCP tools are hidden unless `hideMcp` is false |
| `compact`  | for very small models: a short system prompt, a minimal tool set with simple editing, shorter environment details, tighter output limits and no subtasks or MCP tools      |

- Unlike the size and the prices it works with every provider, and it follows
  the model through every mode and through `/model`.
- `/model` lists a `slim` or `compact` model with its size.
- A value other than these three fails at startup and names the model;
  `hideMcp` must be `true` or `false`.

## MCP Servers

The CLI connects the same MCP servers as the VS Code extension, from two files
in the same format:

| Scope   | File                      | Applies to                       |
| ------- | ------------------------- | -------------------------------- |
| Global  | `~/.roo/mcp.json`         | every workspace                  |
| Project | `<project>/.roo/mcp.json` | sessions started in that project |

```json
{
	"mcpServers": {
		"searxNcrawl": { "type": "streamable-http", "url": "http://localhost:9555/mcp" },
		"agent-interchange": { "command": "node", "args": ["/path/to/mcp-server.mjs"] }
	}
}
```

A project server wins over a global server with the same name. The global file
is created empty on the first run when it does not exist, and it is used by
`--ephemeral` runs as well.

The VS Code extension keeps its own global list in its storage
(`~/.config/Code/User/globalStorage/qub-it.tumble-code/settings/mcp_settings.json`
on Linux). To give the CLI the same list, point `mcpSettingsPath` in
`cli-settings.json` at that file; a leading `~` is the home directory and a
relative path is taken from `~/.roo`. Both then read and write the same file,
so a server disabled in the VS Code MCP view is disabled in the CLI too. The
per-tool "always allow" lists in that file do not matter to the CLI: `allow`
mode approves every MCP tool and `--require-approval` asks for each one.

### Managing servers: `/mcp`

`/mcp` opens a panel with every MCP server of the session, project servers
first:

```
╭──────────────────────────────────────────────────────────────╮
│ MCP servers                                                  │
│   ● projsrv project connected · 9 tools                      │
│ ❯ ● broken  project failed                                   │
│   ● globsrv global  connected · 9 tools                      │
│   ● offsrv  global  disabled                                 │
│                                                              │
│ broken · project · /work/app/.roo/mcp.json                   │
│ Error: spawn /nonexistent/bin/xyz ENOENT                     │
│                                                              │
│ ↑↓ select · r restart · space enable/disable · R reload …    │
╰──────────────────────────────────────────────────────────────╯
```

| Key       | Action                                                             |
| --------- | ------------------------------------------------------------------ |
| `↑` / `↓` | Select a server; its config file and its tools or error show below |
| `r`       | Restart the selected server                                        |
| `space`   | Enable or disable it (written to its config file)                  |
| `R`       | Reload both config files, after you edit them                      |
| `Esc`     | Close the panel (a running task keeps running)                     |

The CLI does not watch the config files, so an edit made during a session
takes effect after `R` in the panel or a restart of the CLI. A server that
fails to start is reported once: a notice in the terminal interface, and a
`[mcp] server "…" failed to start: …` line on stderr in print mode.

## Environment Variables

The CLI supports the same inference providers as the VS Code extension. For
providers that need an API key, the CLI takes it from `--api-key`, then
`apiKey`/`apiKeyEnv` in the settings file, then the environment variable below. Provider selection follows:
`--provider` flag > settings file > the CLI's own extension state > default
(`openrouter`). Keyless providers (lmstudio, bedrock, qwen-code, vertex,
openai-codex) run without any API key; OAuth-backed providers still require
their corresponding login. Ollama runs without a key too, but passes one on
(for a remote or cloud Ollama) when you give it. The providers that need a key
are the ones the extension's settings require one for. openai, ollama and
lmstudio have no default model, so name one with `--model` or `model` in the
settings file.

For providers whose schema has a base-url setting, the CLI also honors a
`*_BASE_URL` environment variable (and a generic `--base-url` flag). The order
is the same as for the key: `--base-url` flag > `baseUrl` in the settings file
(or the mode's override) > the environment variable > the CLI's own extension
state.

| Provider       | API Key Environment Variable  | Base URL Environment Variable |
| -------------- | ----------------------------- | ----------------------------- |
| anthropic      | `ANTHROPIC_API_KEY`           | `ANTHROPIC_BASE_URL`          |
| openai-native  | `OPENAI_API_KEY`              | `OPENAI_BASE_URL`             |
| openai         | `OPENAI_API_KEY`              | `OPENAI_BASE_URL`             |
| openai-codex   | - (`auth codex login`)        | -                             |
| tumble (alias) | - (uses openrouter)           | - (uses openrouter)           |
| gemini         | `GOOGLE_API_KEY`              | `GOOGLE_GEMINI_BASE_URL`      |
| openrouter     | `OPENROUTER_API_KEY`          | `OPENROUTER_BASE_URL`         |
| litellm        | `LITELLM_API_KEY`             | `LITELLM_BASE_URL`            |
| deepseek       | `DEEPSEEK_API_KEY`            | `DEEPSEEK_BASE_URL`           |
| ollama         | `OLLAMA_API_KEY` (optional)   | `OLLAMA_BASE_URL`             |
| lmstudio       | - (keyless)                   | `LMSTUDIO_BASE_URL`           |
| bedrock        | - (AWS credential chain)      | `AWS_BEDROCK_ENDPOINT`        |
| mistral        | `MISTRAL_API_KEY`             | -                             |
| moonshot       | `MOONSHOT_API_KEY`            | `MOONSHOT_BASE_URL`           |
| minimax        | `MINIMAX_API_KEY`             | `MINIMAX_BASE_URL`            |
| qwen-code      | - (OAuth credentials on disk) | -                             |
| vertex         | - (gcloud credential chain)   | -                             |
| xai            | `XAI_API_KEY`                 | -                             |
| zai            | `ZAI_API_KEY`                 | -                             |

Alias: the persisted cloud provider id `tumble` is accepted on the CLI and maps
to the `openrouter` provider settings (`OPENROUTER_API_KEY`, models, base-url);
`--provider tumble` behaves like `--provider openrouter`.

Excluded providers: `vscode-lm` (needs the real VS Code LM API) and `fake-ai`
(hidden internal test provider). Retired providers (groq, huggingface, deepinfra,
cerebras, chutes, doubao, featherless, io-intelligence, gemini-cli and others) are
rejected with a clear error.

**Display Environment Variables:**

| Variable        | Description                                                                              |
| --------------- | ---------------------------------------------------------------------------------------- |
| `NO_COLOR`      | Any non-empty value turns colour off ([no-color.org](https://no-color.org))              |
| `FORCE_COLOR`   | Forces colour on (`1`, `2`, `3`: 16, 256 or 16 million colours) and wins over `NO_COLOR` |
| `TUMBLE_IMAGES` | `off`, or `kitty`/`iterm`/`sixel` to force an image protocol (see [Images](#images))     |

## Architecture

```
┌─────────────────┐
│   CLI Entry     │
│   (index.ts)    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  ExtensionHost  │
│  (extension-    │
│   host.ts)      │
└────────┬────────┘
         │
    ┌────┴────┐
    │         │
    ▼         ▼
┌───────┐  ┌──────────┐
│vscode │  │Extension │
│-shim  │  │ Bundle   │
└───────┘  └──────────┘
```

## How It Works

1. **CLI Entry Point** (`index.ts`): Parses command line arguments and initializes the ExtensionHost

2. **ExtensionHost** (`extension-host.ts`):

    - Creates a VSCode API mock using `@tumble-code/vscode-shim`
    - Intercepts `require('vscode')` to return the mock
    - Loads and activates the extension bundle
    - Manages bidirectional message flow

3. **Message Flow**:
    - CLI → Extension: `emit("webviewMessage", {...})`
    - Extension → CLI: `emit("extensionWebviewMessage", {...})`

## Development

```bash
# Run directly from source (no build required)
pnpm dev --provider openrouter --api-key $OPENROUTER_API_KEY --print "Hello"

# Run tests
pnpm test

# Type checking
pnpm check-types

# Linting
pnpm lint
```

## Releasing

Official releases are created via the GitHub Actions workflow at `.github/workflows/cli-release.yml`.

To trigger a release:

1. Go to **Actions** → **CLI Release**
2. Click **Run workflow**
3. Optionally specify a version (defaults to `package.json` version)
4. Click **Run workflow**

The workflow will:

1. Build the CLI on all platforms (macOS Apple Silicon, Linux x64)
2. Create platform-specific tarballs with bundled ripgrep
3. Verify each tarball
4. Create a GitHub release with all tarballs attached

### Local Builds

For local development and testing, use the build script. It writes the tarball to the git-ignored `bin/` directory at the repository root (for example `bin/tumble-cli-linux-x64.tar.gz`):

```bash
# Build tarball for your current platform
./apps/cli/scripts/build.sh

# Build and install locally
./apps/cli/scripts/build.sh --install

# Fast build (skip verification)
./apps/cli/scripts/build.sh --skip-verify
```
