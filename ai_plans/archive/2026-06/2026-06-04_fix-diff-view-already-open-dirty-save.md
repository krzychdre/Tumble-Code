# Fix: file left dirty + "newer version on disk" after Tumble writes an already-open file

**Date:** 2026-06-04
**Branch:** `fix/diff-view-already-open-dirty-save`
**Status:** ✅ ROOT CAUSE PROVEN BY TRACE + FIXED. See §8 (definitive root cause) and §9 (fix). §1–§7 are the
investigation trail (several earlier hypotheses were ruled out by the runtime traces — kept for the record).

---

## 1. Reported symptom

> When Tumble creates/edits a file, at the end the editor shows it as **unsaved (dirty)**. Accepting the save leaves it dirty; a **manual** save then warns _"the file has a newer version on disk — overwrite?"_. The file appears to have been **reformatted** in the process — a trailing newline at end-of-file seemed to be the trigger.

Confirmed with the user:

| Question                                                         | Answer                                                                  |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------- |
| New vs existing files?                                           | **Both**                                                                |
| Is the file already open in an editor tab when Tumble writes it? | **Yes, already open**                                                   |
| How is the write approved?                                       | **Manual approve each time** (auto-approval on, `alwaysAllowWrite` off) |

The "already open in a tab" answer is the decisive new dimension — prior fixes (#18/#19/#23/#24) all targeted the **diff tab**, not a separately-open normal editor of the same file.

---

## 2. What "newer version on disk" actually means

VS Code's `TextFileEditorModel` shows the _save-conflict_ dialog **only** when:

1. the in-memory buffer is **dirty**, AND
2. the on-disk version (mtime/size/etag) is **newer** than the version VS Code recorded when it last loaded/saved that buffer.

Condition (2) requires that **something wrote the file behind VS Code's back** (i.e. not via that buffer's own `save()`) while VS Code held a dirty buffer. In this codebase the only writes that bypass VS Code are `fs.writeFile(...)` in:

- `saveDirectly()` (PREVENT_FOCUS_DISRUPTION path) — **ruled out**, see §3.
- `flushPendingSaveDirectly()` (stale-session recovery) — `DiffViewProvider.ts:471`.
- `open()` initial empty-file create — `DiffViewProvider.ts:114` (before any dirty buffer exists).
- `closeDiffTab()`'s revert path indirectly via `document.save()` after an `fs.writeFile`.

So the symptom points at an `fs.writeFile` fallback firing while a dirty buffer of the same file is open.

---

## 3. Evidence gathered (environment + code)

### Ruled OUT

- **PREVENT_FOCUS_DISRUPTION experiment** — read from extension global state (`QUB-IT.tumble-code`): `preventFocusDisruption: false`. ⇒ all writes use the **diff path** (`open → update → saveChanges`), not `saveDirectly`. Confirmed all three tools (`WriteToFileTool`, `EditFileTool`, `ApplyDiffTool`) take the same diff path in this mode.
- **External formatter on save** — exhaustive sweep of user `settings.json`, VS Code profiles, and per-workspace storage found **no** `editor.formatOnSave`, `editor.codeActionsOnSave`, `files.insertFinalNewline`, `files.trimTrailingWhitespace`, or `files.autoSave`, and **no** `[markdown]` language block.
- **markdownlint / yaml-formatter extensions** — installed (`davidanson.vscode-markdownlint`, `kennylong.kubernetes-yaml-formatter`) but neither auto-edits on save without `codeActionsOnSave`. markdownlint's MD047 ("single trailing newline") only shows a diagnostic squiggle here. ⇒ the trailing newline the user saw is **Tumble's own** final-newline insertion (`update()` `DiffViewProvider.ts:171-178`), surfacing as the visible diff between a stale buffer and what reached disk — not an external plugin.

### Confirmed

- The diff **happy path** provably leaves the file clean: `saveChanges()` calls `document.save()` (buffer↔disk consistent), then `closeDiffTab()` skips its revert when the doc is clean. No behind-the-back write, no dirty buffer.
- This fork has shipped **five** reactive fixes for this exact symptom family:
    - **#18** (`09739193c`) — recover writes stranded when `reset()` races `saveChanges()` (introduced `pendingSave` + `flushPendingSaveDirectly` via `fs.writeFile`).
    - **#19** (`adea58c12`) — "silent save failures" — explicitly documents that `document.save()` can resolve **`false`** silently with no error in dev tools.
    - **#23** (`6dbacc141`) — close the stale **diff tab** left open & dirty after save; revert its modified doc to disk.
    - **#24** (`45f7b1689`) — retry a refused `tabGroups.close()` when `Tab.isDirty` lags.
