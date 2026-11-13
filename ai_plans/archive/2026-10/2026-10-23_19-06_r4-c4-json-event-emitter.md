# R4 C4: JsonEventEmitter with one tool-use path and one delta helper

- **Status:** done
- **Related plans:** `ai_plans/2026-10-23_17-20_maintenance-audit-round-4.md` (item C4); decision 19 (2026-09-26)
  keeps the print, json and stream-json formats unchanged.

## Touched files

- `apps/cli/src/agent/json-event-emitter.ts`
- `apps/cli/src/agent/__tests__/json-event-emitter-streaming.test.ts`

## Problem

`handleToolUseAsk` had command, mcp and tool branches, each "partial: structured delta event, else: full event".
The "skip an empty streaming delta" block appeared four times, the completion_result handling twice,
`computeDelta` and `computeCommandOutputDelta` were one append-delta over two maps, and `isEmptyStreamingDelta`
and `isStreamingPartial` re-checked `mode === "stream-json"` although json-mode partials return at the top of
`handleMessage`.

## Change

- `TOOL_USE_KINDS`: per kind a `streamed(delta, text)` and a `complete(text)` `tool_use`; one emit path (field
  order of the events unchanged, the complete event always has `done: true` because it is never partial).
- `appendDelta(map, id, text)` backs both append-only deltas.
- `emitStreamedText` covers follow-up, reasoning and the other text asks; `rememberCompletion` the completion
  text. `isEmptyStreamingDelta` is gone (a partial implies stream-json there).
- `emitCommandOutputEvent` keeps its mode check: in json mode an empty output is still written as `output: ""`.

## Tests

- `print-and-json-output.characterization.test.ts` snapshots are byte-identical (not updated).
- New: "suppresses a repeated partial follow-up question that adds nothing".
- Mutations: `input: { text }` for the complete mcp event turns 2 specs red; `appendDelta` returning the whole
  text turns 8 red; dropping the skip in `emitStreamedText` turns the new spec red; restored.
- `npx vitest run src/agent --maxWorkers=2`: 287 green. `tsc --noEmit`, eslint, `pnpm knip`: clean.
