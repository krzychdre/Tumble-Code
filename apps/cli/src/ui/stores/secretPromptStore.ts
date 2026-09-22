import { create } from "zustand"

/**
 * A question a running command is blocked on, waiting for the user.
 *
 * It does not come through the task's ask channel on purpose. The answer is
 * usually a password, so it goes straight back to the command that asked and is
 * never recorded as a message, never saved, and never sent to the model.
 */
export interface SecretPrompt {
	id: number
	/** What the command called itself, shown so the user knows who is asking. */
	title?: string
	/** The question, in the command's own words. */
	prompt: string
	/** False for questions whose answer is not a secret, like ssh's yes/no. */
	masked: boolean
}

interface PendingPrompt extends SecretPrompt {
	resolve: (answer: string | undefined) => void
}

interface SecretPromptState {
	/** The question on screen right now, if any. */
	current: SecretPrompt | null
	/**
	 * Asks the user and resolves with their answer, or with undefined when they
	 * dismiss it, which tells the command to stop waiting.
	 */
	ask: (request: Omit<SecretPrompt, "id">) => Promise<string | undefined>
	answer: (value: string) => void
	cancel: () => void
	/** Dismisses everything outstanding, for when a task is aborted. */
	cancelAll: () => void
}

let nextId = 1

// Commands ask one question at a time (git wants the username before the
// password), but two commands can be in flight at once, so the extras wait here
// rather than overwriting the prompt on screen.
const queue: PendingPrompt[] = []

export const useSecretPromptStore = create<SecretPromptState>((set) => {
	const showNext = () => {
		const next = queue[0]
		set({ current: next ? { id: next.id, title: next.title, prompt: next.prompt, masked: next.masked } : null })
	}

	const settle = (value: string | undefined) => {
		const pending = queue.shift()
		pending?.resolve(value)
		showNext()
	}

	return {
		current: null,

		ask: (request) =>
			new Promise<string | undefined>((resolve) => {
				queue.push({ ...request, id: nextId++, resolve })
				showNext()
			}),

		answer: (value) => settle(value),
		cancel: () => settle(undefined),

		cancelAll: () => {
			while (queue.length > 0) {
				queue.shift()?.resolve(undefined)
			}

			set({ current: null })
		},
	}
})
