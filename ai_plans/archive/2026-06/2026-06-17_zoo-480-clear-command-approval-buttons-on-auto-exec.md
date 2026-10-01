# Port plan — Zoo PR #480 → `feature/zoo-480-clear-command-approval-buttons-on-auto-exec`

> **Hybrid port.** Upstream changed `src/core/task/Task.ts`, but **our fork moved
> the `ask()` logic into `src/core/task/TaskAskSay.ts`**, so the backend fix is
> **hand-adapted**, not `git apply`'d. The webview files and webview tests apply
> cleanly. The new backend test is applied then adapted to our `askSay` harness.
> Tumble Code: no "Roo"/"Zoo" user-facing strings; `.roo`/`RooCode#ask` internal
> ids stay.

---

## 0. Context (read once, write no code)

- **Upstream:** Zoo PR #480 — "fix(chat): clear command approval buttons when auto-executed" (commit `cb3e93d52`).
- **What it does, one paragraph:** When an interactive ask (command / tool) is
  **auto-approved or auto-denied** by the user's settings, the old flow added the
  ask message (which made the webview show approval buttons) and _then_ posted a
  separate `clearApprovalButtons` message to hide them. Because the
  extension-host → webview channel is fire-and-forget, the clear could arrive
  before React processed the state update that showed the buttons, leaving them
  stuck on screen. The fix **hoists `checkAutoApproval()` to before the message is
  added** and **stamps `isAnswered: true` on the message** when the decision is an
  immediate approve/deny. The webview's `useDeepCompareEffect` button-setup
  effect early-returns when `lastMessage.isAnswered` is set, so the buttons never
  appear at all — no clear needed, no race. It also adds (a) a `clearApprovalButtons`
  `useCallback` in ChatView shared by the manual click handlers, (b) a pulsing
  yellow dot on the running-command status indicator, and (c) a module-level
  `statusCache` in `CommandExecution` so a component that mounts _after_ the
  `started` event was delivered (e.g. after an auto-approval remount) can recover
  the running status.
