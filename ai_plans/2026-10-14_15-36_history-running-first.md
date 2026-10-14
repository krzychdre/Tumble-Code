# Running tasks listed first in the task lists

**Status:** implemented on `feat/history-running-first`, pull request open, not merged
**Related plans:** the plan of the stacked branch `feat/history-pin-task` (pinned tasks go above the running ones),
the changesets `history-running-indicator.md` and `history-running-on-ancestors.md` (the running status this
ordering reads)
**Touched:**

- `webview-ui/src/components/history/types.ts` (`ListSection`, `listSection`, `bySection`)
- `webview-ui/src/components/history/useTaskSearch.ts` (stable partition after the status mapping)
- `webview-ui/src/components/history/useGroupedTasks.ts` (group sort, `toDayRows` section header)
- `webview-ui/src/components/history/HistoryView.tsx` (renders the section header row)
- `webview-ui/src/components/history/HistoryPreview.tsx` (never cuts off a working group)
- `webview-ui/src/i18n/locales/*/history.json` (`section.active`, all 18 locales)
- tests: `useTaskSearch.spec.tsx`, `useGroupedTasks.spec.ts`, `HistoryPreview.spec.tsx`, `HistoryView.a11y.spec.tsx`

## Symptom

The owner: "Na liście tasków Tumble wyświetlaj jako pierwsze te, które są aktualnie uruchomione." (In the Tumble
task lists, show the tasks that are currently running first.) A task that works but was started a few days ago sat
deep in the History view among its day, and the "Recent Tasks" preview on the welcome screen showed only the four
newest groups, so an older working task did not appear there at all.

## What was happening

- `useTaskSearch.ts:219-230` (before the change) marks the rows of working tasks with `runningStatus`, the root of
  a working subtask included (`withAncestors`, line 22), but keeps the order of the sort option.
- `useGroupedTasks.ts:84-85` sorts the parent-child groups by the parent's timestamp, newest first, whatever the
  order of the incoming list. In the grouped (not searching) History view and in the preview this sort, not the
  sort option, decides the order.
- `useGroupedTasks.ts:155-166` (`toDayRows`) inserts a day header where the next group starts a new calendar day;
  it assumes the groups are newest first.
- `HistoryPreview.tsx:19-20` shows `groups.slice(0, 4)`.

## Fix

One rule, "a row whose task works or waits for the user (or whose subtask does) goes first", lives in
`types.ts`: `listSection(item)` returns `"active"` when the row carries a `runningStatus`, and `bySection` is a
comparator on that. Because `Array.prototype.sort` is stable, sorting an already ordered list with `bySection` is a
stable partition: active rows first, the rest after, each part in the order it had.

- `useTaskSearch`: the partition runs in the memo that maps the running status, after the search and the sort, so a
  status change still does not search and sort again, and rows of resting tasks keep their object identity. It is
  skipped in a search ranked by relevance (`searchQuery` set and `sortOption === "mostRelevant"`): there the best
  match must stay first, and a weak match must not jump above it only because it works. With any other sort option
  chosen during a search, the working results go first.
- `useGroupedTasks`: groups sort by `bySection` on the parent first, then by the parent's timestamp. The root
  carries the status of its working subtask (`withAncestors`), so the whole tree moves up; the subtree itself is
  untouched (children stay newest first inside it).
- `toDayRows`: the active groups get one section header ("Active", `history:section.active`) and no day header;
  the day headers follow for the rest. Without this the day headers would repeat ("Yesterday", "Today",
  "Yesterday") with duplicate row keys.
- `HistoryPreview`: shows all active groups, even more than four, then fills up to four with the rest.

A task leaves the section the moment the host drops it from `runningTasks` and falls back to its day.

## Tests

- `useTaskSearch.spec.tsx` "working tasks first": an oldest working task goes first; a task waiting for the user
  goes first too; the order within the working and the resting part follows the sort option (newest and oldest);
  the root of a working subtask goes first; a `mostRelevant` search keeps the relevance order, another sort option
  during a search puts the working result first.
- `useGroupedTasks.spec.ts`: the groups of working trees sort first, then by timestamp; `toDayRows` puts them under
  one section header above unique day headers, and adds no section header when nothing works.
- `HistoryPreview.spec.tsx`: five working groups are all shown (past the limit of four).
- `HistoryView.a11y.spec.tsx`: a root from three days ago whose subtask works renders under the "Active" header
  above today's header and today's task.

Gates: the four specs and the rest of `components/history` (172 tests), `tsc --noEmit` in `webview-ui`, eslint on
the touched files, `check-react-compiler-bailouts`, `find-missing-translations`, `find-unused-i18n-keys --check`,
`pnpm knip`.

## Notes

- Seen while reading, not changed: in the grouped History view the sort option has no effect, because
  `useGroupedTasks` re-sorts the groups by timestamp (newest first); only the flat search results follow
  "Oldest", "Most Expensive" and "Most Tokens". The day headers rely on that newest-first order.
- The "Active" section has no collapse control; the number of working tasks is small.
- Nothing changed on the host: the order is a pure view of `runningTasks`, so the CLI and the cloud are unaffected.
