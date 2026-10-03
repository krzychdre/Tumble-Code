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

/**
 * Cloud account, sharing, organization and OpenAI Codex replies.
 *
 * `cloudAuthResult` answers `rooCloudSignIn` (only when it fails),
 * `rooCloudManualUrl` and `rooCloudSignOut`: `text` names the request,
 * `success` and `error` say how it went. The CLI shows it, because the CLI
 * mutes the extension's notifications.
 */
export type CloudAuthExtensionMessageType =
	| "shareTaskSuccess"
	| "organizationSwitchResult"
	| "openAiCodexRateLimits"
	| "cloudAuthResult"

export interface OpenAiCodexRateLimitsMessage {
	type: "openAiCodexRateLimits"
	values?: OpenAiCodexRateLimitInfo
	error?: string
}

export interface RequestOpenAiCodexRateLimitsMessage {
	type: "requestOpenAiCodexRateLimits"
}
