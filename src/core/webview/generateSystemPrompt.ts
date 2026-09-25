import { WebviewMessage } from "../../shared/WebviewMessage"
import { defaultModeSlug } from "../../shared/modes"
import { resolveProviderModel } from "../../api"

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

	// Resolve the model info (for stealth mode) from the settings, without
	// building a handler or relying on an active task, which might not exist
	// during preview.
	let modelInfo: { isStealthModel?: boolean } | undefined
	try {
		modelInfo = resolveProviderModel(state.apiConfiguration).info
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
