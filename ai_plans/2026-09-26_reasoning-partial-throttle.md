# Throttle partial reasoning posts (follow-up of API P3)

Branch: `perf/reasoning-partial-post-throttle`. Date: 2026-09-26.

## Root cause (measured)

`TaskStreamProcessor.processChunk` handles every streamed `reasoning` chunk with
`say("reasoning", formattedWholeText, undefined, true)`. For every chunk after
the first, `TaskAskSay.say` updates the partial message in place and calls
`TaskHistory.updateClineMessage`, which posts a `messageUpdated` carrying the
WHOLE reasoning so far to the webview (and emits a `Message` "updated" event
to the bridge and the CLI). A reasoning of `L` characters in chunks of `c`
characters therefore posts `L / c` messages and about `L^2 / (2c)` characters.
API P3 (#461) made the formatting incremental but left this post, "a protocol
or throttle decision". The owner decided to apply the rule of API P2 (#456,
tool-argument previews at most every 100 ms).

Scripted stream in the new spec (44 KB reasoning, 4-character chunks, 5 ms
apart, the real `TaskAskSay`, fake timers):

| | posts of the reasoning message | characters posted |
|---|---|---|
| before (main) | 10,946 | 245.1 M |
| after | 550 | 12.4 M |

Real data: the same source as #461, the `ui_messages.json` files of the
extension's globalStorage (`qub-it.tumble-code/tasks`), 1,054 tasks and 13,598
reasoning messages (84.0 M characters). Chunk timing is not stored, so the
estimate replays each message in 4-character chunks (as #461 did) at an
assumed streaming rate. The median rate implied by the timestamps of messages
of 2,000+ characters (reasoning ts to the next message ts) is about 380
characters per second.

| assumed rate | posts before -> after | characters before -> after |
|---|---|---|
| 200 chars/s | 21.0 M -> 4.2 M (5x) | 5.48e11 -> 1.10e11 (5x) |
| 400 chars/s | 21.0 M -> 2.1 M (10x) | 5.48e11 -> 5.49e10 (10x) |
| 1000 chars/s | 21.0 M -> 0.86 M (24x) | 5.48e11 -> 2.20e10 (25x) |

The 99th percentile message (74 KB) at 400 chars/s: 18,569 posts and 690 M
characters before, 1,858 posts and 69 M characters after. The gain equals the
number of chunks per 100 ms: providers that send larger chunks gain less, and
each remaining post still carries the whole text (the total stays quadratic,
with a constant ten to twenty times smaller). A delta protocol would remove
that, but it changes the webview, the bridge and the CLI contract; it is not
part of this change.

## Design

All in `TaskStreamProcessor` (plus one line in `Task.dispose`):

- `REASONING_PARTIAL_POST_INTERVAL_MS = PARTIAL_ARGS_PARSE_INTERVAL_MS` (100 ms,
  reused from API P2).
- A reasoning chunk goes through `say` as before (and posts) when the last
  message is not a partial reasoning (the first chunk of a message, including
  the second reasoning of an interleaved turn), when the task is aborted, or
  when the last post was at least one interval ago.
- Otherwise the chunk does exactly the in-place update `say` would do
  (`last.text = formatted`) without the post, remembers the message as
  pending and arms one timer for the rest of the interval (unref'd).
- Pending text is posted (`updateClineMessage` of that message, by
  reference): when the timer fires; before any non-reasoning chunk (text,
  tool call, finish reason, usage, grounding), so it lands before the next
  message is created; at the start of `finalizeStream`, so the last partial
  post carries the whole text as today; at the start of the `abortStream`
  closure (user cancel and stream error both go through it), while the
  message is still partial; in `resetStreamingState`.
- A pending message that is no longer partial is not posted (whoever closed
  it posted it). When the next `say` updates the very pending message, the
  pending post is dropped instead of doubled (not when aborted, since an
  aborted `say` throws).
- The timer does nothing for an abandoned task; `Task.dispose` calls
  `streamProcessor.dispose()`, which clears the timer.

## What stays unchanged

- The in-memory `clineMessages` hold the complete formatted text after every
  chunk (pinned), so `ui_messages.json`, state pushes of other messages and
  any save at any moment carry the same content as today.
- Final messages: `finalizeStream` still closes the last reasoning message
  with the full text, so the `Message` events that end up final, the cloud
  `TASK_MESSAGE` captures (only non-partial messages) and the stream-json
  output of final messages (the CLI emits the full text on `done`) are the
  same. Pinned: a throttled and an unthrottled run of reasoning, text,
  reasoning, text end with identical messages and the same last partial and
  final post per message.
- Interleaved reasoning keeps today's shape (reasoning, text, reasoning; the
  second message carries the whole reasoning of the request).
- The CLI replaces messages on `messageUpdated` (message-processor), so the
  ctrl+o live block and the transcript show the latest text, refreshed up to
  ten times a second; the stream-json `thinking` deltas become coarser but
  concatenate to the same text.

## Residual risks

- The bridge, the CLI and a watched subagent tail see fewer intermediate
  partial updates (accepted for API P2 too).
- A message appended by another path while reasoning streams (for example a
  tool ask from an earlier tool call) leaves the pending reasoning message
  not last; it is still posted by reference with the text today's chunk
  would have posted.
- Specs: `src/core/task/__tests__/TaskStreamProcessor.reasoning-throttle.spec.ts`.
  The estimate script lives outside the repo
  (`/tmp/reasoning-throttle-estimate2.py`).
