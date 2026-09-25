import { WebviewMessage } from "../../shared/WebviewMessage"
import { defaultModeSlug } from "../../shared/modes"
import { buildApiHandler } from "../../api"

import { SYSTEM_PROMPT } from "../prompts/system"
import { buildSystemPromptInput } from "../prompts/system-prompt-input"

import { ClineProvider } from "./ClineProvider"

/**
 * The "copy system prompt" preview. It shows exactly what the live request
 * (ApiRequestBuilder.buildSystemPrompt) would send for the focused task in the
 * requested mode: both paths share `buildSystemPromptInput`, and
 * system-prompt-parity.spec.ts compares their bytes.
 */
export const generateSystemPrompt = async (provider: ClineProvider, message: WebviewMessage) => {
	const state = await provider.getState()

	// Task-scoped inputs come from the focused task, as they do for its live requests.
	const task = provider.getCurrentTask()

	// Create a temporary API handler to check model info for stealth mode.
	// This avoids relying on an active Cline instance which might not exist during preview.
	let modelInfo: { isStealthModel?: boolean } | undefined
	try {
		const tempApiHandler = buildApiHandler(state.apiConfiguration)
		modelInfo = tempApiHandler.getModel().info
	} catch (error) {
		console.error("Error fetching model info for system prompt preview:", error)
	}

	return SYSTEM_PROMPT(
		buildSystemPromptInput({
			context: provider.context,
			cwd: provider.cwd,
			mode: message.mode ?? defaultModeSlug,
			state,
			mcpHub: provider.getMcpHub(),
			rooIgnoreController: task?.rooIgnoreController,
			materializedDeferredTools: task?.materializedDeferredTools,
			modelInfo,
			skillsManager: provider.getSkillsManager(),
		}),
	)
}
