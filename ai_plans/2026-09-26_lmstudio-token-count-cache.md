# LM Studio: remember per-block token counts instead of recounting the whole history

Branch: `perf/lmstudio-token-count-cache`. Follow-up of API P4 (#462, eda567548), which
left "LM Studio full-history count" open; the worker pool fix it mentions is #229
(ffc33a546, DEF-C20).

## Root cause (verified on main 99b0a724b)

- `src/api/providers/lm-studio.ts` `createMessage` (lines 88-97 on main) computes
  `inputTokens` with `this.countTokens([{ type: "text", text: systemPrompt },
  ...flattenMessagesForTokenCount(messages)])`, i.e. the system prompt plus the WHOLE
  flattened history, once per request. LM Studio reports no usage we trust, so this local
  estimate is the `usage.inputTokens` of every LM Studio request.
- `BaseProvider.countTokens` -> `utils/countTokens.ts` -> workerpool (1 worker thread,
  `dist/workers/countTokens.js`) -> `utils/tiktoken.ts`: the local tiktoken `o200k_base`
  encoder for every model, then `ceil(sum * 1.5)`. LM Studio's own server tokenizer is not
  used. The encoder does not depend on the model.
- `TaskApiLoop` passes the history rebuilt per request (`getEffectiveApiHistory`,
  merge, `buildCleanConversationHistory`): fresh message objects, but the same strings.
  Between two requests the history only grows by the newest messages (except condense,
  microcompact, edits and deletes), so almost everything tokenized is a repeat.

## Measurements

Scripted conversation (200 requests, 38 KB system prompt, 4 blocks per turn with a
3 KB tool result; `tiktoken` inline, same machine, under `nice`):

| | before | after |
| --- | --- | --- |
| tokenizer calls per request | 1 | 1 |
| characters tokenized, total | 71.7 MB | 0.68 MB |
| characters tokenized, request 200 | 683 KB | 3 KB (request 1: 41 KB) |
| time in counting, total | 32.5 s | 0.49 s |

Counts were asserted equal to the uncached `tiktoken` on every request.

Replay of the real API histories (`api_conversation_history.json` under
`globalStorage/qub-it.tumble-code/tasks` and `rooveterinaryinc.roo-cline/tasks`):
1,221 tasks, 30,923 requests (one per assistant message, history =
`flattenMessagesForTokenCount(getEffectiveApiHistory(prefix))`, system prompt left out),
fed through the real `BlockTokenCountCache` with a counting stub:

| | before | after |
| --- | --- | --- |
| tokenizer calls | 30,923 | 30,911 (12 requests had nothing new) |
| characters tokenized | 9,567 MB | 251 MB (38x less) |
| worker time at the 3.2 MB/s of #462 | about 50 min | about 80 s |
| host-thread key work, whole replay | (structured clone of the full history) | 23 s, 0.75 ms per request |
| largest cache size | | 1,801 entries |

The system prompt (tens of KB, re-tokenized by every request before) now counts once per
handler, so the real saving is larger than the table. 25 tasks were spot-checked with the
real tokenizer: warm cache total equals the uncached `tiktoken` total.

Host thread, largest effective history (280 blocks, 0.6 MB JSON): a fully cached count
takes 2.2 ms, the structured clone it replaces (whole history posted to the worker) 1.3 ms,
the full tokenization it avoids 705 ms. A first design keyed blocks by
`sha256(JSON.stringify(block))`; it cost 57.6 ms per request on a 4.4 MB history on the
host thread (vs 5.6 ms `postMessage`), so it was replaced by the string-parts key below.

## Design

- `utils/tiktoken.ts`: the per-block logic moved into `rawBlockTokens`; new
  `tiktokenPerBlock` (raw counts, no fudge), `applyTokenFudge` (applied once to the sum,
  because `ceil(1.5 x)` per block differs: a pinned mix gives 1353 vs 1354), and
  `blockCountKeyParts(block)`: every value `rawBlockTokens` reads, as strings (text, the
  serialized tool call, tool result id / error flag / content strings, image data length).
  `tiktoken()` is `applyTokenFudge(sum(tiktokenPerBlock))`, pinned to the value main gave.
- Worker: new method `countTokensPerBlock`; `utils/countTokens.ts` shares the pool and
  the #229 fallback rules (queue full: inline, keep pool; other failure: drop pool) between
  `countTokens` and `countTokensPerBlock`. A wrong number of counts counts as a failure.
- `utils/BlockTokenCountCache.ts`: key = `[encoding, scope, ...blockCountKeyParts]` in a
  trie of Maps (no copies of large strings, V8 caches each string's hash). Unknown keys go
  to the worker in ONE call; the total is `applyTokenFudge(sum of raw counts)`. After each
  call the trie is rebuilt with only that call's keys.
- `LmStudioHandler` owns one cache (`inputTokenCache`) and uses it only for the input
  estimate in `createMessage`, scope `lmstudio:<model id>`.

## Correctness arguments

- Equal key means equal raw count: the key lists exactly what the tokenizer reads, and
  the serialized tool call is the very string it encodes. Specs pin distinct parts for
  blocks that read differently and equal counts for blocks that share parts.
- Edited, mutated-in-place, deleted, condensed or microcompacted blocks produce new keys
  or drop out: recounted or forgotten. Object identity is never used.
- Mode or profile switch: `Task.updateApiConfiguration` builds a new handler, so the cache
  starts cold; the scope also carries the model id and the encoding.
- A block the tokenizer throws on (image with `data: undefined`) makes the count throw
  exactly like before (LM Studio then reports 0, as today), and is never cached.
- Concurrent calls read their own snapshot; the last to finish replaces the trie.

## Unchanged

`BaseProvider.countTokens` and every other caller (TaskApiLoop threshold and fallback
counts, condense, Moonshot's estimate, LM Studio's output count), the worker's
`countTokens`, the pool size and queue limit, the token numbers themselves.

## Memory

Bounded by the latest request: at most one trie entry per distinct block of the last
counted history (1,801 at most in the replay), holding references to strings that history
already holds (only serialized tool calls are extra copies). Lives as long as the handler.

## Residual risks

- `blockCountKeyParts` must stay in step with `rawBlockTokens`; they sit next to each other
  with a comment, and the key-parts specs fail on the obvious drifts.
- The host thread now does about 1 ms more per request (keying) while it no longer clones
  the whole history to the worker; the tool-call serialization is repeated per request.
- Moonshot's `estimateUsage` has the same full-history pattern when the server omits usage;
  not changed here (rare path), the cache can be reused there.
