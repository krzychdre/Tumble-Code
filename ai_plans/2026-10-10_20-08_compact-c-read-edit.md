# Compact profile, workstream C: robust read_file and edit

Status: done on `feat/compact-c-read-edit` (local only, not pushed, not merged). Part of
`2026-10-10_19-36_compact-small-model-profile.md` (row C).

## Why

A Qwen3.5-4B (Q4_K_M, 40,960-token window) copied the ` N |` prefix that `read_file` puts in front of every line
into its edit content, mixed up the SEARCH/REPLACE markers of `apply_diff`, and once "succeeded" with an edit
that landed in the wrong table. Under `compactProfile` workstream B offers `edit` (old_string/new_string) instead
of `apply_diff`; this workstream makes `read_file` return raw lines and makes `edit` tolerate what such a model
gets wrong, with short errors that show the real text of the file.

## Scope (files owned by row C)

- `src/core/tools/ReadFileTool.ts`: compact output and limits.
- `src/core/tools/EditTool.ts`: compact matching chain and errors.
- `src/core/tools/WriteToFileTool.ts`: line-number stripping under compact.
- `src/core/prompts/responses.ts`: compact error texts (new export, `formatResponse` untouched).
- New: `src/core/tools/helpers/compactRead.ts`, `src/core/tools/helpers/compactEdit.ts` (pure logic) and specs.

Every new behaviour is behind `isCompactProfile(task.apiConfiguration)`. With the flag absent or false the code
paths are the old ones, so tool results stay byte-identical (golden test plus the untouched tool specs).

## Shared contract (all workstreams)

1. `read_file` under compact: first line `File: <path> (lines <a>-<b> of <n>)`, then raw lines without a number
   prefix; when more lines follow, a last line
   `[Truncated: showing lines <a>-<b> of <n>. Call read_file with offset=<b+1> to read more.]`.
   Parameters `path`, `offset` (1-based), `limit`; `mode`/`indentation` are ignored (plain slice).
2. `edit`: `file_path`, `old_string`, `new_string`, optional `replace_all`; exactly one match unless
   `replace_all`; line-number prefixes and whitespace differences tolerated; a failed match quotes the closest
   snippet of the file.
3. `write_to_file` (`path`, `content`) for new files and full rewrites.

## Design

### read_file