- ⇒ Both prerequisites for the symptom are **known, observed conditions** in this fork: (a) `document.save()` returning `false`, and (b) a dirty tab surviving a "successful" save.

---

## 4. Root-cause hypothesis (to be confirmed by trace)

When the target file is **already open in a normal editor tab**:

1. `open()` (`DiffViewProvider.ts:117-138`) closes the user's clean editor tab and sets `documentWasOpen = true`, then opens the diff (modified side = the file's `TextDocument`).
2. `update()` streams edits → buffer dirty; final-newline may be appended (`:171-178`).
3. `saveChanges()` calls `document.save()` (`:323`). **If it returns `false`** (the #19 silent-failure condition, plausible when the doc is the modified side of a diff), the code falls back to `flushPendingSaveDirectly()` → `fs.writeFile` (`:471`) — disk now advanced **behind VS Code's back**; the buffer is **still dirty**.
4. `saveChanges()` reopens the file as a normal editor (`showTextDocument`, `:339`, because `documentWasOpen`). That editor shares the still-dirty buffer.
5. `closeAllDiffViews → closeDiffTab` (`:685`) reverts the dirty modified doc to on-disk content and calls `document.save()` (`:708`) to clear the flag — **but its return value is not checked**. If that `save()` also returns `false` (same condition), the buffer stays dirty.
6. Net state: a normal editor tab, **dirty**, while disk was last written by `fs.writeFile` ⇒ on manual save VS Code reports **"newer version on disk."**

This explains why #23/#24 didn't end it: they cleared the diff tab's flag but (a) didn't verify `closeDiffTab`'s own `save()` succeeded, and (b) didn't reconcile a _separately-open_ normal editor whose model VS Code now considers in conflict with the `fs.writeFile`-advanced disk.

**Alternative/contributing hypotheses to keep open:** the `open()` close-then-`showTextDocument`-reopen dance itself desyncs VS Code's recorded disk-state for the reopened model even when every `save()` returns `true`; or `document.save()` returns `true` but VS Code's file watcher races the reopen.

---

## 5. Verification plan (do this BEFORE writing the fix)

Per project rule (prove root cause with real data — no symptom fixes), add temporary instrumentation that records the full save lifecycle, then reproduce once.

Instrument `DiffViewProvider` to log (to an OutputChannel **and** `/tmp/tumble-dvp-trace.log`) for one write:

- `open()`: `editType`, `fileExists`, matching file tabs found + which were closed, `documentWasOpen`.
- `update()`: whether a final newline was appended; EOL of `newContent`.
- `saveChanges()`: `isDirty` before save; **`document.save()` return value**; which branch taken (editor save / `!saved` fallback / `!isDirty` + pending fallback / stale recovery); `isDirty` after; trailing-newline + EOL of `editedContent` vs `newContent`; on-disk bytes after (`fs.readFile`); final `document.isDirty`.
- `closeDiffTab()`: doc `isDirty`, **revert `document.save()` return value**.
- End-of-write snapshot: every `file`-scheme tab/document for the path with its `isDirty`.

**Repro steps for the user:** F5 → "Run Extension" (dev Extension Host), open a file that's already in a tab, have Tumble edit it, approve, observe the dirty/overwrite symptom, then paste `/tmp/tumble-dvp-trace.log` (or I read it directly).

The trace pins which branch fires and whether a `save()` returns `false` — turning the hypothesis into fact.

---

## 6. Fix design (provisional — finalize after trace)

Likely a combination, scoped to the confirmed branch:

- Check the return value of every `document.save()` (including `closeDiffTab`'s revert); on `false`, reconcile the open editor's model with disk deterministically (e.g. `workbench.action.files.revert` on the document, or re-apply + retry) so no dirty buffer is left against an `fs.writeFile`-advanced disk.
- Avoid the close-then-reopen churn for an already-open file where it isn't needed, so VS Code's recorded disk-state for the user's tab is never invalidated.
- Add regression tests to `DiffViewProvider.spec.ts` / `.race.spec.ts` modeling: file already open in a normal tab + `document.save()` returning `false` + `fs.writeFile` fallback ⇒ assert the final document is **not** dirty and no second behind-the-back write strands it.

---

## 6a. Runtime trace #1 — findings (2026-06-04 ~18:47Z)

Repro: AI **created** `the-narrow-strait.md`, then **modified** it. User: _"file was created, I agreed on save but it wasn't saved; manual save had no newer content so it wrote ok."_

Captured trace:

```
open        create  fileExists=false documentWasOpen=false
update.final create  appendedFinalNewline=false newContentTail="\n\n*The End*\n"
                     ← NO saveChanges.* for the create at all
open        modify  fileExists=true  documentWasOpen=true  closedTabLabels=[the-narrow-strait.md]
                     originalContentTail="\n\n*The End*\n"   ← create's content WAS on disk
update.final modify
saveChanges.enter modify isDirty=true hasPending=true documentWasOpen=true
saveChanges.save  modify saveReturned=true isDirtyAfter=false
                     ← NO saveChanges.end for the modify either
```

**Key deductions:**

1. The **create's content reached disk** (the modify's `open` read it back) but produced **no `saveChanges.save`**. The only disk-content writers are `document.save()` (would log), `saveDirectly` (disabled), or `flushPendingSaveDirectly` → `fs.writeFile`. ⇒ **the create was persisted by the `fs.writeFile` recovery path**, which writes behind VS Code's back and **leaves the buffer dirty** — exactly the reported "agreed on save but it wasn't saved; no newer content on manual save."
2. The recovery path only runs when `saveChanges` finds `edit` missing/stale (lines 271-282), i.e. **`reset()` raced `saveChanges()`** for the create.
3. The modify's `saveChanges.save` succeeded (`isDirtyAfter=false`) but **`saveChanges.end` never logged** ⇒ a `recoverIfStale()` after the save also tripped (stale flipped during the post-save awaits), so even a clean editor-save gets re-routed through `fs.writeFile`. Same race, later window.

⇒ **Root cause (revised):** `reset()` (via `TaskStreamProcessor.resetStreamingState()`, called at the top of every API request in `TaskApiLoop.ts:374`, and at tool-end in the write tools) is firing in the same window as `saveChanges()`. The fork's #18/#19 "recovery" mitigations convert that race into an `fs.writeFile`-behind-VS-Code's-back write, which is itself the source of the dirty-buffer / newer-on-disk symptom. The fix must stop the race (or make the recovery reconcile the open buffer), not just persist the bytes.

## 6b. Runtime trace #2 — pending

Instrumentation extended to log: `saveChanges.nothingToSave`, `saveChanges.recoveryBranch`, `flushPendingSaveDirectly` (with tab snapshot), and `reset` (with caller stack). Next repro will confirm **who** calls `reset()` in the race window.

## 7. Open questions for after the trace

- Does `document.save()` actually return `false` in this repro, or does it return `true` and the desync comes purely from the close/reopen + file-watcher race?
- Is the trailing-newline append in `update()` ever itself the _only_ difference, i.e. could clamping it remove the perceived "reformat" even if the dirty-state cause is separate?

> **Both answered moot by §8:** `document.save()` was never the trigger and the trailing newline was a red herring. The real cause is a parameter-wiring bug in the background usage drain. The earlier hypotheses (§3–§6) correctly identified the _downstream mechanics_ (`fs.writeFile` recovery → dirty buffer) but not the _trigger_.

---

## 8. Definitive root cause (proven by runtime trace #3, 2026-06-04 ~19:33–19:44Z)

Added a trace inside `createAbortStreamFn`'s returned closure logging `cancelReason`, `abort`, `abandoned`, and
the caller stack. Reproduced across ~8 creates/edits. **Every single write** produced this sequence:

```
open <file>                      isEditing → true
abortStream {isEditing:true, abort:false, abandoned:false}   ← cancelReason ABSENT (undefined)
   caller: captureUsageData <- handleBackgroundUsageDrain <- processStream
reset {hadActiveEdit:true, caller: DiffViewProvider.revertChanges <- abortStream}
   ← activeEdit nulled BEFORE the user approves
saveChanges.recoveryBranch {hasEdit:false, newContentUndefined:true}
flushPendingSaveDirectly {tabsBefore:[{kind:"text", isDirty:true}]}   ← fs.writeFile behind VS Code's back
```

**The trigger is a parameter-wiring bug, not a race and not a formatter.**

- `TaskApiLoop.processStream()` holds two distinct callbacks created per request:
    - `updateApiReqMsg` (`createUpdateApiReqMsgFn`) — rewrites the `api_req_started` message with final token/cost.
    - `abortStream` (`createAbortStreamFn`) — **reverts any in-progress diff edit** (`if (isEditing) revertChanges()`), marks the last partial message complete, and sets `didFinishAbortingStream`.
- `processStream()` called `handleBackgroundUsageDrain(..., abortStream)`, and `handleBackgroundUsageDrain` forwarded that value into `createBackgroundUsageDrain`'s **6th parameter, which is `updateApiReqMsg`**.
- So inside the drain, `updateApiReqMsg` **was actually `abortStream`**. The drain's `captureUsageData()` calls `updateApiReqMsg()` (no args) whenever it records usage — i.e. **after every successful API request** — thereby invoking `abortStream(undefined)`.
- `abortStream` sees `isEditing === true` (a write tool has the diff open, awaiting approval) and calls `revertChanges() → reset()`, nulling `activeEdit` **before the user approves**. The later approved `saveChanges()` then finds the edit gone, drops into the `recoveryBranch`, and persists via `flushPendingSaveDirectly()` → `fs.writeFile` — which writes the bytes to disk **behind VS Code's back and leaves the editor buffer dirty**.

Why TypeScript never caught it: `handleBackgroundUsageDrain`'s param was typed `any`, and `AbortStreamFn`
(`() => Promise<void>`) is structurally assignable to `UpdateApiReqMsgFn` (`() => void`), so even proper typing
would not have rejected it.

Why "rare overwrite dialog" but "every file dirty": the dirty buffer is produced on **every** manually-approved
write (the diff stays open across the approval window, so the drain's `abortStream` almost always fires while
`isEditing`). The _"newer version on disk"_ dialog only additionally appears when the user later manually saves
that dirty buffer — a rarer follow-on action — hence it felt intermittent while the dirty marker was constant.

## 9. The fix

`src/core/task/TaskApiLoop.ts` — pass the correct callback to the background usage drain:

- `processStream()` now also receives `updateApiReqMsg` and forwards **it** (not `abortStream`) to
  `handleBackgroundUsageDrain`.
- `handleBackgroundUsageDrain`'s param is renamed `abortStream: any` → `updateApiReqMsg: UpdateApiReqMsgFn`
  (properly typed) and forwarded to `createBackgroundUsageDrain`.
- Added `import { type UpdateApiReqMsgFn } from "./StreamProcessorTypes"`.

Net effect: the background drain now updates the `api_req_started` message with final token/cost (its actual
purpose) and **never** aborts the stream / reverts a diff. The write tool's own flow (`saveChanges()` on approve,
`revertChanges()` on reject) is left to manage the diff, so approved saves take the normal
`document.save()` path and leave a clean buffer. The `fs.writeFile` recovery path (#18/#19) now only fires for the
genuine stale-session case it was built for.

This is a one-trigger, surgical fix — no change to `DiffViewProvider`, no behavior change to real aborts (a true
user-cancel or stream error still calls `abortStream` from `processStream` directly, as before).

### Regression test

`src/core/task/__tests__/TaskStreamProcessor.usage-drain.spec.ts`:

1. The background drain reports usage **through its `updateApiReqMsg` callback** (called with no `cancelReason`)
   and **never** calls `diffViewProvider.revertChanges`.
2. `abortStream` (the function that must _not_ be given to the drain) **does** revert an in-progress diff —
   documenting exactly why confusing the two strands dirty buffers.

### Verification

- `tsc --noEmit` (src): clean.
- New spec: 2/2 passing.

### Instrumentation

All temporary trace instrumentation (DiffViewProvider helpers + the `createAbortStreamFn` trace) was reverted via
`git checkout HEAD --` before the fix; only the fix and its test remain.
