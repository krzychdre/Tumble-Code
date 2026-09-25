/** The final content of a diff session and the file it belongs to. */
export interface ApprovedContent {
	readonly relPath: string
	readonly newContent: string
}

/**
 * The recovery buffer of a diff session: the last final content `update()`
 * settled, kept so an already-approved write still reaches disk when a
 * concurrent `reset()` (typically `TaskStreamProcessor.resetStreamingState()`
 * between `askApproval()` and `saveChanges()`) detached the session, or when
 * the editor refused to save.
 *
 * Lifecycle, all driven by DiffViewProvider:
 * - `hold()` when `update(isFinal = true)` starts, before its first await;
 * - `held` read once when `saveChanges()` starts;
 * - `discard()` when the bytes reached disk (editor save, direct write,
 *   `saveDirectly()`), when the user rejected them (`revertChanges()`), and
 *   when a new session starts (`open()`).
 *
 * `reset()` deliberately leaves the buffer alone: that is what lets the save
 * recover after a racing reset.
 */
export class SaveRecovery {
	private approved?: ApprovedContent

	/** The buffered content, if any. A snapshot: a later `hold()` does not change it. */
	get held(): ApprovedContent | undefined {
		return this.approved
	}

	hold(relPath: string, newContent: string): void {
		this.approved = { relPath, newContent }
	}

	discard(): void {
		this.approved = undefined
	}
}