- Limits per call: at most 400 lines (a larger `limit` is capped) and at most 16,000 characters of content,
  cut at a line boundary (at least one line; single lines keep today's 2,000-character cut).
- A trailing newline does not count as an extra line; `\r` of CRLF files is not shown.
- `offset < 1` is clamped to 1 instead of failing (a 0-based offset of 0 means the first line).
- Empty file and offset past the end get one short note line after the `File:` line.
- PDF/DOCX/IPYNB text: the extractor's own `N | ` prefixes are removed and the same framing and limits apply.
  Images and other binary files are unchanged.
- Missing `path`: short error with a one-line example; the failure is still recorded as today.

### edit (chain, first hit wins)

1. Exact match on LF-normalised text (today's rule).
2. If old_string carries line-number prefixes (pattern `^\s*\d+\s*\|\s?` on all or nearly all non-empty
   lines): strip them from old_string, and from the prefixed lines of new_string, then exact match again.
3. Line-based tolerant match: lines equal after trimming trailing whitespace; then lines equal after trimming
   both ends and collapsing inner whitespace. The replacement keeps the file's line endings (CRLF is restored)
   and shifts new_string's indentation by the difference between old_string and the matched lines.
4. Substring match where whitespace runs may differ (for an old_string that starts or ends inside a line).

Errors under compact are plain text starting with `Error:`, at most about 800 characters, with one example
call. Multiple matches: the count, the line numbers, and an example that adds the line above the first match.
No match: the closest window of the file by line similarity (Levenshtein, raw text, no numbers) and an example
using one of its lines. Empty old_string: creates a missing file, writes into an existing empty file, and
otherwise quotes the last 3 lines as the old_string to use for appending. Mistake counting is unchanged: every
failure path calls `recordFailure` exactly where the old path did.

### write_to_file

Under compact, if every non-empty line carries the old `N | ` prefix (a trailing newline or blank lines no
longer prevent it), the prefixes are stripped; also in the streaming preview so preview and saved file agree.

## Tests

- `helpers/__tests__/compactRead.spec.ts`, `helpers/__tests__/compactEdit.spec.ts`: pure logic.
- `__tests__/readFileTool.compact.spec.ts`, `__tests__/editTool.compact.spec.ts`,
  `__tests__/writeToFileTool.compact.spec.ts`: tool level, including the coffee-diary case and flag-off parity.
- Unchanged and passing: `readFileTool.spec.ts`, `editTool.spec.ts`, `writeToFileTool.spec.ts`,
  `compact-off-golden.spec.ts`.

## Needs from other rows

- B (tool definitions): the compact `read_file` description should say that the result starts with a
  `File: <path> (lines a-b of n)` line, has no line numbers, returns at most 400 lines per call, and that the
  `[Truncated: ...]` line names the next `offset`. The compact `edit` description should say that `old_string` is
  copied exactly from the file and must match once (or `replace_all`), and that an empty `old_string` creates a
  missing file; for appending, the last lines of the file are the `old_string`. Do not advertise the tolerated
  line-number prefixes. The compact errors use `TOOL_MINIMAL_EXAMPLES` for `edit`, `read_file` and
  `write_to_file` (`getToolMinimalExample`); keep those entries valid for the compact schemas.
- A (prompt): one sentence is enough: read_file shows raw lines without numbers; never put line numbers into
  edits; use `edit` for changes and `write_to_file` for new files or full rewrites.
- D: nothing; compact read results are at most about 16 kB, below the spill and prune thresholds.

## Follow-ups (outside row C, not gated)

- `write_to_file` without the flag keeps the line numbers when the content ends with a newline
  (`everyLineHasLineNumbers` tests every line, the empty last one included).
- `edit` without the flag saves CRLF files with LF line endings.
- PDF, DOCX and IPYNB text is numbered twice without the flag (the extractors number it and `ReadFileTool`
  calls `addLineNumbers` again).
- The whitespace helpers of `EditFileTool.ts` are module-private; `helpers/compactEdit.ts` has its own variant
  (line-based, re-indenting, edges trimmed before the substring pattern). `edit_file` could move to it.

## Review fixes (edit safety)

On `feat/compact-fix-edit-safety` (commits `68612d137`, `59e637b10`), after a review that reproduced wrong edits
reported as success. Rule: when the tool is not sure, it refuses with the closest-snippet error. This supersedes
the edit chain and the `write_to_file` rule described above.

- Chain order: old_string as sent goes through exact, then the tolerant steps (trailing whitespace, collapsed
  whitespace, whitespace runs inside a line) before any prefix stripping. The tolerant steps must agree on one
  place (overlapping matches count); the strictest step that can replace safely does it. A prefix-stripped
  old_string matches whole lines only; new_string loses prefixes only then, and the result says so.
- Re-indentation only when old_string's indentation levels map one to one onto the file's (deeper onto deeper);
  a deeper new line keeps its extra indentation only when the units are the same text. Otherwise refused, quoting
  the exact file lines. The substring step needs the file's indentation after each line break and never adds lines
  after a single-line match.
- Only the replaced region changes: matching runs on a BOM-less LF view, the replacement is mapped back onto the
  original bytes (BOM, CRLF and mixed line endings kept), new_string takes the region's line ending. Whitespace
  means spaces and tabs only.
- `write_to_file` under compact is the non-compact path again; the empty-old_string create path writes new_string
  the same way (old rule only, line endings as sent). A missing or null old_string is a missing-parameter error.
- Tests: reviewer cases, indentation and line-ending cases, and a seeded property test (random files with mixed
  line endings and BOM, every tolerant step) that nothing outside the matched region changes.
