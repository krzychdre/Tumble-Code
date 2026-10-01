# Legacy read_file requests: images reach the model, same limits as the new format

Status: implemented on `fix/read-file-legacy-images` (simplification round 2, item A2).

## Touched files

- `src/core/tools/ReadFileTool.ts`
- `src/core/tools/__tests__/readFileTool.spec.ts`
- `.changeset/read-file-legacy-images.md`

## Problem

`ReadFileTool.executeLegacy` (the legacy `{ files: [{ path, lineRanges? }] }` input, which weak models still
send and which stays supported, see `docs/architecture.md` "Do not touch") had its own copy of the reading code:

- Images: it called `processImageFile` and threw the result away, pushing only
  `File: x\n[Image file - content processed for vision model]` (old lines 758-760). The model never saw the image,
  while the single-file path attaches `imageDataUrl` and `buildAndPushResult` turns it into an image block.
- It validated every image against a cumulative total of `0` (old line 752), so several images in one call were
  never checked against `maxTotalImageSize`.
- Line ranges were cut from the whole file with no per-range limit (old lines 773-786): a range like `1-100000`
  returned everything.
- PDF/DOCX/ipynb files and models without image support got `Error: Cannot read binary file`.

## Fix

The read pipeline of the new path is now one method, `readEntries`, that takes a list of internal entries and, per
entry: checks `.rooignore`, asks for approval (one card per file, as before), reads the file
(`readApprovedFile`: directory check, binary formats with the shared `ImageMemoryTracker`, text), then pushes one
result with `buildAndPushResult` (text joined by `\n\n---\n\n` as before, plus the image blocks).

`executeNew` builds one entry from its parameters; `executeLegacy` converts each legacy entry with
`legacyEntryToInternal`: each 1-based inclusive line range becomes an offset/limit slice (capped at
`DEFAULT_LINE_LIMIT`), read in slice mode one after another. The `File: <path>` / `---` output format is unchanged,
so nothing that matched on it breaks.

Each entry is updated in place (no lookup by path), so two legacy entries for the same file no longer overwrite each
other's result.

Kept on purpose:

- Legacy approval stays one card per file, never the batch card: the batch ask has no top-level
  `isOutsideWorkspace`, so auto-approval (`src/core/auto-approval/index.ts:258-262`) would approve an
  outside-workspace file in a batch without the "outside workspace" setting.
- Legacy approval cards still carry no `toolCallId`: `toolAskIdentity.ts` treats cards with the same id as one
  invocation, which would merge the cards of different files.

## Tests

`src/core/tools/__tests__/readFileTool.spec.ts`:

- regression: a legacy request for an image now pushes an array with the image block (failed before the fix);
- new: two legacy images share one `ImageMemoryTracker` (failed before the fix);
- new: several line ranges read as slices, each capped at 2000 lines;
- updated expectations where the legacy wording now matches the new path (`Binary file (exe) - content not
displayed`, `IMPORTANT: File content truncated.`, line ranges read through `readWithSlice`).

## Notes / caveats

- Wording visible to the model changed for legacy requests in the cases above (it is now the same as for the new
  format). The directory error gains "Use list_files tool instead.".
- Pre-existing in the shared slice code (not changed here): an offset past the end of the file yields
  `Note: File is empty` instead of the "beyond file end" message from `readWithSlice`.
