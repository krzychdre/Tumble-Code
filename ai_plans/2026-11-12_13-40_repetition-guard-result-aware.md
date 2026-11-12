# Repetition guard stops polling that makes progress: measurement and fix

**Status:** done, merged as #1299

**Related plans:** [`archive/2026-08/2026-08-24_deepseek-harness-inspirations.md`](archive/2026-08/2026-08-24_deepseek-harness-inspirations.md)
(the first look at dsh). This plan started as a second look at two harnesses, dsh (DeepSeek Harness, head
`fcc0ad4621`) and omp (Oh My Pi, head `7a03d7a`), and at four of their loop and stop mechanisms. Each one was
measured against our own stored data before anything was built. One defect of our own came out of that
measurement and is fixed here; the four mechanisms are listed under "Measured and not built".

**Touched:**

- `src/core/tools/ToolRepetitionDetector.ts`
- `src/core/assistant-message/toolCallbacks.ts`
- `src/core/tools/__tests__/ToolRepetitionDetector.spec.ts`
- `src/core/assistant-message/__tests__/toolCallbacks.spec.ts`
- `src/core/assistant-message/__tests__/presentTask.ts`
- `src/core/assistant-message/__tests__/presentAssistantMessage-steps.spec.ts`
- `src/core/checkpoints/__tests__/checkpointed-tools.spec.ts`
- `.changeset/repetition-guard-result-aware.md`

## Data

Two sources, both read only:

- **Stored tasks**: `~/.config/Code/User/globalStorage/qub-it.tumble-code/tasks`, 1820 tasks from 2026-09-28 to
  2026-11-12, 37 684 assistant messages, 135 MB of reasoning and answer text
  (`api_conversation_history.json` and `ui_messages.json` of every task).
- **Recorded exchanges**: table `llm_exchanges` of the self-hosted cloud service, 39 620 exchanges from
  2026-10-02 to 2026-11-12, with the `finish_reason` and the `issues` the recorder assigns.

Models in the data: GLM-5.3, GLM-5.3-Flash, DeepSeek-V4.1-Flash (three variants), Qwen3.8-27B, a few small Qwen
models and a few Anthropic runs.

## Symptom

A task that watches a long-running job repeats one command, for example

```sh
sleep 295; echo "saved: $(grep -c '^saved' /tmp/ebook-run4.log)  err: $(grep -c '    !' /tmp/ebook-run4.log)"
```

The first three runs return `saved: 58 err: 7`, `saved: 77 err: 8`, `saved: 93 err: 9`. The fourth call is not
run. An interactive task stops and asks the user ("Tumble appears to be stuck in a loop..."); the model then gets
`Tool call repetition limit reached for execute_command. Please try a different approach.`

## What was happening

`ToolRepetitionDetector.check` ([`src/core/tools/ToolRepetitionDetector.ts`](../src/core/tools/ToolRepetitionDetector.ts))
compares the canonical JSON of a call (name, params, nativeArgs) with the previous call and counts identical ones
in a row. With the default limit of 3 the fourth identical call is stopped by `stopRepeatedToolCall`
([`src/core/assistant-message/steps/toolUseGuards.ts`](../src/core/assistant-message/steps/toolUseGuards.ts)). The
detector never sees what the calls returned, so a poll whose every answer is new looks the same as a model that
repeats a call and learns nothing.

`wait_for_subagents` already has a hand-written exemption for exactly this reason (same arguments, different
result each time).

## Measurement

Every run of three or more identical native tool calls in a row in the stored tasks (`wait_for_subagents` left
out, it is exempt):

| Tool              | Runs | Results of the executed calls                   | Reached the 4th call      |
| ----------------- | ---- | ----------------------------------------------- | ------------------------- |
| `execute_command` | 6    | all different in every run (`sleep N; tail...`) | 5, all 5 stopped          |
| `apply_diff`      | 2    | identical (the same "missing parameter" error)  | 0 (both ended at 3 calls) |

Of the 5 stops, 3 returned the repetition error to the model and 2 ended with the task interrupted at the ask.
After each of the 3 errors the model worked around the guard: it changed `sleep 295` to `sleep 570`, rewrote the
command as a `for` loop, or wrote a monitor script and ran that instead.

In six weeks the guard stopped a call 5 times, 5 times wrongly, and never stopped a real loop. The two real
repeats (`apply_diff` with a missing parameter) were failing calls, which the mistake counter handles.

MCP tool calls (`mcp_tool_use` blocks) do not pass through the detector at all, which is why three runs of 4, 6
and 11 identical `take_screenshot` calls appear in the data unstopped. That stays as it is.

## Failure surface (before/after)

| Scenario                                                           | Before             | After                    |
| ------------------------------------------------------------------ | ------------------ | ------------------------ |
| Same call 4 times, every result identical                          | 4th call stopped   | 4th call stopped         |
| Same call 4 times, every result different (poll of a running job)  | 4th call stopped   | all run                  |
| Same call, results `A, A, B, B, B`                                 | 4th call stopped   | the run restarts at `B`; |
|                                                                    |                    | the 6th call is stopped  |
| Same failing call repeated (identical error text)                  | 4th call stopped   | 4th call stopped         |
| Call stopped once, repeated again after the hint (background task) | task ends as stuck | task ends as stuck       |
| A different call in between                                        | count starts over  | count starts over        |

