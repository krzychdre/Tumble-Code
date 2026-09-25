# Memory background writers: one small completion instead of an agent

Branch: `feat/memory-writers-single-shot` (off `main` 2b1c904e3).

## Problem

The memory background writers (extraction after a task ends, the periodic "dream"
consolidation) were meant to be tiny side jobs, yet each run cost tens of thousands of input
tokens and could not work on small local models.

Evidence from the on-disk task store (`globalStorage/qub-it.tumble-code/tasks`, aborted writer
runs keep their directory; `api_req_started` rows of `ui_messages.json`):

| Run (2026-09-25) | Requests | Input tokens per request |
| --- | --- | --- |
| extraction 22:41 (`01a0da4b`) | 5 | 44.1k, 41.5k, 47.8k, 48.8k, 49.5k |
| dream 22:06 (`01a0da27`) | 10 | 26.0k rising to 60.1k (about 450k in total) |
| dream 18:48 (`01a0d96b`) | 10 | 19.2k rising to 41.3k |

Root cause: `BackgroundTaskRunner.memorySubTaskRunner` spawned a full headless `Task` in
`code` mode for every writer run. That Task built the normal agent prompt, so each request
carried:

1. the whole `code`-mode system prompt (all tool definitions, rules): about 24k tokens;
2. an auto-attached skill (the extraction's first message included the 25k-char `zoo-port`
   skill body, because the skill name appeared in the transcript);
3. `environment_details` (7k chars on the first turn);
4. the transcript: the last 30 API messages at up to 2000 chars each, tool results included,
   although the memory rules exclude exactly that material;

and then repeated all of it on every turn (`maxTurns` 5 for extraction, 10 for dream). The
dream also spent turns on `update_todo_list`, `git log` and `search_files` calls the sandbox
denied.

## Design

Neither writer is an agent any more. Each asks one small completion (the same `SideQuery`
contract the recall ranker already uses) and the code does every file operation.

### Extraction (`extractMemories.ts`)

- Input: a 25-line instruction with one example, the manifest of existing memories (at most
  50, file name + description cut to 80 chars) and the conversation signal.
- Signal (`transcript.ts`, rewritten): only user prose, found with the ledger helpers
  `extractUserInstructions` / `extractEnvelopeFeedback` (they also find replies that arrive
  inside tool results and drop bare acknowledgements), plus the assistant line right before
  each reply and the assistant's last entry. Priority: task statement, last assistant entry,
  then replies newest first. Bounded to 6000 chars. No user prose means no model call.
- Output protocol: `NONE`, or up to 3 blocks `## <type>: <short_name>` + summary line +
  details. The parser tolerates `<think>` blocks, code fences and bold headers, and ignores
  anything else (a header must start with `#` or `**`, so a body line like `Project: x`
  cannot open a block).
- Files (`memoryFiles.ts`, new): slugified `<type>_<slug>.md` with frontmatter
  (`name`/`description`/`type`), `wx` so an unseen file is never clobbered, an index line in
  `MEMORY.md`. A name that matches an existing memory appends `Update YYYY-MM-DD: ...` to it.
  The model never supplies a path, so it cannot write outside the memory dir.

### Dream (`autoDream.ts`)

- Gates (time, sessions, lock, re-entry guard) unchanged.
- The code picks at most 3 disjoint pairs of same-type memories whose topic words overlap
  (Jaccard >= 0.35 on name + description, ignoring filler, status words like
  merged/main/squash and any word with a digit).
- One completion per pair: `KEEP`, `DROP 1|2`, or `MERGE` + summary + merged text. Anything
  unrecognised is KEEP. A merge shorter than 60% of the longer original, or of a body that
  had to be cut for the prompt, is refused.
- Nothing is deleted: dropped or folded memories move to `.archive/`, which the scan skips
  (`memoryScan.ts` now ignores dot directories). The memory dir can be the one shared with
  Claude Code, so a bad decision by a small model stays recoverable.
- Deterministic index repair at the end: dead links out, unindexed files in, hand-written
  lines untouched.

### Transport (`BackgroundTaskRunner.memoryWriterQuery`)

Builds a handler for the call (`buildApiHandler`), asks through `makeSideQuery` (telemetry
`completionKind: "memory"` as before), disposes it. The memory-writer profile wins when set; a
failed call on it is retried once on the finishing task's profile
(`TaskLifecycle` passes `apiConfiguration`, so a mid-task mode switch uses the profile the task
ended on). A cancel never retries. A provider without single completions fails the call and the
writer logs it.

Removed: `memorySandbox.ts` (tool-approval sandbox), `SubTaskRunner`, `buildConsolidationPrompt`,
the extraction/dream agent system prompts.

## Measured result

Real histories and the real 77-file memory dir, prompt chars / 3.5 as a token estimate:

| Task | Messages | History chars | Signal chars | Prompt tokens (one request) |
| --- | --- | --- | --- | --- |
| `019f94b1` | 252 | 4.78M | 2420 | ~2.8k |
| `01a047b6` | 4 | 4.34M | 716 | ~2.3k |
| `019ffb00` | 12 | 3.35M | 1811 | ~2.6k |
| `01a0da49` | 12 | 41k | 462 | ~2.2k |

Extraction: one request of about 2-3k tokens instead of up to five of 41-50k. Dream on the
real store: zero candidate pairs (the curated store has no duplicates), so zero model calls;
the first candidate filter paired unrelated memories through shared status words, which is
why those words are excluded now. A paraphrased duplicate of a real memory is still paired.

## Found on the way

- The first transcript version walked newest first under one budget; in the 252-message
  autonomous run the assistant narration filled it before the task statement and the signal
  came out empty. Fixed by the priority order above; regression test in `transcript.spec.ts`.
- `resolveMemoryWriterApiConfiguration` loaded the writer profile with
  `ProviderSettingsManager.activateProfile`, which also stores it as `currentApiConfigName`.
  Fixed in a separate commit on this branch (read-only `getProfile`).

## Tests

- `memoryFiles.spec.ts` (new): slugs, path safety, index sync, archive, candidate pairing,
  MERGE / DROP / KEEP / lossy-merge refusal, verdict parsing.
- `extractMemories.spec.ts`: file + index written from an answer, append to an existing memory,
  prompt contents and size, no call without signal, parser tolerance; cursor, mutual exclusion
  and drain tests kept.
- `transcript.spec.ts`: rewritten for the signal rules, including the long-run regression.
- `autoDream.spec.ts`: gates, re-entry guard and drain kept, driven by a seeded similar pair.
- `BackgroundTaskRunner.spec.ts`: writer profile, foreground fallback, no retry on cancel,
  no Task created, activity window, stale profile.

## Open

- Parallel branch `fix/memory-writers-after-completion` (worktree `/tmp/roo-wt-memcomplete`)
  touches `TaskLifecycle.ts` and `Task.completion-memory-writers.spec.ts`; its spec mocks
  `memorySubTaskRunner`, which becomes `memoryWriterQuery` here. Whichever merges second
  adapts the mock.
- Not measured against a live small model yet; the protocol was designed for one (single
  decision, one example, tolerant parser) but a run against e.g. a 1-3B local model is owed.
