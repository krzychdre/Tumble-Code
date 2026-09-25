# write_to_file: diff view opened for a truncated partial path (SVC-17 leftover)

## Problem

While a write_to_file call streams, `WriteToFileTool.handlePartial()` opens the
diff view (`DiffViewProvider.open(relPath, editType)`) once
`BaseTool.hasPathStabilized()` has seen the same `path` in two consecutive
partial blocks and `content` is present. `execute()` then reused any open
session (`if (!task.diffViewProvider.isEditing)`) without checking whose path
it was.

Of the file-writing tools, only write_to_file opens the diff during the
partial phase. apply_diff, edit, edit_file, search_replace variants and
apply_patch only show a streaming row; they open the diff inside
`applyComputedEdit()` with the final path.

## Is it reachable? Yes

`NativeToolCallParser.processStreamingChunk()` runs `partial-json` on the
accumulated arguments. partial-json drops an unfinished escape sequence at the
end of a string (measured):

| accumulated arguments                  | parsed `path` |
| -------------------------------------- | ------------- |
| `{"content":"x","path":"a/b`          | `a/b`         |
| `{"content":"x","path":"a/b\u0`       | `a/b`         |
| `{"content":"x","path":"a/b\u002`     | `a/b`         |
| `{"content":"x","path":"a/b\u002e` | `a/b.`        |

So two chunks in a row can carry the same truncated path. This needs the model
to emit `content` before `path` (with `path` first, `content` is still
undefined while the path streams and handlePartial returns early) and an
escape sequence split across chunks (a `\uXXXX` escape of a non-ASCII or
escaped character, or `\\`). Empty argument deltas cannot cause it: the raw
chunk processor drops them.

Measured result on main with the real parser, tool and DiffViewProvider on a
temporary directory (chunks `{"content":"hello\n","path":"a/b`, `\u0`, `02e`,
`ts"}`): `a/b` contains `hello\n`, `a/b.ts` does not exist, the approval card
names `a/b.ts`, and the tool result tells the model it created `a/b`.

## Fix

`WriteToFileTool.dropDiffSessionForOtherPath(task, relPath)`: when a session is
open (`isEditing`) and `editTypeOf(relPath)` is undefined (the session is for
another path), call `revertChanges()`. That removes the empty file (and the
directories) a "create" open made, or restores the original of a "modify", and
resets the session. Called:

- in `execute()` right after the parameter checks, before the access check and
  the create/modify decision, so every later branch sees either no session or
  one for the final path;
- in `handlePartial()` before the create/modify decision, so the diff view
  switches to the final path as soon as it stabilizes during the stream (and
  the later `update()` does not stream into the wrong document).

`existsForEdit()` already fell back to the disk for a session of another path
(TL-2); after the revert the disk no longer holds the truncated file.

## Tests

`src/core/tools/__tests__/writeToFileTool.truncatedPath.spec.ts` feeds real
chunks through `NativeToolCallParser` into the real tool and a real
`DiffViewProvider` (only the VS Code editor side is faked):

1. the parser yields `a/b`, `a/b`, `a/b.`, `a/b.ts` and the diff opens for `a/b`
   (reachability, passes before and after);
2. execute() writes only `a/b.ts`, `a/b` does not exist (failed before);
3. an extra chunk lets the final path stabilize: handlePartial reopens for
   `a/b.ts` before execute (failed before);
4. a path that was complete from the start keeps one session (guard).

## Out of scope

`hasPathStabilized()` itself still accepts a truncated path; making it stricter
(for example requiring the closing quote) would need the raw arguments, which
the partial block does not carry. The revert makes the premature open harmless
instead.
