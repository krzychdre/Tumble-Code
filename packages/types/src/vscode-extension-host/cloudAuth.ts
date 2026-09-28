/*
 * Extension host channel, cloudAuth domain: the webview requests handled by
 * src/core/webview/messageHandlers/cloudAuth.ts and the host to view
 * messages of the same domain.
 */

import type { OpenAiCodexRateLimitInfo } from "../providers/openai-codex-rate-limits.js"

/** Cloud account, sharing, organization and OpenAI Codex sign-in. */
export type CloudAuthWebviewMessageType =
	| "shareCurrentTask"
	| "taskSyncEnabled"
	| "rooCloudSignIn"
	| "rooCloudSignOut"
	| "openAiCodexSignIn"
	| "openAiCodexSignOut"
	| "rooCloudManualUrl"
	| "switchOrganization"
	| "requestOpenAiCodexRateLimits"

/** Cloud account, sharing, organization and OpenAI Codex replies. */
export type CloudAuthExtensionMessageType = "shareTaskSuccess" | "organizationSwitchResult" | "openAiCodexRateLimits"

export interface OpenAiCodexRateLimitsMessage {
	type: "openAiCodexRateLimits"
	values?: OpenAiCodexRateLimitInfo
	error?: string
}

export interface RequestOpenAiCodexRateLimitsMessage {
	type: "requestOpenAiCodexRateLimits"
}
