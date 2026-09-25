# @tumble-code/cli

Command Line Interface for Tumble Code - Run the Tumble Code agent from the terminal without VSCode.

## Overview

This CLI uses the `@roo-code/vscode-shim` package to provide a VSCode API compatibility layer, allowing the main Tumble Code extension to run in a Node.js environment.

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

### Updating

Re-run the install script to update to the latest version:

```bash
curl -fsSL https://raw.githubusercontent.com/krzychdre/Tumble-Code/main/apps/cli/install.sh | sh
```

Or run:

```bash
tumble upgrade
```

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

tumble "What is this project?" -w ~/Documents/my-project
```

You can also run without a prompt and enter it interactively in TUI mode:

```bash
tumble -w ~/Documents/my-project
```

In interactive mode (see [Terminal UI](#terminal-ui) for the full visual grammar and keyboard reference):

- Tool executions are auto-approved
- Commands are auto-approved
- Followup questions show suggestions with a 60-second timeout, then auto-select the first suggestion
- Browser and MCP actions are auto-approved, every MCP tool included, whether or not its server's config lists it under `alwaysAllow`

### Approval-Required Mode (`--require-approval`)

If you want manual approval prompts, enable approval-required mode:

```bash
tumble "Refactor the utils.ts file" --require-approval -w ~/Documents/my-project
```

During an interactive session, use `/permissions` to see the current approval
mode and the available options. Select automatic approval with `/permissions
allow` or manual approval with `/permissions ask` without restarting the CLI.
The command changes only the active session; startup flags and saved CLI
settings still determine the initial mode of the next session.

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

### Stdin Stream Mode (`--stdin-prompt-stream`)

For programmatic control (one process, multiple prompts), use `--stdin-prompt-stream` with `--print`.
Send NDJSON commands via stdin:

```bash
printf '{"command":"start","requestId":"1","prompt":"1+1=?"}\n' | tumble --print --stdin-prompt-stream --output-format stream-json

# Optional: provide taskId per start command
printf '{"command":"start","requestId":"1","taskId":"018f7fc8-7c96-7f7c-98aa-2ec4ff7f6d87","prompt":"1+1=?"}\n' | tumble --print --stdin-prompt-stream --output-format stream-json
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

The theme is the Tumble "Hardcore" palette mapped to Claude Code's semantic key system: brand orange for the `✻` welcome glyph and spinner, permission purple for dialog borders and focused select rows, subtle gray for `❯` prompt chars and `⎿` connectors, and a dark background band for user turns.

### Keyboard shortcuts

| Key            | Action                                                                |
| -------------- | --------------------------------------------------------------------- |
| `Ctrl+C` twice | Exit the CLI                                                          |
| `Ctrl+M`       | Cycle modes (code → architect → ask → debug → …)                      |
| `Ctrl+T`       | Toggle the TODO viewer                                                |
| `Esc`          | Cancel a running task, or close the TODO viewer / MCP panel / dialogs |
| `y` / `n`      | Approve / reject in approval dialogs (accelerators)                   |
| `↑` / `↓`      | Navigate autocomplete picker and dialog lists                         |
| `1`–`9`        | Jump-select a numbered option in dialogs                              |
| `Enter`        | Confirm the focused option                                            |

### Approval dialogs

When `--require-approval` is active, actions prompt for yes/no approval in a permission-bordered box (purple round border) with a bold title (`Bash command`, `Write file`, `MCP tool`, …), the relevant details (command, path, server+tool), and a numbered `1. Yes` / `2. No` list. Press `y` or `n` for the legacy accelerators, or use `↑`/`↓` + `Enter`, or `1`/`2` to jump-select.

### Followup questions

When the agent asks a followup question, a permission-bordered dialog renders the question as a bold title, numbered suggestions, and a final `Type my own answer…` option. An auto-accept countdown (`Auto-selecting "{label}" in {n}s — press any arrow key to cancel`) runs at the bottom; press any arrow key to cancel and choose manually. Selecting `Type my own answer…` reveals the input area for a free-form reply.

### Tumble Code Cloud Authentication

To use Tumble Code Cloud features (like the provider proxy), you need to authenticate:

```bash
# Log in to Tumble Code Cloud (opens browser)
tumble auth login

# Check authentication status
tumble auth status

# Log out
tumble auth logout
```

The `auth login` command:

1. Opens your browser to authenticate with Tumble Code Cloud
2. Receives a secure token via localhost callback
3. Stores the token in `~/.config/roo/credentials.json`

Tokens are valid for 90 days. The CLI will prompt you to re-authenticate when your token expires.

**Authentication Flow:**

