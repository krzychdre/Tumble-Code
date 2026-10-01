# Subagent fixes: tail scroll pinning + no recursive spawning

**Date:** 2026-07-12
**Base:** `feat/subagent-mode-model` (9d883338a, subagent UX stack tip)
**Status:** IN PROGRESS

## Problems (user-reported)

1. **Tail always jumps to bottom.** While a subtask streams, its live tail in
   the SubagentsPanel cannot be scrolled up — every incoming message batch
   re-pins the view to the bottom, so earlier text is unreadable.
2. **Subtasks spawn subtasks.** A `run_parallel_tasks` child can itself call
   `new_task` / `run_parallel_tasks`. Subtasks are meant to be small,
   one-shot, quickly-terminating jobs that return to the parent; nested
   delegation must be impossible.

## Evidence

1. `SubagentTail` (webview-ui/src/components/chat/SubagentsPanel.tsx): the
   auto-scroll effect sets `el.scrollTop = el.scrollHeight` unconditionally
   on every `messages` change — no "is the user at the bottom?" check
   (ChatView's Virtuoso solves the same problem with `followOutput` +
   `atBottomStateChange`).
2. `new_task` and `run_parallel_tasks` are in `ALWAYS_AVAILABLE_TOOLS`
   (src/shared/tools.ts:322) and the "modes" tool group, so every child task
   receives them regardless of mode. Nothing in
   `buildNativeToolsArrayWithRestrictions` or the tools themselves checks
   `task.isBackground`. A child in orchestrator-style modes is actively
   prompted to delegate.

## Fix

### 1. `fix/subagent-tail-scroll`

Track bottom-ness in the tail: an `onScroll` handler records whether the
viewport is within a small threshold of the bottom (ref, no re-render); the
auto-scroll effect only re-pins when the user was already at the bottom.
New content while scrolled up leaves the position untouched; scrolling back
to the bottom re-engages following. Same contract as ChatView's Virtuoso.

### 2. `fix/subagent-no-recursive-spawn`

Three layers (weak-model safe: remove the affordance, guard the call,
say so in the prompt):

- **Tool list:** thread `isBackground` from Task through `TaskApiLoopAccess`
  → `ApiRequestBuilderAccess`; in `buildToolsArray`, extend `disabledTools`
  with `new_task` + `run_parallel_tasks` for background tasks — the existing
  `filterNativeToolsForMode` disabledTools path (alias-resolving) removes
  them from the child's tool array.
- **Runtime guard:** `RunParallelTasksTool.execute` and `NewTaskTool.execute`
  error out early when `task.isBackground`, with a message that tells the
  model to do the work directly in this task (covers hallucinated calls and
  any non-native protocol path where the prompt still lists the tool).
- **Prompt:** `run_parallel_tasks` native description states subtasks must be
  small one-shot jobs and cannot delegate (no new_task/run_parallel_tasks
  inside a subtask), so orchestrators split work accordingly.

## Verification

- Unit: RunParallelTasksTool/NewTaskTool background guard specs; build-tools
  spec asserting both tools are absent for `isBackground` requests.
- `pnpm check-types` (types/src/webview), targeted vitest.
- Manual: fan-out with a long-streaming subtask → scroll up in the tail and
  confirm it stays; subtask in orchestrator mode → no delegation tools in its
  request, hallucinated `new_task` gets the corrective error.

## Outcome

Shipped 2026-07-12 as 2 stacked branches off 9d883338a:

- `fix/subagent-tail-scroll` (1d2102df5) — onScroll ref tracks bottom-ness
  (24px threshold); auto-scroll only re-pins when the user was at the
  bottom; fresh/re-keyed tails start pinned.
- `fix/subagent-no-recursive-spawn` (new stack TIP) — `isBackground`
  threaded Task → TaskApiLoopAccess → ApiRequestBuilderAccess; background
  requests get `new_task` + `run_parallel_tasks` appended to disabledTools
  (alias-resolving filter strips them from the tool array); both tools
  refuse at runtime with a "do the work directly, finish with
  attempt_completion" error when `task.isBackground` (covers hallucinated
  calls and prompt-listed protocols); run_parallel_tasks description now
  requires small one-shot subtasks and states delegation is unavailable
  inside them. Guard tests added to both tool specs (40 green); src +
  webview typecheck clean.
