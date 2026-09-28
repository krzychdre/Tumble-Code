import type { ClineMessage, ExtensionMessage } from "@roo-code/types"

import type { Task } from "../task/Task"
import type { TaskHistoryInclusion, WebviewStatePush } from "./ProviderStateBuilder"

/**
 * The host seam of {@link WebviewStatePusher}: everything the state-push
 * family needs from the provider, as constructor-injected callbacks instead
 * of a back-reference to the ClineProvider class (S1, extracted from
 * ClineProvider; see ai_plans/2026-09-28_s1-clineprovider-split.md).
 */
export interface WebviewStatePusherHost {
	/**
	 * Builds the state snapshot to post (CORE-R1, ProviderStateBuilder).
	 * The overload set of ClineProvider.getStateToPostToWebview applies.
	 */
	getStateToPostToWebview(options?: { includeTaskHistory?: TaskHistoryInclusion }): Promise<WebviewStatePush>
	/** Posts one message to the webview; drops it silently when disposed. */
	postMessageToWebview(message: ExtensionMessage): Promise<void>
	/**
	 * The current foreground task (the slot's occupant), if any. Only the
	 * `messageAdded` fast path consults it (the message must belong to the
	 * task the view is bound to).
	 */
	getCurrentTask(): Task | undefined
	/**
	 * True when an MDM policy requires cloud auth and the user is
	 * non-compliant (the redirect tail of every push, D4).
	 */
	shouldRedirectToCloudAuth(): boolean
	/** True while a webview is resolved (a push without a view is a no-op). */
	hasView(): boolean
}

/**
 * Owns the `postStateToWebview*` family and the `messageAdded` /
 * `messageUpdated` fast paths (CORE-R7), extracted from ClineProvider
 * unchanged (S1): same payload shapes, same sequence-number semantics, same
 * conditions for sending a message alone. ClineProvider delegates its public
 * push methods here; the provider's `clineMessagesSeq` stamping stays in
 * ProviderStateBuilder.
 *
 * Per-webview bookkeeping that only this family used moves with it:
 * - `webviewAcceptsMessageAdded` — what the view declared on launch;
 * - `viewClineMessages` — the message list the view was last sent and how
 *   long it was when posted.
 */
export class WebviewStatePusher {
	/**
	 * The view declared on its launch that it applies `messageAdded` (CORE-R7).
	 * Per webview: cleared when a webview is resolved, set again by every
	 * `webviewDidLaunch`. The CLI never declares it.
	 */
	private webviewAcceptsMessageAdded = false

	/**
	 * The message list the view was last sent in a state push (the task's live
	 * array) and how long it was when posted. A new message is sent alone only
	 * when it extends exactly this list; see {@link postClineMessageAdded}.
	 */
	private viewClineMessages?: { list: readonly ClineMessage[]; count: number }

	constructor(private readonly host: WebviewStatePusherHost) {}

	/**
	 * Pushes the whole state to the view. The task history goes along only
	 * when it changed since the last full push to this view (CORE-R7, see
	 * {@link ProviderStateBuilder.getStateToPostToWebview}); a new or reloaded
	 * webview always receives it.
	 */
	async postStateToWebview() {
		const state = await this.host.getStateToPostToWebview({ includeTaskHistory: "whenChanged" })
		this.rememberViewClineMessages(state.clineMessages)
		this.host.postMessageToWebview({ type: "state", state })
		await this.postMdmRedirectToWebview()
	}

	/**
	 * Like postStateToWebview but intentionally omits taskHistory.
	 *
	 * Rationale:
	 * - taskHistory can be large and was being resent on every chat message update.
	 * - The webview maintains taskHistory in-memory and receives updates via
	 *   `taskHistoryUpdated` / `taskHistoryItemUpdated` / `taskHistoryItemDeleted`.
	 *
	 * This path does NOT call `taskHistoryStore.getAll()`: the builder is
	 * invoked with `includeTaskHistory: false`, so the history is never
	 * materialized or sorted here. The webview keeps its in-memory history
	 * list in sync via the targeted messages.
	 */
	async postStateToWebviewWithoutTaskHistory(): Promise<void> {
		const state = await this.host.getStateToPostToWebview({ includeTaskHistory: false })
		const { taskHistory: _omit, ...rest } = state
		this.rememberViewClineMessages(rest.clineMessages)
		this.host.postMessageToWebview({ type: "state", state: rest })
		await this.postMdmRedirectToWebview()
	}

	/**
	 * Like postStateToWebview but intentionally omits both clineMessages and taskHistory.
	 *
	 * Rationale:
	 * - Cloud event handlers (auth, settings, user-info) and mode changes trigger state pushes
	 *   that have nothing to do with chat messages. Including clineMessages in these pushes
	 *   creates race conditions where a stale snapshot of clineMessages (captured during async
	 *   getStateToPostToWebview) overwrites newer messages the task has streamed in the meantime.
	 * - This method ensures cloud/mode events only push the state fields they actually affect
	 *   (cloud auth, org settings, profiles, etc.) without interfering with task message streaming.
	 *
	 * This path does NOT call `taskHistoryStore.getAll()` (the builder is
	 * invoked with `includeTaskHistory: false`).
	 */
	async postStateToWebviewWithoutClineMessages(): Promise<void> {
		const state = await this.host.getStateToPostToWebview({ includeTaskHistory: false })
		// Drop the sequence number with the messages: a push without messages must not raise the
		// webview's high-water mark and make it reject an older-numbered push that has them.
		const { clineMessages: _omitMessages, clineMessagesSeq: _omitSeq, taskHistory: _omitHistory, ...rest } = state
		this.host.postMessageToWebview({ type: "state", state: rest })
		await this.postMdmRedirectToWebview()
	}