## Fix

The detector learns the result of the call it last checked. A repeat that returned something different from the
previous identical call made progress, so the count of identical calls starts over.

```ts
/**
 * What the call last passed to `check` returned. A repeat with a different
 * result than the one before is watching something change (a poll of a
 * running job), so the run of identical calls starts over.
 */
public recordResult(toolUse: ToolUse, result: ToolResponse): void {
	if (this.serializeToolUse(toolUse) !== this.previousToolCallJson) {
		return
	}
	const resultJson = stringify(result)
	if (this.previousResultJson !== null && this.previousResultJson !== resultJson) {
		this.consecutiveIdenticalToolCallCount = 0
	}
	this.previousResultJson = resultJson
}
```

- `check` clears `previousResultJson` wherever it clears `previousToolCallJson` (a different call, a stop,
  `wait_for_subagents`).
- The early return covers the results that do not belong to the last checked call: the error the guard itself
  pushes after a stop (the detector has just forgotten the call) and the result of `wait_for_subagents`.
- `createToolCallbacks` ([`src/core/assistant-message/toolCallbacks.ts`](../src/core/assistant-message/toolCallbacks.ts))
  is the one place every result of a native tool call passes through. Its `pushToolResult` calls
  `task.toolRepetitionDetector.recordResult(block, content)` for a `tool_use` block, with the content exactly as
  the tool returned it (before approval feedback is merged in, before any spill to an artifact, images
  included).
- Nothing is persisted and nothing in the stored history changes, so a task that switches mode or model keeps
  working the same way.

Not changed: the limit, the messages, the `wait_for_subagents` exemption, the MCP path.

## Tests

- `ToolRepetitionDetector.spec.ts`: one parametrized test over result sequences (all different, all identical,
  `A A B B B B`, a changing image under the same text) and one test that a result recorded for another call is
  ignored.
- `toolCallbacks.spec.ts`: the wiring, with a real detector: the same `tool_use` block four times, every result
  new, is allowed four times.
- The fake tasks of three presentAssistantMessage specs gained `recordResult`.
- Mutation proof, each restored afterwards: without the `recordResult` call in `pushToolResult` the wiring test
  fails (`[true, true, true, false]`); without the count reset three sequence cases fail; without the early
  return the "another call" test fails.
- Replay: all 46 423 stored native tool calls of the 1820 tasks fed through the detector. Without results it stops
  5 calls (the five from the measurement); with results it stops none.

## Measured and not built

The four mechanisms from dsh and omp, each checked against the data above.

| Mechanism                                                                     | What the data shows                                                                                                                                                                                                                                                                                                             |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stream-time loop detection in reasoning and answer text (omp `thinking-loop`) | The exact-cycle detector, with omp's thresholds, fires 0 times in 36 949 reasoning and text messages. The paragraph-similarity detector fires 15 times, every one a false alarm (the model drafting numbered file content, tables or code in its reasoning). omp itself runs only the exact detector for model lines like ours. |
| A separate retry message for an answer cut at the output limit (omp)          | `finish_reason = length` occurs once in 39 620 exchanges.                                                                                                                                                                                                                                                                       |
| A separate retry message for a tool call written as text (omp)                | The recorder flags `tool_call_in_text` in 36 of 39 620 exchanges, from two tasks; 57 of the 58 such messages in the stored tasks come from one task of one model variant whose server failed to parse its own call markup. The existing reminder recovered every one in a single turn.                                          |
| A separate retry message for an empty answer (omp)                            | Already exists (`formatResponse.emptyResponseRetryNote`).                                                                                                                                                                                                                                                                       |
| Bookkeeping tools that do not reset the repetition count (dsh)                | 0 runs in the data that such a rule would have caught.                                                                                                                                                                                                                                                                          |
| Alternating-call detection (`A B A B`)                                        | 0 occurrences with period 2 or 3.                                                                                                                                                                                                                                                                                               |
| A refusal of "blocked" before three rounds of work (dsh goal)                 | dsh can do this because the model declares "blocked" through a tool. We have no such signal, and a keyword scan is not one: of 2545 final answers, 152 contain a phrase like "nie da się", and the 19 given after at most two tool calls are all ordinary statements of a limit inside a real answer.                           |

## Notes

- The largest waste the measurement found is none of the above: 264 answers whose reasoning alone is longer than
  60 000 characters (the longest 337 625), in 145 tasks, mostly GLM-5.3-Flash and DeepSeek-V4.1-Flash writing
  the same draft several times before the tool call. All 264 ended in a tool call, so nothing was stuck; the
  cost is time. Neither omp detector catches it (5 of 264). It needs its own design and a live comparison.
- A model that repeats a command printing a clock or a counter is never stopped by this guard. The mode request
  budget and the mistake limit still bound such a task.