- **Why we want it, with evidence in OUR code:**
  [TaskAskSay.ts:242-245](src/core/task/TaskAskSay.ts#L242-L245) computes
  `checkAutoApproval` **after** `addToClineMessages` (lines 123/221/237), so our
  fork has the exact race the PR fixes: an auto-approved command flashes approval
  buttons. [ChatView.tsx:258](webview-ui/src/components/chat/ChatView.tsx#L258)'s
  ask-case effect has no `isAnswered` guard.
- **Divergence that forces a hand-port:** our `Task.ask()`
  ([Task.ts:906-914](src/core/task/Task.ts#L906-L914)) delegates to
  `this.askSay.ask()`; the real `ask()` body is in `TaskAskSay.ts` and accesses
  state through `this.access.*` (e.g. `this.access.history.addToClineMessages`,
  `this.access.providerRef`). The upstream `Task.ts` hunk therefore does NOT apply
  (fails at `Task.ts:1136`). We re-express the identical change in `TaskAskSay.ts`.
- **What we deliberately leave out (YAGNI):** the upstream commit message mentions
  "Remove clearApprovalButtons from ExtensionMessage type" — but the **net squashed
  diff does not touch `ExtensionMessage`** (that sub-commit was superseded by the
  `isAnswered` approach). No i18n change either: `commandExecution.running` already
  exists in our `en/chat.json`, and `CommandExecutionStatus` already includes
  `"error"` (added by #483). So the diff is exactly 6 files.
- **Original authors — credit.** Andrew Schmeder, Naved Merchant. Commit trailers:

    ```text
    Co-authored-by: Andrew Schmeder <149117631+awschmeder@users.noreply.github.com>
    Co-authored-by: Naved Merchant <naved.merchant@gmail.com>
    ```

## 1. Preconditions

- [ ] Branch `feature/zoo-480-clear-command-approval-buttons-on-auto-exec` off `main`.
- [ ] Working tree clean.
- [ ] `src/core/task/TaskAskSay.ts` exists and its `ask()` method matches the code quoted in §3.
- [ ] `git apply --check --exclude='src/core/task/Task.ts' /tmp/zoo-480.diff` → clean.

## 2. Regenerate the diff

```bash
cd /home/krzych/Projekty/QUB-IT/Roo-Code
git -C /home/krzych/Projekty/QUB-IT/Zoo-Code show cb3e93d52 > /tmp/zoo-480.diff
git apply --check --exclude='src/core/task/Task.ts' /tmp/zoo-480.diff && echo "NON-TASK FILES APPLY CLEANLY"
```

## 3. Apply the clean parts (everything except Task.ts)

```bash
cd /home/krzych/Projekty/QUB-IT/Roo-Code
git apply --exclude='src/core/task/Task.ts' /tmp/zoo-480.diff
git status --short
```

- **Expect these 5 files changed/created:** `webview-ui/src/components/chat/ChatView.tsx`,
  `webview-ui/src/components/chat/CommandExecution.tsx`,
  `webview-ui/src/components/chat/__tests__/ChatView.clear-approval-buttons.spec.tsx` (new),
  `webview-ui/src/components/chat/__tests__/CommandExecution.spec.tsx`,
  `src/core/task/__tests__/ask-clear-approval-buttons.spec.ts` (new).

## 4. Hand-adapt the backend fix in `TaskAskSay.ts`

The five edits below re-express the upstream `Task.ts` change in our relocated
`ask()` method. Apply each exactly.

### Edit A — hoist auto-approval resolution above the add (after `let askTs: number`)

Replace:

```ts
		let askTs: number

		if (partial !== undefined) {
```

With:

```ts
		let askTs: number

		// Resolve auto-approval before adding the message so the state snapshot
		// sent to the webview already carries isAnswered:true when the ask will
		// be immediately resolved. This eliminates the race between the state
		// update (which shows approval buttons) and the former separate
		// clearApprovalButtons message (which could arrive before buttons were
		// rendered, leaving them stuck on-screen).
		const provider = this.access.providerRef.deref()
		const state = provider ? await provider.getState() : undefined
		const approval = await checkAutoApproval({ state, ask: type, text, isProtected })
		const isAutoAnswered = approval.decision === "approve" || approval.decision === "deny"

		if (partial !== undefined) {
```

### Edit B — stamp the partial→complete transition message

Replace:

```ts
transitionTarget.progressStatus = progressStatus
transitionTarget.isProtected = isProtected
await this.access.history.saveClineMessages()
```

With:

```ts
transitionTarget.progressStatus = progressStatus
transitionTarget.isProtected = isProtected
if (isAutoAnswered) {
	transitionTarget.isAnswered = true
}
await this.access.history.saveClineMessages()
```

### Edit C — stamp the "new and complete" add (inside the `partial !== undefined` branch)

Replace:

```ts
					askTs = Date.now()
					this.access.lastMessageTs = askTs
					await this.access.history.addToClineMessages({
						ts: askTs,
						type: "ask",
						ask: type,
						text,
						isProtected,
					})
				}
			}
		} else {
```

With:

```ts
					askTs = Date.now()
					this.access.lastMessageTs = askTs
					await this.access.history.addToClineMessages({
						ts: askTs,
						type: "ask",
						ask: type,
						text,
						isProtected,
						isAnswered: isAutoAnswered || undefined,
					})
				}
			}
		} else {
```

### Edit D — stamp the new non-partial add

Replace:

```ts
			await this.access.history.addToClineMessages({ ts: askTs, type: "ask", ask: type, text, isProtected })
		}

		let timeouts: NodeJS.Timeout[] = []
```

With:

```ts
			await this.access.history.addToClineMessages({
				ts: askTs,
				type: "ask",
				ask: type,
				text,
				isProtected,
				isAnswered: isAutoAnswered || undefined,
			})
		}

		let timeouts: NodeJS.Timeout[] = []
```

### Edit E — delete the now-duplicated auto-approval block

Replace:

```ts
		let timeouts: NodeJS.Timeout[] = []

		// Automatically approve if the ask according to the user's settings.
		const provider = this.access.providerRef.deref()
		const state = provider ? await provider.getState() : undefined
		const approval = await checkAutoApproval({ state, ask: type, text, isProtected })

		if (approval.decision === "approve") {
```

With:

```ts
		let timeouts: NodeJS.Timeout[] = []

		if (approval.decision === "approve") {
```

> After Edit E, `provider` is still declared (hoisted in Edit A) and is still used
> later in the method (`provider?.postMessageToWebview(...)`), so no reference
> breaks. `state` is now unused after the hoist except inside `checkAutoApproval`
> — that's fine, it is consumed there.

## 5. Adapt the new backend test to our `askSay` harness

The applied `src/core/task/__tests__/ask-clear-approval-buttons.spec.ts` stubs
`addToClineMessages` directly on the Task and never constructs `askSay`, which
does not match our delegating architecture. Make these edits (model the existing
`src/core/task/__tests__/ask-queued-message-drain.spec.ts` harness).

### Edit 5a — import TaskAskSay (top of file)

Replace:

```ts
import { Task } from "../Task"
```

With:

```ts
import { Task } from "../Task"
import { TaskAskSay } from "../TaskAskSay"
```

### Edit 5b — rewrite `buildTask` to wire `history` + `askSay`

Replace the whole `buildTask` function:

```ts
function buildTask(provider: ProviderStub | undefined) {
	const task = Object.create(Task.prototype) as Task
	;(task as any).abort = false
	;(task as any).clineMessages = []
	;(task as any).askResponse = undefined
	;(task as any).askResponseText = undefined
	;(task as any).askResponseImages = undefined
	;(task as any).lastMessageTs = undefined
	;(task as any).addToClineMessages = vi.fn(async () => {})
	;(task as any).saveClineMessages = vi.fn(async () => {})
	;(task as any).updateClineMessage = vi.fn(async () => {})
	;(task as any).cancelAutoApprovalTimeout = vi.fn(() => {})
	;(task as any).checkpointSave = vi.fn(async () => {})
	;(task as any).emit = vi.fn()
	;(task as any).providerRef = { deref: () => provider }

	return task
}
```

With:

```ts
function buildTask(provider: ProviderStub | undefined) {
	const task = Object.create(Task.prototype) as Task
	;(task as any).abort = false
	;(task as any).clineMessages = []
	;(task as any).askResponse = undefined
	;(task as any).askResponseText = undefined
	;(task as any).askResponseImages = undefined
	;(task as any).lastMessageTs = undefined
	;(task as any).taskId = "test-task-id"
	;(task as any).instanceId = "test-instance-id"
	;(task as any).idleAsk = undefined
	;(task as any).resumableAsk = undefined
	;(task as any).interactiveAsk = undefined
	;(task as any).autoApprovalTimeoutRef = undefined

	// In this fork ask() lives in TaskAskSay and reads/writes through
	// this.access.history, so stub the history surface (not the Task itself).
	;(task as any).history = {
		addToClineMessages: vi.fn(async () => {}),
		saveClineMessages: vi.fn(async () => {}),
		updateClineMessage: vi.fn(async () => {}),
		findMessageByTimestamp: vi.fn(() => undefined),
	}
	;(task as any).checkpointSave = vi.fn(async () => {})
	;(task as any).emit = vi.fn()
	;(task as any).providerRef = { deref: () => provider }

	// Wire the live task object as the TaskAskSay access interface.
	;(task as any).askSay = new TaskAskSay(task as any)

	return task
}
```

### Edit 5c — fix all four assertion sites

There are **four** identical lines:

```ts
const addCall = (task as any).addToClineMessages.mock.calls[0][0]
```

Replace **every** occurrence with:

```ts
const addCall = (task as any).history.addToClineMessages.mock.calls[0][0]
```

(Use a replace-all; there are exactly 4.)

## 6. Out of scope — do NOT do these

- Do **not** edit `Task.ts` (only the delegating wrapper lives there; nothing to change).
- Do **not** touch `ExtensionMessage`/`packages/types` (net diff doesn't).
- Do **not** add i18n keys (`commandExecution.running` already exists).
- Do **not** re-add TTS / router / cloud / Roo-Zoo branding; do **not** rename internal ids.

## 7. Verify — paste real output

```bash
cd /home/krzych/Projekty/QUB-IT/Roo-Code/src && npx vitest run core/task/__tests__/ask-clear-approval-buttons.spec.ts core/task/__tests__/ask-queued-message-drain.spec.ts
cd /home/krzych/Projekty/QUB-IT/Roo-Code/src && pnpm check-types
cd /home/krzych/Projekty/QUB-IT/Roo-Code/webview-ui && npx vitest run src/components/chat/__tests__/ChatView.clear-approval-buttons.spec.tsx src/components/chat/__tests__/CommandExecution.spec.tsx
cd /home/krzych/Projekty/QUB-IT/Roo-Code/webview-ui && npx tsc --noEmit 2>&1 | tail -5
```

## 8. Acceptance criteria (binary)

- [ ] `ask-clear-approval-buttons.spec.ts` green (4 tests): isAnswered stamped on auto-approve & auto-deny, not stamped on manual decision or followup-timeout.
- [ ] `ask-queued-message-drain.spec.ts` still green (no regression in the shared `ask()` path).
- [ ] `ChatView.clear-approval-buttons.spec.tsx` and `CommandExecution.spec.tsx` green.
- [ ] `pnpm check-types` (src) and webview `tsc --noEmit` clean.
- [ ] `git status` shows exactly: `TaskAskSay.ts`, `ChatView.tsx`, `CommandExecution.tsx`,
      `ChatView.clear-approval-buttons.spec.tsx`, `CommandExecution.spec.tsx`,
      `ask-clear-approval-buttons.spec.ts` (+ this plan). NOT `Task.ts`.

## 9. Record in the ledger

Already recorded by the orchestrator after the plan file is written. Commit trailers:

```text
Co-authored-by: Andrew Schmeder <149117631+awschmeder@users.noreply.github.com>
Co-authored-by: Naved Merchant <naved.merchant@gmail.com>
```