```
┌──────┐         ┌─────────┐         ┌───────────────┐
│  CLI │         │ Browser │         │ Tumble Code Cloud│
└──┬───┘         └────┬────┘         └───────┬───────┘
   │                  │                      │
   │ Open auth URL    │                      │
   │─────────────────>│                      │
   │                  │                      │
   │                  │ Authenticate         │
   │                  │─────────────────────>│
   │                  │                      │
   │                  │<─────────────────────│
   │                  │ Token via callback   │
   │<─────────────────│                      │
   │                  │                      │
   │ Store token      │                      │
   │                  │                      │
```

## Options

| Option                                  | Description                                                                                  | Default                 |
| --------------------------------------- | -------------------------------------------------------------------------------------------- | ----------------------- |
| `[prompt]`                              | Your prompt (positional argument, optional)                                                  | None                    |
| `--prompt-file <path>`                  | Read prompt from a file instead of command line argument                                     | None                    |
| `--create-with-session-id <session-id>` | Create a new task using the provided session ID (UUID)                                       | None                    |
| `-w, --workspace <path>`                | Workspace path to operate in                                                                 | Current directory       |
| `-p, --print`                           | Print response and exit (non-interactive mode)                                               | `false`                 |
| `--stdin-prompt-stream`                 | Read NDJSON control commands from stdin (requires `--print`)                                 | `false`                 |
| `-e, --extension <path>`                | Path to the extension bundle directory                                                       | Auto-detected           |
| `-d, --debug`                           | Enable debug output (includes detailed debug information, prompts, paths, etc)               | `false`                 |
| `-a, --require-approval`                | Require manual approval before actions execute                                               | `false`                 |
| `-k, --api-key <key>`                   | API key for the LLM provider (keyless providers ignore it)                                   | From env var            |
| `--provider <provider>`                 | API provider (anthropic, openrouter, ollama, gemini, etc.)                                   | `openrouter`            |
| `-m, --model <model>`                   | Model to use (openrouter: `anthropic/claude-opus-4.6`; openai, ollama, lmstudio: required)   | Provider default        |
| `--base-url <url>`                      | Base URL override for the selected provider (when supported)                                 | None                    |
| `--mode <mode>`                         | Mode to start in (code, architect, ask, debug, etc.)                                         | Settings, else `code`   |
| `--terminal-shell <path>`               | Absolute shell path for inline terminal command execution                                    | Auto-detected shell     |
| `-r, --reasoning-effort <effort>`       | Reasoning effort level (unspecified, disabled, none, minimal, low, medium, high, xhigh, max) | Settings, else `medium` |
| `--consecutive-mistake-limit <n>`       | Consecutive error/repetition limit before guidance prompt (`0` disables the limit)           | `10`                    |
| `--command-execution-timeout <seconds>` | Seconds a shell command may run before it is stopped (`0` means no limit)                    | Settings, else `300`    |
| `--ephemeral`                           | Run without persisting state (uses temporary storage)                                        | `false`                 |
| `--oneshot`                             | Exit upon task completion                                                                    | `false`                 |
| `--output-format <format>`              | Output format with `--print`: `text`, `json`, or `stream-json`                               | `text`                  |

## Auth Commands

| Command              | Description                         |
| -------------------- | ----------------------------------- |
| `tumble auth login`  | Authenticate with Tumble Code Cloud |
| `tumble auth logout` | Clear stored authentication token   |
| `tumble auth status` | Show current authentication status  |

### ChatGPT Plus/Pro (OpenAI Codex OAuth)

ChatGPT subscription access is separate from Tumble Code Cloud authentication
and from usage billed through an `OPENAI_API_KEY`. Sign in once, then select the
`openai-codex` provider:

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

## Settings File

`~/.roo/cli-settings.json` holds your defaults, so a bare `tumble` needs no
flags. Only you write it: neither a CLI run nor the VS Code extension changes
it (the first-run onboarding records its one choice, nothing else). Flags apply
to the run they are given on and are never saved.

```json
{
	"provider": "openai",
	"baseUrl": "http://192.168.50.194:11111/v1",
	"model": "GLM-5.3-Flash-NVFP4",
	"apiKey": "1111",
	"reasoningEffort": "high",
	"mode": "code"
}
```

