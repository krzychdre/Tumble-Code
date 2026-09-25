import { useMemo, useRef } from "react"

import type { TranscriptEffect } from "../../agent/transcript-reducer.js"
import type { TranscriptSink } from "../../agent/transcript-reader.js"
import { useCLIStore } from "../store.js"

export interface UseTranscriptSinkOptions {
	nonInteractive: boolean
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
 * The TUI's side of the transcript reader (`agent/transcript-reader.ts`):
 * the reader reads each extension message and asks this sink for the
 * transcript as the store holds it, then hands back the changes, which are
 * applied to the store. `useExtensionHost` attaches the sink to the client.
 *
 * The sink is created once and reads everything at call time: the reader
 * keeps the sink it was given on mount, and the permission policy can change
 * at runtime (/permissions).
 */
export function useTranscriptSink({ nonInteractive }: UseTranscriptSinkOptions): TranscriptSink {
	const nonInteractiveRef = useRef(nonInteractive)
	nonInteractiveRef.current = nonInteractive

	return useMemo<TranscriptSink>(
		() => ({
			view: () => {
				const { messages, isLoading, isResumingTask, currentTodos } = useCLIStore.getState()
				return { messages, isLoading, isResumingTask, currentTodos }
			},
			nonInteractive: () => nonInteractiveRef.current,
			apply: applyTranscriptEffects,
		}),
		[],
	)
}
