<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=QUB-IT.tumble-code"><img src="https://img.shields.io/badge/VS_Code_Marketplace-007ACC?style=flat&logo=visualstudiocode&logoColor=white" alt="VS Code Marketplace"></a>
  <a href="https://github.com/krzychdre/tumble-code"><img src="https://img.shields.io/badge/GitHub-181717?style=flat&logo=github&logoColor=white" alt="GitHub"></a>
</p>

# Tumble Code

> An AI coding agent for VS Code and the terminal, at home with the models you run yourself

Tumble Code plans, writes, runs and reviews code in your editor or your terminal. It works with any major cloud
provider, but it is built first for local and self-hosted models (Ollama, LM Studio, llama.cpp, vLLM and other
OpenAI-compatible servers), so your code can stay on your own hardware and you pay nothing per token.

Tumble Code grew out of [Roo Code](https://github.com/RooCodeInc/Roo-Code). When the Roo Code team stepped away from
the project in April 2026, Tumble Code took over the codebase at Roo Code 3.53.0. It has come a long way since: more
than a thousand changes later it has its own memory, background and parallel agents, a full terminal client, a
self-hosted cloud and a redesigned interface, described [below](#whats-new-since-roo-code). See
[Lineage and credits](#lineage-and-credits) for what it owes to the original authors.

## What Tumble Code does

- Turns a description or a spec into working code, and refactors, debugs and documents existing code
- Answers questions about your codebase, with semantic search over an index of it
- Runs commands, reads their output and fixes what fails, with a checkpoint before every change so you can roll back
- Works in modes, each with its own tools, rules and model: **Code**, **Architect**, **Ask**, **Debug**,
  **Orchestrator** (splits a large job into subtasks) and **Vision** (describes images for models that cannot see
  them), plus custom modes and modes from the marketplace
- Extends itself with MCP servers and skills
- Lets you choose how much it may do on its own, from approving every step to fully autonomous runs

## What's new since Roo Code

Everything below was added after the fork.

**Built for local and smaller models**

- **Model size per profile.** A profile runs in standard, slim or compact mode; compact gives a small-context model a
  short system prompt and a minimal toolset.
- **Tolerant of weak models.** Malformed tool calls and imperfect diffs are repaired instead of failing, a model is
  told which tools it lacks and how to delegate, and the system prompt carries engineering defaults.
- **Return reasoning to the model** for reasoning models on OpenAI-compatible servers (GLM, DeepSeek, local vLLM),
  with old reasoning shortened when the context fills up.
- **Concurrent requests per profile**, so parallel work never sends a local server more requests than it serves.
- **Fewer wasted tokens.** A lighter, non-destructive compaction, a separate cheaper model for compaction and memory,
  and context estimates for servers that do not report usage.

**Agents that keep working**

- **Background tasks.** A task keeps running when you open another one; the history shows which tasks work and which
  wait for you.
- **Parallel subagents.** A task hands self-contained jobs to subagents that run side by side, each in its own git
  worktree. A subagent's whole transcript can be opened, followed live, answered and stopped.
- **Several editor tabs**, opened from the editor title bar or the status bar.

**Memory and context**

- **Memory.** After a task, Tumble Code writes down what is worth keeping (your preferences, project decisions) and
  recalls it in later tasks; a background pass merges duplicates and drops what is out of date.
- **Artifacts.** Large tool outputs are saved to disk and read back in pieces instead of filling the context.
- **Task history search.** The agent can look up what was done in earlier tasks.
- **Web search and web pages** as built-in tools.
- **MCP tools on demand.** Tools of large MCP servers are loaded when needed, and each mode can be limited to the MCP
  tools it may use.

**Plans**

- **Plan approval.** Architect mode writes a plan you review and approve, with notes, before any work starts.

**Works with Claude Code**

- **Agent interchange.** Tumble Code and Claude Code on the same machine hand tasks to each other and read each
  other's plans and sessions, so work started in one continues in the other.

**Your own cloud**

- **Self-hosted cloud** ([`self-hosted-cloudapi/`](https://github.com/krzychdre/tumble-code/tree/main/self-hosted-cloudapi)):
  one Docker Compose stack with Authentik sign-in. Its web panel lists your tasks with costs and token usage, shows
  usage metrics, shares tasks and controls a running task remotely (messages, approvals, stop, resume). Telemetry goes
  only there.

**A rebuilt terminal client**

- **The CLI** inherited from Roo Code is rebuilt: the same providers as the extension, a transcript in the terminal's
  own scrollback, MCP servers, and images, diagrams and math in terminals that can draw them. It ships in every
  release, under the extension's version.

**Interface and safety**

- **A redesigned chat** with one calm look, full keyboard access and screen-reader labels, and smooth streaming even
  in long tasks.
- **Safer auto-approval.** Commands are split the way bash parses them before they are matched against your allow and
  deny lists.

**Models and providers**

- Model lists, prices and defaults kept current across Anthropic, OpenAI, Google, xAI, DeepSeek, Moonshot, Z.ai and
  the other providers; prompt caching and cost reporting fixed for several of them; seven redundant providers retired.

The [changelog](https://github.com/krzychdre/tumble-code/blob/main/CHANGELOG.md) lists every release.

## Command-line client

Tumble Code also runs in a terminal, with the same modes and providers. The CLI ships in every release next to the
extension, under the same version, for macOS on Apple silicon and Linux (x64 and arm64), and needs Node.js 22 or newer:

```sh
curl -fsSL https://raw.githubusercontent.com/krzychdre/tumble-code/main/apps/cli/install.sh | sh
```

It reads its settings from `~/.roo/cli-settings.json`. Start from the
[example settings file](https://github.com/krzychdre/tumble-code/blob/main/apps/cli/examples/cli-settings.example.json), which sets every option;
[examples/README.md](https://github.com/krzychdre/tumble-code/blob/main/apps/cli/examples/README.md) explains each one, and the
[CLI README](https://github.com/krzychdre/tumble-code/blob/main/apps/cli/README.md) covers the rest.

## Resources

- **Documentation:** the architecture notes for contributors live in [docs/](./docs/); user documentation is a work
  in progress.

<!-- External community channels are intentionally hidden until they're set up.
- **[GitHub Issues](https://github.com/krzychdre/tumble-code/issues):** Report bugs and track development.
- **[GitHub Discussions](https://github.com/krzychdre/tumble-code/discussions):** Ideas, questions, and feature requests.
-->

---

## Local Setup & Development

Requirements: the extension runs in VS Code 1.102 or newer. Development needs Node.js 22 (the exact version is in `.nvmrc`) and pnpm 12 (the exact version is `packageManager` in `package.json`; an installed pnpm 10 or newer switches to it on its own, or run `corepack enable`).

1. **Clone** the repo:

```sh
git clone https://github.com/krzychdre/tumble-code.git
```

2. **Install dependencies**:

```sh
pnpm install
```

3. **Run the extension**:

There are several ways to run the Tumble Code extension:

### Development Mode (F5)

For active development, use VSCode's built-in debugging:

Press `F5` (or go to **Run** → **Start Debugging**) in VSCode. This will open a new VSCode window with the Tumble Code extension running.

- Changes to the webview will appear immediately.
- Changes to the core extension will also hot reload automatically.

### Automated VSIX Installation

To build and install the extension as a VSIX package directly into VSCode:

```sh
pnpm install:vsix [-y] [--editor=<command>]
```

This command will:

- Ask which editor command to use (code/cursor/code-insiders) - defaults to 'code'
- Uninstall any existing version of the extension.
- Build the latest VSIX package.
- Install the newly built VSIX.
- Prompt you to restart VS Code for changes to take effect.

Options:

- `-y`: Skip all confirmation prompts and use defaults
- `--editor=<command>`: Specify the editor command (e.g., `--editor=cursor` or `--editor=code-insiders`)

### Manual VSIX Installation

If you prefer to install the VSIX package manually:

1.  First, build the VSIX package:
    ```sh
    pnpm vsix
    ```
2.  A `.vsix` file will be generated in the `bin/` directory (e.g., `bin/tumble-code-<version>.vsix`).
3.  Install it manually using the VSCode CLI:
    ```sh
    code --install-extension bin/tumble-code-<version>.vsix
    ```

## Working over Remote SSH

When VSCode is connected to a remote machine through Remote SSH, the Tumble Code extension host runs on the **server**, not on your laptop. The extension runs Node code, so it defaults to the `workspace` extension kind, which means everything it does happens where the workspace lives.

### Where state lives

- All persistent state (global storage: task history, API provider profiles, memory, artifacts) lives in `~/.vscode-server/data/User/globalStorage/` **on the server**, separately for each host you connect to.
- **Task history and provider profiles are per-host.** A task you finished on one server does not exist on another, and profiles saved on one host are not visible from another.
- The only state that physically lives on your laptop is secret storage (API keys): VSCode proxies it through the SSH channel to the client machine's keychain.
- The webview UI renders locally, but all extension logic and file access happen on the server.
- The extension must be installed **"in SSH"**: in the Extensions view, use the button "Install in SSH: [host]" instead of installing it only in the local window. A purely local install does not run on the server.

### Machine-scoped settings

The following settings are scoped `machine`. A value set in User settings on your laptop does **not** apply in a remote window; set them in the **"Remote [SSH: ...]"** settings tab (Settings editor, tab named after your SSH host) so they apply on the server:

- `tumble-code.customStoragePath` (a local disk path, resolved on the server)
- `tumble-code.autoImportSettingsPath` (same)
- `tumble-code.debugProxy.serverUrl` (a local proxy address)
- `tumble-code.cloudApiUrl`
- `tumble-code.clerkBaseUrl`

Remember that in a remote window `localhost` means the **server**, not your laptop, so addresses like `http://127.0.0.1:...` must point at something reachable from the server.

Settings that are not host-specific (for example `allowedCommands`, `deniedCommands`, `commandExecutionTimeout`) keep their normal scope and still apply from User settings or Settings Sync.

### Diagnostic checklist

If task history or settings misbehave in an SSH window, check the server side first, because that is where the storage lives:

1. **Disk space and quota** on the server: `df -h ~` and `quota -s` (a full disk or exceeded quota makes every write fail with `ENOSPC` or `EDQUOT`).
2. **Filesystem type**: `stat -f ~/.vscode-server`. Network filesystems (NFS) add latency that can make file locks time out.
3. **inotify limits**: `cat /proc/sys/fs/inotify/max_user_watches` and `/proc/sys/fs/inotify/max_user_instances`. vscode-server itself consumes thousands of watches, which can exhaust the limits and degrade file watching.
4. **Extension logs**: in the Output panel, check the Tumble Code channel and "Log (Remote Extension Host)". Look for storage errors (`ENOSPC`, `EDQUOT`, `EROFS`, `EACCES`), failed TaskHistoryStore initialization, and lock errors (`Failed to acquire lock for`, `Lock compromised`).
5. **Effective settings**: in the remote window, open Settings and compare the "Remote" tab against the "User" tab to see which value of a machine-scoped setting actually applies.

---

Releases are versioned with [changesets](https://github.com/changesets/changesets); [`.changeset/README.md`](.changeset/README.md)
describes how a change gets into the changelog and how a release is cut.

---

## Disclaimer

**Please note** that the Tumble Code contributors do **not** make any representations or warranties regarding any code, models, or other tools provided or made available in connection with Tumble Code, any associated third-party tools, or any resulting outputs. You assume **all risks** associated with the use of any such tools or outputs; such tools are provided on an **"AS IS"** and **"AS AVAILABLE"** basis. Such risks may include, without limitation, intellectual property infringement, cyber vulnerabilities or attacks, bias, inaccuracies, errors, defects, viruses, downtime, property loss or damage, and/or personal injury. You are solely responsible for your use of any such tools or outputs (including, without limitation, the legality, appropriateness, and results thereof).

---

## Contributing

We love community contributions! Get started by reading our [CONTRIBUTING.md](CONTRIBUTING.md).

New to the code? Read the one-page [architecture map](docs/architecture.md) before you change anything that crosses a folder boundary.

---

## Lineage and credits

Tumble Code began as a fork of [Roo Code](https://github.com/RooCodeInc/Roo-Code), originally authored by Roo
Veterinary Inc. and published on the VS Code Marketplace as `RooVeterinaryInc.roo-cline`; Roo Code itself grew out of
Cline. In April 2026 the Roo Code team [announced](https://x.com/mattrubens/status/2046636598859559114) that they were
stepping away from the project to focus on their new product, Roomote. Tumble Code took over the codebase at Roo Code
3.53.0 to keep it alive and to steer it toward local and self-hosted models.

**What Tumble Code owes to Roo Code**

- The foundation it still stands on: the agent loop, the mode system, MCP integration, the provider layer, checkpoints,
  codebase indexing, skills and the chat interface, all Apache 2.0 licensed (see [LICENSE](./LICENSE) for the full
  notice, including the original Roo Code copyright)
- The translation work of the Roo Code community across 18 languages
- Years of commits by many contributors, which remain in this repository's history. If you contributed to Roo Code,
  your work is still here: Tumble Code carries it forward under a new name, it is not a clean-room rewrite.

**What changed with the fork**

- A new Marketplace identity, `QUB-IT.tumble-code`, independent from the Roo Code extension. On first launch Tumble
  Code offers to copy your Roo Code settings.
- The agent is called Tumble, and the logo is a tumbleweed instead of a kangaroo.
- Internal identifiers (`roo-cline.*` command and view IDs, `.roo` folders, `.roomodes`) are kept, so keybindings, rules
  and custom modes keep working.
- Cloud features (sign-in, task sharing, telemetry, remote control) talk to a backend you run yourself instead of Roo
  Code's servers.
- Version numbers start again at 1.0.0. Roo Code's releases are in the
  [Roo Code changelog](https://github.com/RooCodeInc/Roo-Code/blob/main/CHANGELOG.md).

For questions about lineage, licensing or attribution, please reach out through whichever contact channel Tumble Code
publishes once it has one set up.

---

## License

[Apache 2.0, © 2025 Roo Code, Inc.; community fork © 2026 Tumble Code contributors](./LICENSE)
