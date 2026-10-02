# Tumble Code documentation

Start at the top and stop reading as soon as you know enough. Each level assumes the one above it.

| Level | Page                                                      | Answers                                                                               |
| ----- | --------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 0     | [System overview](01-system-overview.md)                  | What are the running pieces and how do they talk to each other?                       |
| 1     | [Architecture map](architecture.md)                       | Which folder owns what, which imports are allowed, what must not be touched?          |
| 2     | [Extension host](02-extension-host.md)                    | How the extension activates, what `ClineProvider` does, how state reaches the panel.  |
| 2     | [Webview UI](05-webview-ui.md)                            | How the React panel is built, how it merges state, how chat rows are shaped.          |
| 2     | [CLI](07-cli.md)                                          | How the terminal client runs the extension without VS Code.                           |
| 2     | [Cloud](08-cloud.md)                                      | `packages/cloud` and the self-hosted FastAPI service: auth, sync, bridge, web panel.  |
| 3     | [Task and the agent loop](03-task-agent-loop.md)          | One conversation turn from the user message to the tool result, with retry and abort. |
| 3     | [Tools and providers](04-tools-and-providers.md)          | How a tool call is parsed, approved and executed; how a provider streams chunks.      |
| 3     | [Persistence](06-persistence.md)                          | Where settings, secrets, tasks and history live, and how writes stay atomic.          |
| 3     | [Environment variables](09-environment-variables.md)      | Every variable the code reads, per workspace, including the dead ones.                |
| 3     | [Adding a setting, tool or provider](10-adding-things.md) | The file-by-file checklist for the three most common extension changes.               |

Plans and proposals live in `ai_plans/`. The current ones:

- [`ai_plans/2026-09-27_simplification-roadmap.md`](../ai_plans/2026-09-27_simplification-roadmap.md): what the
  2026-09 refactor achieved, and the ranked list of what to simplify, speed up and harden next.
- [`ai_plans/2026-09-27_ui-modernization.md`](../ai_plans/2026-09-27_ui-modernization.md): UI proposals for the
  VS Code panel, the cloud web panel and the CLI.
- [`ai_plans/2026-09-27_agent-fix-plan/`](../ai_plans/2026-09-27_agent-fix-plan/00-README.md): the roadmap's next
  items as self-contained work packages (exact code, tests, commands), in the order to execute them.

Code comments sometimes name a plan item (`CORE-R1`, `DEF-S8`, `P9`); [plan-ids.md](plan-ids.md) says what each one
was and which pull request did it.

## How these pages are written

- They name files and symbols, not line numbers. Line numbers rot within a week; a symbol name can be found with a
  plain text search in any editor.
- Diagrams are Mermaid. GitHub and VS Code's Markdown preview render them without plugins.
- A page describes what the code does today. Plans ("will", "should") go to `ai_plans/`, not here.
- When a change moves a boundary or a mechanism described here, update the page in the same pull request
  (the rule from `AGENTS.md`).
