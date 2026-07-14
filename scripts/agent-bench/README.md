# agent-bench — agent-loop efficiency benchmark

Measures how efficiently a model+harness combination completes a fixed set of
tasks. Used to gate the efficiency workstreams in
`ai_plans/2026-07-12_glm-agent-loop-efficiency-implementation.md`.

## Protocol

1. Build + install the extension from the branch under test.
2. In a clean VS Code window on this repo, run each task below **once**, in a
   fresh Roo task, with the profile under test (e.g. `GLM-5.2`). Do not
   intervene unless the task stalls; auto-approve settings identical across runs.
3. Note each task ID (visible in task history), then run the collector:

    ```bash
    python3 scripts/agent-bench/collect.py <taskId> [<taskId> ...]
    # or the N most recent tasks:
    python3 scripts/agent-bench/collect.py --recent 5
    ```

4. Paste the emitted markdown table into the PR description next to the
   baseline numbers.

Run the full set twice per branch (variance on GLM is real); report both.

## Fixed tasks

| #   | Size | Mode      | Prompt                                                                                                                                                                                   |
| --- | ---- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | S    | code      | `What does getEnvironmentDetails include in each message and which settings control it? Answer only, do not modify anything.`                                                            |
| 2   | M    | code      | `In src/core/prompts/sections/modes.ts there is a formatting inconsistency: find any mode listed without its whenToUse description and make the output uniform. Small, surgical change.` |
| 3   | M    | code      | `Add a unit test for formatResponse.noToolsUsed covering its exact text, in the existing formatResponse test file.`                                                                      |
| 4   | L    | code      | `Add an optional "maxLines" parameter to the list_files tool that caps returned entries, wired through schema, tool, and one test.`                                                      |
| 5   | L    | architect | `Plan and then implement (switching modes yourself) a --json flag for scripts/find-missing-translations.js.`                                                                             |

Tasks 2–5 must be run on a throwaway branch; reset the working tree between runs
(`git checkout -- . && git clean -fd` scoped to the touched paths).

## Metrics reported per task

- API turns, tool calls, tools/turn, share of multi-tool turns
- input/output tokens per turn, cacheReads
- reasoning chars per turn
- TTFT and decode seconds per turn (from ui_messages timestamps)
- total wall-clock, environment_details bytes

## Separation experiment (model vs harness)

Run the same 5 tasks with a Claude profile (Sonnet or Opus) on the same branch
and compare turns/task and s/turn against GLM-5.2. Record results in the
implementation plan doc.