	/**
	 * Posts a chat message just added to `task` as a `messageAdded` (the
	 * message, its index and the state without the message list, the history
	 * and the sequence number) instead of a state push with the whole list
	 * (CORE-R7). Returns false, posting nothing, when the view needs the full
	 * push the caller then sends:
	 * - the view did not declare `acceptsMessageAdded` on launch (the CLI);
	 * - `task` is not the current task;
	 * - the view was not sent this task's current list (a new or resumed task,
	 *   a replaced list, a new webview) or misses a message before this one.
	 * The rest of the state travels along because a new message can come with
	 * other changes (the todo list, the queue, the history item), exactly as
	 * the full push carried them. If the view changes while that state is
	 * built, the full push is sent here instead (and true returned).
	 */
	async postClineMessageAdded(
		task: { readonly taskId: string; readonly clineMessages: ClineMessage[] },
		message: ClineMessage,
	): Promise<boolean> {
		const index = task.clineMessages.lastIndexOf(message)

		if (!this.canSendClineMessageAlone(task, index)) {
			return false
		}

		const state = await this.host.getStateToPostToWebview({ includeTaskHistory: false })

		// Re-checked after the await: the view may have been replaced or
		// reloaded (it holds nothing then), or a full push may already have
		// carried this message (sending it again is harmless: the webview
		// replaces a message whose ts it knows).
		if (!this.canSendClineMessageAlone(task, index)) {
			await this.postStateToWebviewWithoutTaskHistory()
			return true
		}

		const { clineMessages: _omitMessages, clineMessagesSeq: _omitSeq, taskHistory: _omitHistory, ...rest } = state
		this.viewClineMessages!.count = Math.max(this.viewClineMessages!.count, index + 1)
		this.host.postMessageToWebview({
			type: "messageAdded",
			sourceTaskId: task.taskId,
			messageIndex: index,
			clineMessage: message,
			state: rest,
		})

		await this.postMdmRedirectToWebview()

		return true
	}

	/**
	 * The tail every `postStateToWebview*` variant shares (D4): after a state
	 * push, a non-compliant user under an MDM policy that requires cloud auth
	 * is redirected to the account tab. Only an actual policy can trigger it;
	 * without `mdmService` or without `requireCloudAuth` nothing is posted.
	 */
	async postMdmRedirectToWebview(): Promise<void> {
		if (this.host.shouldRedirectToCloudAuth()) {
			await this.host.postMessageToWebview({ type: "action", action: "cloudButtonClicked" })
		}
	}

	/**
	 * Shows the view a message of `task` that was changed in place without a
	 * post of its own (a follow-up marked answered, the rows an aborted stream
	 * finishes). A full state push used to carry such changes with the next
	 * added message; a view that gets new messages alone (CORE-R7) needs them
	 * posted. Only to such a view and only when it holds this task's list;
	 * any other view (the CLI) still sees them in its next full push, so what
	 * it receives does not change. Emits no task event.
	 */
	async postEditedClineMessage(
		task: { readonly taskId: string; readonly clineMessages: ClineMessage[] },
		message: ClineMessage,
	): Promise<void> {
		if (!this.webviewAcceptsMessageAdded || this.viewClineMessages?.list !== task.clineMessages) {
			return
		}

		await this.host.postMessageToWebview({
			type: "messageUpdated",
			sourceTaskId: task.taskId,
			clineMessage: message,
		})
	}

	/**
	 * What the view declared on launch (see {@link webviewAcceptsMessageAdded}).
	 * Also forgets which message list it holds: a (re)loaded webview starts
	 * empty until its launch push.
	 */
	setWebviewAcceptsMessageAdded(accepts: boolean): void {
		this.webviewAcceptsMessageAdded = accepts
		this.viewClineMessages = undefined
	}

	/**
	 * The view has every message of `task` before `index` in this very list, so
	 * the message at `index` can be sent alone. `count >= index`: a full push
	 * posted after the message was pushed already carries it.
	 */
	private canSendClineMessageAlone(task: { readonly clineMessages: ClineMessage[] }, index: number): boolean {
		const current = this.host.getCurrentTask()

		return (
			this.webviewAcceptsMessageAdded &&
			index !== -1 &&
			current !== undefined &&
			current.clineMessages === task.clineMessages &&
			this.viewClineMessages?.list === task.clineMessages &&
			this.viewClineMessages.count >= index
		)
	}

	/**
	 * Records the message list a state push is about to post. `postMessage`
	 * serializes the live array at once, so its length now is what the view
	 * receives.
	 */
	private rememberViewClineMessages(clineMessages: ClineMessage[] | undefined): void {
		this.viewClineMessages =
			this.host.hasView() && clineMessages ? { list: clineMessages, count: clineMessages.length } : undefined
	}
}
