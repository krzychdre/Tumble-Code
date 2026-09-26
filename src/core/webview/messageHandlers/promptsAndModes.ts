// Mode switching, per-mode prompts and custom instructions.

import { TelemetryEventName } from "@roo-code/types"
import { TelemetryService } from "@roo-code/telemetry"
import type { Mode } from "../../../shared/modes"
import { serializeError } from "./context"
import type { MessageHandlerMap } from "./types"

export const promptsAndModesHandlers: MessageHandlerMap = {
	customInstructions: async (ctx, message) => {
		const { provider } = ctx
		await provider.updateCustomInstructions(message.text)
	},

	mode: async (ctx, message) => {
		const { provider } = ctx
		await provider.handleModeSwitch(message.text as Mode)
	},

	updatePrompt: async (ctx, message) => {
		const { provider, getGlobalState, updateGlobalState } = ctx
		if (message.promptMode && message.customPrompt !== undefined) {
			const existingPrompts = getGlobalState("customModePrompts") ?? {}
			const updatedPrompts = { ...existingPrompts, [message.promptMode]: message.customPrompt }
			await updateGlobalState("customModePrompts", updatedPrompts)
			// A full push: the history goes along only when it changed (CORE-R7).
			const currentState = await provider.getStateToPostToWebview({ includeTaskHistory: "whenChanged" })
			const stateWithPrompts = {
				...currentState,
				customModePrompts: updatedPrompts,
				hasOpenedModeSelector: currentState.hasOpenedModeSelector ?? false,
			}
			provider.postMessageToWebview({ type: "state", state: stateWithPrompts })

			if (TelemetryService.hasInstance()) {
				// Determine which setting was changed by comparing objects
				const oldPrompt = existingPrompts[message.promptMode] || {}
				const newPrompt = message.customPrompt
				const changedSettings = Object.keys(newPrompt).filter(
					(key) =>
						JSON.stringify((oldPrompt as Record<string, unknown>)[key]) !==
						JSON.stringify((newPrompt as Record<string, unknown>)[key]),
				)

				if (changedSettings.length > 0) {
					TelemetryService.instance.capture(TelemetryEventName.MODE_SETTINGS_CHANGED, {
						settingName: changedSettings[0],
					})
				}
			}
		}
	},

	hasOpenedModeSelector: async (ctx, message) => {
		const { provider, updateGlobalState } = ctx
		await updateGlobalState("hasOpenedModeSelector", message.bool ?? true)
		await provider.postStateToWebview()
	},

	requestModes: async (ctx) => {
		const { provider } = ctx
		try {
			const modes = await provider.getModes()
			await provider.postMessageToWebview({ type: "modes", modes })
		} catch (error) {
			provider.log(`Error fetching modes: ${serializeError(error)}`)
			await provider.postMessageToWebview({ type: "modes", modes: [] })
		}
	},
}