| Key                       | Meaning                                                           |
| ------------------------- | ----------------------------------------------------------------- |
| `provider`                | Provider id, as for `--provider`                                  |
| `model`                   | Model id; used only while `provider` is the active provider       |
| `baseUrl`                 | Base URL; used only while `provider` is the active provider       |
| `apiKey`                  | API key; used only while `provider` is the active provider        |
| `apiKeyEnv`               | Name of the env var holding the key, instead of `apiKey`          |
| `reasoningEffort`         | As for `--reasoning-effort` (see the note below)                  |
| `mode`                    | Mode a new session starts in                                      |
| `requireApproval`         | `true` asks before actions, as `--require-approval`               |
| `consecutiveMistakeLimit` | As for `--consecutive-mistake-limit`                              |
| `commandExecutionTimeout` | Seconds, as for `--command-execution-timeout`; see the note below |
| `oneshot`                 | `true` exits when the task completes, as `--oneshot`              |
| `modes`                   | Settings per mode, see below                                      |
| `models`                  | Facts per model (its context window), see below                   |
| `mcpSettingsPath`         | File with the global MCP servers, see [MCP Servers](#mcp-servers) |

The file may hold an API key, so keep it readable only by you (`chmod 600
~/.roo/cli-settings.json`); the CLI warns when other users can read it. To keep
the key out of the file, use `"apiKeyEnv": "MY_KEY_VAR"` instead: the CLI reads
the key from that variable and stops with an error naming it when it is unset.

Precedence: flag > settings file > built-in default. Provider, model and base
URL also fall back to the CLI's own extension state in
`~/.vscode-mock/global-storage` before the built-in default.

Note on `reasoningEffort`: it reaches the model only when the provider's model
information says the model supports a reasoning effort. For the `openai`
(OpenAI-compatible) provider that information is user-supplied in the VS Code
settings and the CLI cannot set it yet, so there the value has no effect (GLM
models get their thinking switch regardless).

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
	"reasoningEffort": "max",
	"modes": {
		"architect": { "model": "GLM-5.3-NVFP4", "reasoningEffort": "high" },
		"ask": { "provider": "openai-codex", "model": "gpt-5.6-sol" }
	}
}
```

- An entry may set `provider`, `model`, `baseUrl`, `apiKey`, `apiKeyEnv` and
  `reasoningEffort`. Keys are mode slugs as listed by `tumble list modes`.
- An entry that names a different provider inherits none of the top-level
  `model`, `baseUrl` or key, which belong to the top-level provider; it gets
  that provider's defaults unless it sets them (`ask` above).
- Every entry is checked at startup, so a missing key or an invalid value fails
  immediately and names the mode.
- Passing any of `--provider`, `--model`, `--base-url`, `--api-key` or
  `--reasoning-effort` makes that run use one configuration for every mode: the
  flags on top of the top level, with `modes` ignored.

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

- An entry applies wherever its model runs: the top level, a `modes` entry or
  `--model`.
- Use the size the server actually serves (for vLLM, its `--max-model-len`),
  which can be smaller than what the model supports. Condensing starts when the
  context passes about 90% of this size.
- Only the `openai` provider takes the size from here. Other providers size
  their models from their own model lists; an entry for a model one of them
  runs is ignored with a warning at startup.
- A size that is not a whole number above 0 fails at startup and names the
  model.

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
`*_BASE_URL` environment variable (and a generic `--base-url` flag).

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
| mistral        | `MISTRAL_API_KEY`             | `MISTRAL_BASE_URL`            |
| moonshot       | `MOONSHOT_API_KEY`            | `MOONSHOT_BASE_URL`           |
| minimax        | `MINIMAX_API_KEY`             | `MINIMAX_BASE_URL`            |
| qwen-code      | - (OAuth credentials on disk) | -                             |
| vertex         | - (gcloud credential chain)   | -                             |
| xai            | `XAI_API_KEY`                 | -                             |
| zai            | `ZAI_API_KEY`                 | -                             |

Alias: the persisted cloud provider id `tumble` is accepted on the CLI and maps
to the `openrouter` provider settings (`OPENROUTER_API_KEY`, models, base-url);
`--provider tumble` behaves like `--provider openrouter`.

Excluded providers: `vscode-lm` (needs the real VS Code LM API), `fake-ai`
(hidden internal test provider), `gemini-cli` (no runtime handler). Retired providers (groq,
huggingface, deepinfra, cerebras, chutes, doubao, featherless,
io-intelligence) are rejected with a clear error.

**Authentication Environment Variables:**

| Variable            | Description                                                                          |
| ------------------- | ------------------------------------------------------------------------------------ |
| `ROO_AUTH_BASE_URL` | Web app that `tumble auth login` signs in through (default: `http://localhost:3000`) |
| `ROO_SDK_BASE_URL`  | Cloud API the CLI talks to (default: `http://localhost:3001`)                        |

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

    - Creates a VSCode API mock using `@roo-code/vscode-shim`
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

The `dev:local` script points the CLI at a self-hosted cloud stack on this machine (`ROO_AUTH_BASE_URL=http://localhost:3000`, `ROO_SDK_BASE_URL=http://localhost:3001`, `ROO_CODE_PROVIDER_URL=http://localhost:8080/proxy`). To use another deployment, set the same variables before `pnpm dev`:

```bash
ROO_AUTH_BASE_URL=https://auth.example.com ROO_SDK_BASE_URL=https://api.example.com pnpm dev --print "Hello"
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
