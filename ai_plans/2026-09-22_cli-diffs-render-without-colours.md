# CLI file-write diffs render as raw uncoloured text

## Symptom

In the interactive CLI every file edit prints its diff as dim grey text with the
raw SEARCH/REPLACE machinery visible:

```
● Edit(.cache/discord-summaries/1471527895439638528/summary.md) +41 -0
  ⎿  <<<<<<< SEARCH
     :start_line:1576                                          … +42 lines
     -------
     - BoxTops4Coochie ported r34 as the last port ...
     =======
     - BoxTops4Coochie ported r34 as the last port ...
```

Only the `+41 -0` counters carry colour. Nothing tells the reader which lines go
away and which arrive, and the `<<<<<<<` / `=======` / `:start_line:` lines are
protocol noise that costs four of the eight preview rows.

## Root cause (two independent defects, proven against stored task transcripts)

`apps/cli/src/ui/components/tools/FileWriteTool.tsx` already contains a
colour-capable branch: it calls `parseDiff()` and, when that returns hunks,
paints added lines on `theme.diffAdded` and removed lines on `theme.diffRemoved`.
The branch is dead code in practice, for two separate reasons.

### D1: `parseDiff` only understands unified diffs, `appliedDiff` never sends one

`apps/cli/src/ui/components/tools/utils.ts:129` starts a hunk only on a line
beginning with `@@`. A census over the 60 most recent task transcripts in
`~/.config/Code/User/globalStorage/qub-it.tumble-code/tasks/*/ui_messages.json`
(script: parse every `say: "tool"` / `ask: "tool"` message, `JSON.parse` its
`text`, bucket by `tool` and by the shape of `diff`):

| tool                 | fields present                         | `diff` format  | count |
| -------------------- | -------------------------------------- | -------------- | ----- |
| `appliedDiff`        | content, diff, diffStats, path         | SEARCH/REPLACE | 303   |
| `appliedDiff`        | diff, path                             | SEARCH/REPLACE | 13    |
| `newFileCreated`     | content, diffStats, path (**no** diff) | -              | 49    |
| `editedExistingFile` | content, diffStats, path (**no** diff) | -              | 10    |

316 of 316 `appliedDiff` payloads are SEARCH/REPLACE blocks, zero are unified.
Sample (`tls_util/make_self_signed_certs.sh`, stats `+1 -1`):

```
<<<<<<< SEARCH
:start_line:17
-------
    openssl genpkey ... -pkeyopt rsa_keygen_bits:1024 ...
=======
    openssl genpkey ... -pkeyopt rsa_keygen_bits:2048 ...
>>>>>>> REPLACE
```

`parseDiff` sees no `@@`, returns `[]`, and `FileWriteTool.tsx:118` falls back to
`<ResultRow>`, which prints the raw string dim. That is exactly the screenshot.

The producer grammar is `src/core/diff/strategies/multi-search-replace.ts:396`:
`<<<<<<< SEARCH` (an optional trailing `>` is tolerated), an optional
`:start_line:N`, an optional `:end_line:N`, an optional `-------` fence, the
search body, `=======`, the replace body, `>>>>>>> REPLACE`. Markers that occur
inside the payload are escaped with a leading backslash and unescaped by
`unescapeMarkers` (same file, line 91).

### D2: the two tools that _do_ send a unified diff put it in `content`, which the renderer never reads

`newFileCreated` and `editedExistingFile` carry no `diff` field at all. Their
`content` is a unified diff:

```
editedExistingFile → '@@ -1,15 +1,19 @@\n ---\n name: ...\n-description: How stage checkpoints, preflight cap ...\n+description: How stage checkpoints, fingerprinting ...\n'
newFileCreated     → '===================================================================\n--- /dev/null\n+++ recommendation-section.tmp.md\n@@ -0,0 +1,121 @@\n+\n+## Rekomendacja: ...'
```

`FileWriteTool` reads `toolData.diff` only (line 20), so for these 59 messages it
prints the header line and nothing else, so there is no preview at all.

## Fix

1. `utils.ts`: add `parseSearchReplaceDiff()`, a line-based state machine over
   the grammar above. Line-based rather than a port of the core regex because the
   CLI must render _partial_ diffs: while the model streams, the trailing
   `>>>>>>> REPLACE` has not arrived yet and the core regex matches nothing.
   An open block at end-of-input is emitted as a hunk.
   Escaped markers are unescaped for display, mirroring `unescapeMarkers`.
2. `utils.ts`: add `parseAnyDiff()`, which dispatches on the text: a
   `<<<<<<< SEARCH` marker picks the new parser, a well-formed
   `@@ -n,m +n,m @@` header picks the existing unified parser, anything else
   returns `[]` so the raw fallback still applies. The `@@` test is a full hunk
   header, not a bare `@@`, so a file whose _content_ happens to contain `@@` is
   not mistaken for a diff. `isDiffText()` answers the weaker question "is this
   a diff at all", which is what decides whether the raw fallback would be
   useful: a half-streamed SEARCH block parses into no hunks yet, and printing
   its scaffolding raw is exactly the symptom we are removing.
3. `FileWriteTool.tsx`: take the diff from `toolData.diff` and fall back to
   `toolData.content` when that content parses as a diff (D2). Render each hunk
   as a rectangular colour band under the same elbow connector the other tool
   renderers use: `-` lines on
   `theme.diffRemoved`, `+` lines on `theme.diffAdded`, context dim and
   unbanded, and a dim `@@ line N @@` header when the block declares
   `:start_line:`.

The preview caps (`MAX_HUNKS` 2, `MAX_HUNK_LINES` 8, both lifted when
`expanded`) are unchanged, but they now count real diff lines instead of
protocol noise.

### Band geometry, and why the padding is done by hand

Each line is padded to the widest line in its hunk, capped at 100 columns and at
`terminal columns - 8`, so the band is a rectangle that always fits one physical
row. The 8 is `2` for the bullet column, `5` for the connector, and `1` in
reserve, because ink overshoots: measured with `ink-testing-library` at 100
columns, a `wrap="truncate-end"` text that follows a 7-column prefix is handed
94 columns rather than 93, and the 101st column wraps onto a stray row. That
stray row would also eat one line of the dynamic tail's budget, which is the
mechanism behind the 2026-08-07 tail-clamp and the 2026-09-21 stale-height bugs.
For the same reason the component truncates over-long lines itself (slice plus
`…`) instead of leaving it to ink; `wrap="truncate-end"` stays on only as a
backstop for double-width glyphs, whose display width exceeds their length.

## Scope

Interactive TUI rendering only. No change to the diff strategies, to what the
core sends, or to the JSON/non-interactive output paths.

## Tests

- `utils.test.ts`, the SEARCH/REPLACE parser: a complete block, a block with no
  `:start_line:`, a block with no `-------` fence, several blocks in one payload,
  a truncated (streaming) block, escaped markers, and `parseAnyDiff` dispatch
  including the "content that merely contains `@@`" case.
- `FileWriteTool.test.tsx`: an `appliedDiff` message renders `-`/`+` bodies and
  no longer prints `<<<<<<< SEARCH`; an `editedExistingFile` message whose diff
  lives in `content` renders a preview; the hunk and line caps still bite; the
  raw fallback survives for text that is not a diff.
