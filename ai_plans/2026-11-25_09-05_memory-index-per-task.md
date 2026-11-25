# MEMORY.md index read once per task

Status: done, merged as #1357.

## Problem

`getMemoryIndexSection(cwd)` (and the compact variant) read MEMORY.md on every request. The index sits in the system
prompt, which renders before every message, so a note saved while a task runs changes the next request from the system
prompt on and the provider re-prefills the whole conversation. In the esp32-modulator session subtasks saved notes
while the orchestrator and a sibling were running: four requests, 329,000 uncached tokens (8.5% of the session).

## Fix

- `memoryPrompt.ts`: `readMemoryIndex(cwd)` returns the file text ("" when memory is off or the file is missing);
  `formatMemoryIndex` and `formatCompactMemoryIndex` turn that text into the long and compact sections. The old
  `loadMemoryIndex` / `loadCompactMemoryIndex`, which did both, are gone.
- `SystemPromptOptions.memoryIndex` (and `SystemPromptSource.memoryIndex`) carry the text; both sections format it.
- `ApiRequestBuilder` (one per task) reads it on the task's first request and keeps it. A resumed task is a new
  `Task`, so it reads the file again. The "copy system prompt" preview reads the file as it is now.

The memory-writing instructions still say that MEMORY.md is "always loaded"; a running task simply sees the version
from its start, the same as Claude Code, which loads it once per session.

## Tests

- `ApiRequestBuilder.system-prompt.spec.ts` (renamed from `.task-mode.spec.ts`, shares its builder helper): a task
  keeps the text its first request read after the file changes, and a new task reads the new text. Mutation-checked:
  reading on every request turns it red.
- `memoryPrompt.spec.ts`: the loader tests now go through `readMemoryIndex` + the two formatters.

KV-cache: prefix-stable (the bytes of an unchanged index are identical; a changed index no longer reaches running
tasks).
