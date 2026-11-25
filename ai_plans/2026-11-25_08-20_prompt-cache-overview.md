# Prompt cache losses in delegated work: overview

Status: in progress (four branches, see below).

## Evidence

Session analysed: the esp32-modulator orchestrator task `01a20f55` and its seven `new_task` children, 2026-11-24
21:53 to 2026-11-25 08:30, GLM-5.3-NVFP4 on vLLM behind llama-swap (192.168.50.194:11111). 253 requests. Every
request was rebuilt byte-exact from the cloud `llm_exchanges` table (`services/exchange_reconstruction.load_task`) and
matched to the `api_req_started` rows (`tokensIn`, `cacheReads`) of each task's `ui_messages.json`.

Rendering order, checked with vLLM `POST /tokenize` on the served model: `[gMASK]<sop>`, the reasoning-effort system
block, then the TOOLS block, then the system prompt, then the messages. Anthropic documents the same order (tools,
system, messages). A changed tool array therefore invalidates the cache from the first token of the system prompt,
and a changed system prompt invalidates every message after it.

Uncached prompt tokens (`tokensIn - cacheReads`), 3.87M in total, attributed to the first change against the previous
request of the same task:

| Cause                                                                                        | Requests | Uncached tokens | Share |
| -------------------------------------------------------------------------------------------- | -------: | --------------: | ----: |
| Microcompaction cleared a few more old tool results each turn (task `01a20f96`, turns 56-68) |        8 |       1,465,000 | 37.9% |
| MODES list in the system prompt flipped between two versions                                 |       26 |       1,133,000 | 29.3% |
| Normal append-only growth                                                                    |      204 |         712,000 | 18.4% |
| MEMORY.md index in the system prompt changed mid-task                                        |        4 |         329,000 |  8.5% |
| Tool array changed (`tools_load` materialised a deferred MCP tool)                           |        2 |         113,000 |  2.9% |
| Task start (new subtask)                                                                     |        8 |          84,000 |  2.2% |

The subtask start itself is cheap: consecutive `code` subtasks share the tool array and the first ~20,000 characters
of the system prompt. The losses are inside the tasks.

### MODES flip

`getModesSection` read the modes from `context.globalState.get("customModes")`. VS Code keeps `globalState` on the
client and shares it between all windows, Remote-SSH windows included. The Remote-SSH window on 192.168.50.194 (logs
`20261124T151348`, `20261124T211724`) has an empty `custom_modes.yaml`, so its `CustomModesManager.getCustomModes()`
wrote `[]` there every time its 10 s cache expired, and the local window's next prompt listed only the built-in modes
(built-in "Vision" with its emoji, no code-reviewer, council, council-explorer, council-verifier). The local window's
own refresh then wrote the full list back. Each flip invalidated the whole conversation, twice.

### Memory index

`getMemoryIndexSection(cwd)` reads MEMORY.md on every request. Subtasks wrote memory notes (one of them a progress
note, `project_s3s4_progress.md`), so every running task saw its system prompt change.

### Subtask prompt

A `new_task` child gets the full prompt of its mode, written for a conversation with the user, and the orchestrator is
told to append "these instructions supersede any conflicting general instructions" to every delegation message. The
child prompt carries the memory-writing instructions (about 8,500 characters) although a subtask never talks to the
user it would learn from, and `switch_mode`, although the parent chose the mode. Tool order is the native-tools index
order, so orchestrator, architect and code share only the first 45 characters of the tool block.

## Branches

1. `fix/prompt-modes-own-window`: the MODES sections take the modes from the prompt options (this window's
   `CustomModesManager`), never from `globalState`. Plan `2026-11-25_08-41_prompt-modes-own-window.md`.
2. `fix/microcompact-headroom` (parallel agent): reclaim down to a low-water mark so the cleared set changes once and
   then stays put for many turns. Plan on that branch.
3. `perf/memory-index-per-task`: the MEMORY.md index is read once per task and kept for its lifetime.
4. `perf/subtask-system-prompt`: a system prompt written for a delegated subtask (the assignment contract in the
   prompt, no memory-writing section, no `switch_mode`), the orchestrator no longer dictates boilerplate into every
   message, and the tool array is ordered so the tools every mode has come first.
