# @-mention file search: cache the workspace file list (SVC-12 leftover)

## Problem

`searchWorkspaceFiles` (`src/services/search/file-search.ts`), called by the `searchFiles`
webview handler (`src/core/webview/messageHandlers/enhanceAndSearch.ts`) for every
@-mention query, spawned a full `rg --files --follow --hidden ...` walk of the workspace,
then built a new `Fzf` over the whole list, for every query. The webview debounces 200 ms
(`ChatTextArea.tsx`), so a word typed with pauses sends one request per pause: typing
"mention" char by char is 7 requests, 7 walks of the same list.

## Measured (before)

Temporary vitest harness (not committed): real ripgrep binary, real fs, vscode mocked with
default settings. 3 cold-to-cold queries, then "m", "me", ..., "mention" in sequence.

| workspace (files listed) | per query (ms) | "mention" char by char | rg spawns |
| --- | --- | --- | --- |
| Roo-Code (3.4k) | 106, 73, 51 | 359 ms | 7 |
| esp-idf (17k, capped at 10k) | 134, 126, 126 | 1254 ms | 7 |
| jupyter (55k, capped at 10k) | 149, 176, 153 | 1112 ms | 7 |

The raw walk on Roo-Code alone is only about 11 ms; the rest of each query was building the
directory set, the search items and the `Fzf` index (it converts every entry to code points).

## Change

- `getWorkspaceFileList(root)`: one cache entry per resolved workspace root (at most 8
  roots), storing the walk's PROMISE, so concurrent queries on a cold cache share one walk.
  The entry records the ripgrep arguments and limit it was made with (the `search.*` ignore
  settings and `maximumIndexedFilesForFileSearch` are read per query as before); different
  settings mean a new walk. A failed walk is dropped, not kept.
- `WorkspaceFileList` keeps the search items and one `Fzf` per result limit; each query only
  runs `find` on it. Result objects are copied before they leave, since the originals are
  cached.
- Invalidation reuses the watcher `WorkspaceTracker` already runs (`**`):
  `noteWorkspaceFileEvent("create" | "delete" | "change", fsPath)`.
  - create / delete inside a cached root drop that root's list, except under the directories
    the listing excludes (`node_modules`, `.git`, `out`, `dist`), so builds do not keep
    emptying the cache;
  - a change (or create / delete) of `.gitignore`, `.ignore` or `.rgignore` anywhere drops
    every list (a parent's ignore file applies too);
  - plain edits change nothing.
- Time to live of 30 s after the walk finishes, as the backstop for what the watcher does not
  see (`files.watcherExclude`, followed symlink targets, a global gitignore, a task cwd outside
  the workspace folders).
- `.rooignore` filtering is untouched: it runs in the handler on the returned results
  (pinned by `webviewMessageHandler.searchFiles.spec.ts`). The ripgrep arguments and limit
  are pinned by a new spec in `file-search.spec.ts`. `executeRipgrepForFiles` stays uncached.

## Measured (after, same harness, same runs interleaved)

| workspace | per query (ms, first is cold) | "mention" char by char | rg spawns |
| --- | --- | --- | --- |
| Roo-Code | 127, 31, 12 | 189 ms | 0 |
| esp-idf | 233, 45, 56 | 976 ms | 0 |
| jupyter | 193, 50, 51 | 335 ms | 0 |

What remains per query is the fuzzy match itself (one-letter queries match almost every
entry of a 10k list and sort them) and the `lstat` of the 20 results. The machine was shared
(load around 2.5), so single numbers are noisy; the spawn count is exact.

## Not changed (noticed)

- Without a current task the handler builds and initializes a temporary
  `RooIgnoreController` (with its own file watcher) for every query.
- A walk that hit the 30 s ripgrep timeout returns a partial list; it is cached like a full
  one (before, every query would have hit the same timeout).
