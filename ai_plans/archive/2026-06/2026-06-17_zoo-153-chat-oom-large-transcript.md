# Port plan — Zoo PR #153 → `feature/zoo-153-chat-oom-large-transcript`

> **For the executor (read first).** Do the steps **in order**. This port lands
> as a verified-clean `git apply` of the upstream diff, **followed by a small
> post-apply rebrand** of two user-facing strings in `ClineProvider.ts`. Do
> **not** improvise or hand-edit anything else. If any `git apply --check`
> reports a conflict, **STOP and report** — do not force it or hand-merge. This
> repo is **Tumble Code**: never leave the strings "Roo" or "Zoo" in user-facing
> text.

---

## 0. Context (read once, write no code)

- **Upstream:** Zoo PR #153 — "[Fix] Chat window runs out of memory when transcript grows large" (commit `ed868c675`).
- **What it does, one paragraph:** When a chat transcript grows very large, the
  Virtuoso virtual list in [ChatView.tsx](webview-ui/src/components/chat/ChatView.tsx)
  pre-renders an enormous viewport buffer (`increaseViewportBy={{ top: 3_000, bottom: 1000 }}`),
  forcing thousands of pixels of off-screen message rows to mount at once. On long
  tasks this balloons memory until the webview crashes / greys out. This PR shrinks
  the pre-render buffer to `{ top: 600, bottom: 800 }`, gives Virtuoso a
  `defaultItemHeight` (180) so it can estimate scroll extents without mounting
  every row, and a stable `computeItemKey` (`${ts}-${index}`) so rows are recycled
  instead of re-created. It also adds lightweight diagnostics: when the webview
  becomes hidden during an active task, `ClineProvider` logs the task id, message
  count, stack depth and a timestamp to the output channel — a breadcrumb for
  debugging the "grey screen" report.
