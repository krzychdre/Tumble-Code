# Fix Windows absolute file links (C:/..., C:\..., UNC)

**Branch:** `fix/windows-absolute-file-links`
**Date:** 2026-09-26
**Type:** bug fix (webview-ui)
**Follow-up from:** the 2026-09-24 refactor master plan (deferred findings register — Windows path links were broken).

## Symptom

File links in the webview that carry a Windows absolute path (`C:/Users/...`, `C:\Users\...`) were broken:

- Markdown links like `[a](C:/Users/a.ts)` rendered with an **empty href** — dead, unclickable.
- `file:///C:/Users/a.ts` links opened the wrong thing: the click handler produced `/C:/Users/a.ts`.
- Tool-result rows (new-file jump icon, file-changes panel, codebase-search results) sent `./C:/Users/...` to the extension, which resolved it against the workspace cwd instead of opening the absolute path.

## Root cause (with evidence)

All mangling happens webview-side; the extension handler is correct on Windows for raw drive paths (`path.isAbsolute("C:/x")` is true, `vscode.Uri.file` handles both separators). Three layers, each measured:

1. **Href stage — the drive letter parses as a URL scheme.**
   Measured with react-markdown 10.1.0's `defaultUrlTransform`:

    - `C:/Users/test/app/a.ts` → `""`
    - `C:\Users\test\app\a.ts` → `""`
    - `file:///C:/Users/test/app/a.ts` → `""` (rescued by our `/^file:/` fallback)
    - `\\server\share\a.ts` → kept (no colon → no scheme)
      `markdownUrlTransform` (webview-ui/src/utils/markdown.ts) only rescued `file:` and file-with-line URLs, so bare drive paths died here.

2. **Click stage — two string bugs in MarkdownBlock.tsx.**

    - `href.replace("file://", "")` on `file:///C:/Users/a.ts` yields `/C:/Users/a.ts` — a leading slash that makes `path.isAbsolute` false on win32, so the handler joins it with cwd.
    - The `./`-prefix branch turned bare `C:/Users/a.ts` into `./C:/Users/a.ts`.
    - **Markdown percent-encodes backslashes in link destinations** (measured: `[a](C:\Users\test\a.ts)` reaches the component with href `C:%5CUsers%5Ctest%5Capp%5Ca.ts`), so even a correct classifier would have missed backslash paths without decoding first.

3. **Producer stage — blind `"./"` prepending.**
   `EditFileToolRow` (`"./" + tool.path`), `FileChangesPanel` (`"./" + path`) and `CodebaseSearchResult` (`"./" + filePath`) all mangled absolute Windows paths into workspace-relative ones.

## Fix

New pure helpers in `webview-ui/src/utils/windows-file-links.ts`:

- `isWindowsAbsolutePath(p)` — regex `^(?:[a-zA-Z]:[\\/]|\\\\)`, decoded first so percent-encoded input classifies correctly. Exactly one ASCII letter before the colon, so `CD:/x` and `README.md:6` don't match.
- `decodeFilePath(p)` — best-effort `decodeURIComponent` with fallback (invalid sequences like `50%/x` pass through).
- `toOpenFileLinkText(path)` — the openFile message text: Windows drive/UNC, POSIX absolute and `./`-relative paths pass through untouched; bare relative paths get the `./` prefix (existing behavior).

Wired into:

- `markdownUrlTransform` — also rescues Windows absolute hrefs.
- `MarkdownBlock` click handler — decodes the destination, strips `file://` (one slash) and the leading slash before a drive letter, then uses `toOpenFileLinkText`.
- The three producers use `toOpenFileLinkText` instead of `"./" + path`.

## Test coverage (lowest layer that would have failed)

- `webview-ui/src/utils/__tests__/windows-file-links.spec.ts` (new) — pure helper unit tests: drive paths both slash styles, case-insensitive drive, UNC, percent-encoded variants, negatives (`CD:/x`, `C:`, POSIX, relative, `README.md:6`), `decodeFilePath` edge cases, `toOpenFileLinkText` passthrough/prefix behavior.
- `MarkdownBlock.spec.tsx` — extended the existing file-links table with `file:///C:/...` (with and without `:12`), bare `C:/...`, and backslash `C:\Users\...` (href carries the percent-encoded form; the click message carries the decoded path).
- `ChatRow.diff-actions.spec.tsx` — newFileCreated jump icon sends a backslash drive path untouched.
- `CodebaseSearchResult.spec.tsx` (new) — relative path keeps `./`; Windows drive path passes through. (Note: JSX string attributes don't process `\\` escapes — the Windows path is passed via a TS expression.)
- `FileChangesPanel.spec.tsx` — existing relative-path coverage still passes (regression).

All tests are pure string/React logic — no `process.platform` dependence, deterministic on Windows CI. No e2e needed: the failure mode is fully representable at unit/component level.

## Edge cases considered

- `file://server/share/a.ts` (UNC as file URL): still classified as local, `replace(/^file:\/\//)` leaves `server/share/a.ts` — same as before this change (pre-existing gap, harmless on POSIX, deferred).
- `README.md:6` file-with-line links: not matched by the drive regex (needs a separator after the colon).
- `CD:/weird`: rejected — Windows drive letters are single chars.
- Extended-length paths (`\\?\C:\...`): matched by the UNC branch and passed through; the extension's `vscode.Uri.file` handles them.
- Line numbers on drive paths (`C:/a.ts:12`): the line-suffix regex extracts `:12` after decoding; the remaining path is still classified as a Windows absolute path.
- Security: the new href rescue only affects which links the _existing_ click handler processes; the extension handler keeps its own path resolution, and `javascript:`/`data:` schemes stay emptied (covered by existing spec table).

## Verification

- `webview-ui` targeted vitest: all specs green (94 tests across 5 files).
- eslint via pre-commit hook (`eslint src --max-warnings=0`) — clean.
- `tsc` + `pnpm knip` — run before push (see PR).

## Deferred

- `file://server/share` UNC-via-file-URL links resolving to a relative path (pre-existing, rare).
- `CodebaseSearchResult` label splitting only on `/` — backslash paths show the full path as the "file name" (cosmetic).
