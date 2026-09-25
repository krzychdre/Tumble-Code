import { useCallback, useRef } from "react"
import type { ExtensionMessage } from "@roo-code/types"

import {
	createTranscriptCursor,
	reduceExtensionMessage,
	resetTranscriptCursor,
	type TranscriptCursor,
	type TranscriptEffect,
} from "../../agent/transcript-reducer.js"
import { useCLIStore } from "../store.js"

export interface UseMessageHandlersOptions {
	nonInteractive: boolean
}

export interface UseMessageHandlersReturn {
	handleExtensionMessage: (msg: ExtensionMessage) => void
	/** Forget the current task's bookkeeping (/new, /clear, switching tasks). */
	resetTranscript: () => void
}

/**
 * Apply the reducer's changes through the store's own actions, in order: the
 * actions carry behavior of their own (the 150 ms debounce of a partial
 * update, the flush when the agent goes idle, a step start that never moves
 * back, previous todos), which is part of what the user sees.
 */
function applyTranscriptEffects(effects: readonly TranscriptEffect[]): void {
	const store = useCLIStore.getState()

	for (const effect of effects) {
		switch (effect.type) {
			case "addMessage":
				store.addMessage(effect.message)
				break
			case "setPendingAsk":
				store.setPendingAsk(effect.ask)
				break
			case "setComplete":
				store.setComplete(effect.complete)
				break
			case "setLoading":
				store.setLoading(effect.loading)
				break
			case "setHasStartedTask":
				store.setHasStartedTask(effect.started)
				break
			case "setIsResumingTask":
				store.setIsResumingTask(effect.resuming)
				break
			case "markStepStarted":
				store.markStepStarted(effect.ts)
				break
			case "setTodos":
				store.setTodos(effect.todos)
				break
			case "setTokenUsage":
				store.setTokenUsage(effect.usage)
				break
			case "setMcpServers":
				store.setMcpServers(effect.servers)
				break
			case "setCurrentMode":
				store.setCurrentMode(effect.mode)
				break
			case "setApiConfiguration":
				store.setApiConfiguration(effect.config)
				break
			case "setTaskHistory":
				store.setTaskHistory(effect.history)
				break
			case "setFileSearchResults":
				store.setFileSearchResults(effect.results)
				break
			case "setAllSlashCommands":
				store.setAllSlashCommands(effect.commands)
				break
			case "setAvailableModes":
				store.setAvailableModes(effect.modes)
				break
			case "setRouterModels":
				store.setRouterModels(effect.models)
				break
		}
	}
}

/**
 * Hook that feeds extension messages to the transcript reducer
 * (`agent/transcript-reducer.ts`) and applies what it returns to the store.
 */
export function useMessageHandlers({ nonInteractive }: UseMessageHandlersOptions): UseMessageHandlersReturn {
	// The todos of THIS render, not the store's current ones: the reducer used
	// to live in this hook and read them from the render's closure, and the
	// extension host keeps the callback of the first render (it subscribes once,
	// on mount). Kept as is by the move; see the characterization spec.
	const { currentTodos } = useCLIStore()

	const cursor = useRef<TranscriptCursor>(createTranscriptCursor())

	// The extension host subscribes to handleExtensionMessage once on mount.
	// Keep the current session policy in a ref so runtime /permissions changes
	// affect that stable listener instead of leaving it with the startup value.
	const nonInteractiveRef = useRef(nonInteractive)
	nonInteractiveRef.current = nonInteractive

	const handleExtensionMessage = useCallback(
		(msg: ExtensionMessage) => {
			const { messages, isLoading, isResumingTask } = useCLIStore.getState()
			const result = reduceExtensionMessage(
				cursor.current,
				{ messages, isLoading, isResumingTask, currentTodos },
				msg,
				{ nonInteractive: nonInteractiveRef.current },
			)

			cursor.current = result.cursor
			applyTranscriptEffects(result.effects)
		},
		[currentTodos],
	)

	const resetTranscript = useCallback(() => {
		cursor.current = resetTranscriptCursor(cursor.current)
	}, [])

	return { handleExtensionMessage, resetTranscript }
}
