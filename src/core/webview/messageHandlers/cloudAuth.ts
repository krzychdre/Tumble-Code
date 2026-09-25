// Cloud and OpenAI Codex sign-in, organizations, task sharing and sync.

import * as vscode from "vscode"
import { CloudService } from "@roo-code/cloud"
import { TelemetryService } from "@roo-code/telemetry"
import { type UserSettingsConfig, TelemetryEventName } from "@roo-code/types"
import { t } from "../../../i18n"
import type { MessageHandlerMap } from "./types"

export const cloudAuthHandlers: MessageHandlerMap = {
	shareCurrentTask: async (ctx, message) => {
		const { provider } = ctx
		const shareTaskId = provider.getCurrentTask()?.taskId
		const clineMessages = provider.getCurrentTask()?.clineMessages

		if (!shareTaskId) {
			vscode.window.showErrorMessage(t("common:errors.share_no_active_task"))
			return
		}

		try {
			const visibility = message.visibility || "organization"
			const result = await CloudService.instance.shareTask(shareTaskId, visibility, clineMessages)

			if (result.success && result.shareUrl) {
				// Show success notification
				const messageKey =
					visibility === "public"
						? "common:info.public_share_link_copied"
						: "common:info.organization_share_link_copied"
				vscode.window.showInformationMessage(t(messageKey))

				// Send success feedback to webview for inline display
				await provider.postMessageToWebview({
					type: "shareTaskSuccess",
					visibility,
					text: result.shareUrl,
				})
			} else {
				// Handle error
				const errorMessage = result.error || "Failed to create share link"
				if (errorMessage.includes("Authentication")) {
					vscode.window.showErrorMessage(t("common:errors.share_auth_required"))
				} else if (errorMessage.includes("sharing is not enabled")) {
					vscode.window.showErrorMessage(t("common:errors.share_not_enabled"))
				} else if (errorMessage.includes("not found")) {
					vscode.window.showErrorMessage(t("common:errors.share_task_not_found"))
				} else {
					vscode.window.showErrorMessage(errorMessage)
				}
			}
		} catch (error) {
			provider.log(`[shareCurrentTask] Unexpected error: ${error}`)
			vscode.window.showErrorMessage(t("common:errors.share_task_failed"))
		}
	},

	taskSyncEnabled: async (ctx, message) => {
		const { provider } = ctx
		const enabled = message.bool ?? false
		const updatedSettings: Partial<UserSettingsConfig> = { taskSyncEnabled: enabled }

		try {
			await CloudService.instance.updateUserSettings(updatedSettings)
		} catch (error) {
			provider.log(`Failed to update cloud settings for task sync: ${error}`)
		}
	},

	rooCloudSignIn: async (ctx, message) => {
		const { provider } = ctx
		try {
			TelemetryService.instance.captureEvent(TelemetryEventName.AUTHENTICATION_INITIATED)
			// Use provider signup flow if useProviderSignup is explicitly true
			await CloudService.instance.login(undefined, message.useProviderSignup ?? false)
		} catch (error) {
			provider.log(`AuthService#login failed: ${error}`)
			vscode.window.showErrorMessage("Sign in failed.")
		}
	},

	rooCloudSignOut: async (ctx) => {
		const { provider } = ctx
		try {
			await CloudService.instance.logout()
			await provider.postStateToWebview()
			provider.postMessageToWebview({ type: "authenticatedUser", userInfo: undefined })
		} catch (error) {
			provider.log(`AuthService#logout failed: ${error}`)
			vscode.window.showErrorMessage("Sign out failed.")
		}
	},

	openAiCodexSignIn: async (ctx) => {
		const { provider } = ctx
		try {
			const { openAiCodexOAuthManager } = await import("../../../integrations/openai-codex/oauth")
			const authUrl = openAiCodexOAuthManager.startAuthorizationFlow()

			// Open the authorization URL in the browser
			await vscode.env.openExternal(vscode.Uri.parse(authUrl))

			// Wait for the callback in a separate promise (non-blocking)
			openAiCodexOAuthManager
				.waitForCallback()
				.then(async () => {
					vscode.window.showInformationMessage("Successfully signed in to OpenAI Codex")
					await provider.postStateToWebview()
				})
				.catch((error) => {
					provider.log(`OpenAI Codex OAuth callback failed: ${error}`)
					if (!String(error).includes("timed out")) {
						vscode.window.showErrorMessage(`OpenAI Codex sign in failed: ${error.message || error}`)
					}
				})
		} catch (error) {
			provider.log(`OpenAI Codex OAuth failed: ${error}`)
			vscode.window.showErrorMessage("OpenAI Codex sign in failed.")
		}
	},

	openAiCodexSignOut: async (ctx) => {
		const { provider } = ctx
		try {
			const { openAiCodexOAuthManager } = await import("../../../integrations/openai-codex/oauth")
			await openAiCodexOAuthManager.clearCredentials()
			vscode.window.showInformationMessage("Signed out from OpenAI Codex")
			await provider.postStateToWebview()
		} catch (error) {
			provider.log(`OpenAI Codex sign out failed: ${error}`)
			vscode.window.showErrorMessage("OpenAI Codex sign out failed.")
		}
	},

	rooCloudManualUrl: async (ctx, message) => {
		const { provider } = ctx
		try {
			if (!message.text) {
				vscode.window.showErrorMessage(t("common:errors.manual_url_empty"))
				return
			}

			// Parse the callback URL to extract parameters
			const callbackUrl = message.text.trim()
			const uri = vscode.Uri.parse(callbackUrl)

			if (!uri.query) {
				throw new Error(t("common:errors.manual_url_no_query"))
			}

			const query = new URLSearchParams(uri.query)
			const code = query.get("code")
			const state = query.get("state")
			const organizationId = query.get("organizationId")

			if (!code || !state) {
				throw new Error(t("common:errors.manual_url_missing_params"))
			}

			// Reuse the existing authentication flow
			await CloudService.instance.handleAuthCallback(
				code,
				state,
				organizationId === "null" ? null : organizationId,
			)

			await provider.postStateToWebview()
		} catch (error) {
			provider.log(`ManualUrl#handleAuthCallback failed: ${error}`)
			const errorMessage = error instanceof Error ? error.message : t("common:errors.manual_url_auth_failed")

			// Show error message through VS Code UI
			vscode.window.showErrorMessage(`${t("common:errors.manual_url_auth_error")}: ${errorMessage}`)
		}
	},

	switchOrganization: async (ctx, message) => {
		const { provider } = ctx
		try {
			const organizationId = message.organizationId ?? null

			// Switch to the new organization context
			await CloudService.instance.switchOrganization(organizationId)

			// Refresh the state to update UI
			await provider.postStateToWebview()

			// Send success response back to webview
			await provider.postMessageToWebview({
				type: "organizationSwitchResult",
				success: true,
				organizationId: organizationId,
			})
		} catch (error) {
			provider.log(`Organization switch failed: ${error}`)
			const errorMessage = error instanceof Error ? error.message : String(error)

			// Send error response back to webview
			await provider.postMessageToWebview({
				type: "organizationSwitchResult",
				success: false,
				error: errorMessage,
				organizationId: message.organizationId ?? null,
			})

			vscode.window.showErrorMessage(`Failed to switch organization: ${errorMessage}`)
		}
	},

	requestOpenAiCodexRateLimits: async (ctx) => {
		const { provider } = ctx
		try {
			const { openAiCodexOAuthManager } = await import("../../../integrations/openai-codex/oauth")
			const accessToken = await openAiCodexOAuthManager.getAccessToken()

			if (!accessToken) {
				provider.postMessageToWebview({
					type: "openAiCodexRateLimits",
					error: "Not authenticated with OpenAI Codex",
				})
				return
			}

			const accountId = await openAiCodexOAuthManager.getAccountId()
			const { fetchOpenAiCodexRateLimitInfo } = await import("../../../integrations/openai-codex/rate-limits")
			const rateLimits = await fetchOpenAiCodexRateLimitInfo(accessToken, { accountId })

			provider.postMessageToWebview({
				type: "openAiCodexRateLimits",
				values: rateLimits,
			})
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			provider.log(`Error fetching OpenAI Codex rate limits: ${errorMessage}`)
			provider.postMessageToWebview({
				type: "openAiCodexRateLimits",
				error: errorMessage,
			})
		}
	},
}