- **Why we want it, with evidence in OUR code:**
  [ChatView.tsx:1665](webview-ui/src/components/chat/ChatView.tsx#L1665) still
  carries the original `increaseViewportBy={{ top: 3_000, bottom: 1000 }}`, with
  no `defaultItemHeight` and no `computeItemKey` — so our build over-renders the
  same way and is subject to the same OOM on long transcripts.
- **What we deliberately leave out (YAGNI):** nothing structural — all 4 files
  apply cleanly. The only adaptation is the **rebrand** in step 4: the upstream
  diagnostics string is Zoo-branded (`[Zoo Code]`, `support@zoocode.dev`) and must
  be made neutral / Tumble.
- **Original authors — credit them.** (commit author is `roomote[bot]`, dropped;
  `T <taltas@…>` deduped into `Toray Altas` — same email). Commit trailers:

    ```text
    Co-authored-by: Toray Altas <6816042+taltas@users.noreply.github.com>
    Co-authored-by: edelauna <54631123+edelauna@users.noreply.github.com>
    Co-authored-by: Elliott de Launay <edelauna@gmail.com>
    ```

## 1. Preconditions — verify before touching anything

- [ ] Current branch is `feature/zoo-153-chat-oom-large-transcript`, created off `main`.
- [ ] Working tree clean (`git status --short` empty).
- [ ] The Zoo clone exists at `/home/krzych/Projekty/QUB-IT/Zoo-Code`.
- [ ] These 4 files exist: `webview-ui/src/components/chat/ChatView.tsx`,
      `webview-ui/src/components/chat/__tests__/ChatView.spec.tsx`,
      `src/core/webview/ClineProvider.ts`,
      `src/core/webview/__tests__/ClineProvider.spec.ts`.

## 2. Regenerate the diff and confirm it applies (no code yet)

```bash
cd /home/krzych/Projekty/QUB-IT/Roo-Code
git -C /home/krzych/Projekty/QUB-IT/Zoo-Code show ed868c675 > /tmp/zoo-153.diff
git apply --check /tmp/zoo-153.diff && echo "APPLIES CLEANLY"
```

- **Expect:** `APPLIES CLEANLY`. If `git apply --check` prints any error, **STOP
  and report** — the before-state has drifted and this plan is stale.

## 3. Apply the diff

```bash
cd /home/krzych/Projekty/QUB-IT/Roo-Code
git apply /tmp/zoo-153.diff
git status --short
```

- **Expect exactly these 4 files changed:**
  `webview-ui/src/components/chat/ChatView.tsx`,
  `webview-ui/src/components/chat/__tests__/ChatView.spec.tsx`,
  `src/core/webview/ClineProvider.ts`,
  `src/core/webview/__tests__/ClineProvider.spec.ts`.

## 4. Rebrand the two Zoo strings (MANDATORY — Tumble Code, no Zoo)

The applied `logWebviewHiddenDiagnostics` method in
[ClineProvider.ts](src/core/webview/ClineProvider.ts) contains Zoo branding. Make
exactly these two edits in that method, nothing else.

### Edit 1 — the log prefix

Replace:

```ts
		this.log(
			`[Zoo Code] Webview hidden during active task.\n` +
```

With:

```ts
		this.log(
			`[Tumble Code] Webview hidden during active task.\n` +
```

### Edit 2 — the support line (drop the Zoo support email)

Replace:

```ts
				`  timestamp:    ${new Date().toISOString()}\n` +
				`If the panel appears gray after this, share this log with support@zoocode.dev`,
```

With:

```ts
				`  timestamp:    ${new Date().toISOString()}\n` +
				`If the panel appears gray after this, include this log when reporting the issue.`,
```

- **Why this is safe:** the spec only asserts `expect.stringContaining("running-task")`
  (the taskId) and `not.toHaveBeenCalled()` for the abort/abandoned cases — it
  never references the branding or the support sentence. Confirmed in the §2 diff
  of `ClineProvider.spec.ts`.

## 5. Out of scope — do NOT do these

- Do **not** hand-edit the Virtuoso tuning or "improve" the applied numbers.
- Do **not** re-add or re-wire: **TTS**, the **router / cloud provider**, **cloud
  upsell** UI, or **Roo/Zoo branding**.
- Do **not** rename internal ids (those stay `Roo-Code`).
- Do **not** leave `Zoo`, `zoocode`, or `support@zoocode.dev` anywhere.

## 6. Verify — paste real output, don't claim success without it

```bash
cd /home/krzych/Projekty/QUB-IT/Roo-Code/src && npx vitest run core/webview/__tests__/ClineProvider.spec.ts
cd /home/krzych/Projekty/QUB-IT/Roo-Code/webview-ui && npx vitest run src/components/chat/__tests__/ChatView.spec.tsx
cd /home/krzych/Projekty/QUB-IT/Roo-Code/src && npx tsc --noEmit -p . 2>&1 | tail -5   # or: pnpm check-types
grep -rIn "Zoo\|zoocode" webview-ui/src/components/chat/ChatView.tsx src/core/webview/ClineProvider.ts || echo "NO ZOO STRINGS"
```

## 7. Acceptance criteria (binary — all must hold)

- [ ] `ClineProvider.spec.ts` (incl. the new `logWebviewHiddenDiagnostics` describe) green.
- [ ] `ChatView.spec.tsx` green.
- [ ] `check-types` clean.
- [ ] `git status` shows exactly the 4 expected files.
- [ ] `grep` confirms **no** `Zoo` / `zoocode` strings remain in the two production files.
- [ ] `ChatView.tsx` shows `increaseViewportBy={CHAT_VIEWPORT_BUFFER}` (not the old `3_000/1000`),
      `defaultItemHeight={CHAT_DEFAULT_ITEM_HEIGHT}`, and `computeItemKey={computeMessageKey}`.

## 8. Record in the ledger

Already recorded by the orchestrator after the plan file is written. The commit
(done by the orchestrator) will carry:

```text
Co-authored-by: Toray Altas <6816042+taltas@users.noreply.github.com>
Co-authored-by: edelauna <54631123+edelauna@users.noreply.github.com>
Co-authored-by: Elliott de Launay <edelauna@gmail.com>
```
