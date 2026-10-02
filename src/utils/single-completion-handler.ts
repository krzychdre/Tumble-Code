import type { ProviderSettings } from "@tumble-code/types"

import { buildApiHandler, type CompletionResult, type SingleCompletionHandler } from "../api"

/**
 * Run a one-shot completion and report what it cost.
 *
 * The single place that decides how to call a handler: `completePromptWithUsage`
 * when the provider has it, `completePrompt` otherwise. Every caller goes
 * through here so that "this provider cannot tell us the token count" is
 * handled once, and so a missing figure surfaces as an absent `usage` rather
 * than as a zero that would land in a total as if the call had been free.
 */
export async function runCompletion(handler: SingleCompletionHandler, promptText: string): Promise<CompletionResult> {
	if (typeof handler.completePromptWithUsage === "function") {
		return handler.completePromptWithUsage(promptText)
	}
	return { text: await handler.completePrompt(promptText) }
}

/**
 * Build a handler for a configuration and run a one-shot completion on it,
 * without creating a full Task or touching task history.
 */
export async function singleCompletionWithUsage(
	apiConfiguration: ProviderSettings,
	promptText: string,
): Promise<CompletionResult> {
	if (!promptText) {
		throw new Error("No prompt text provided")
	}
	if (!apiConfiguration || !apiConfiguration.apiProvider) {
		throw new Error("No valid API configuration provided")
	}

	const handler = buildApiHandler(apiConfiguration)

	try {
		// Check if handler supports single completions
		if (!("completePrompt" in handler)) {
			throw new Error("The selected API provider does not support prompt enhancement")
		}

		return await runCompletion(handler as SingleCompletionHandler, promptText)
	} finally {
		// The handler lives for this one call only.
		handler.dispose?.()
	}
}
