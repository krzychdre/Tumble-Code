// Provider (API configuration) profiles and model lists.

import * as vscode from "vscode"
import { fetchModelSource } from "../../../api/providers/fetchers/modelSourceRegistry"
import { t } from "../../../i18n"
import { logAndToast, serializeError } from "./context"
import type { MessageHandlerMap } from "./types"

export const providerProfilesHandlers: MessageHandlerMap = {
	requestProviderModels: async (ctx, message) => {
		const { provider } = ctx
		const request = message.modelSourceRequest
		if (!request) {
			return
		}

		try {
			const { apiConfiguration } = await provider.getState()
			const payload = await fetchModelSource(request, {
				apiConfiguration,
			})
			await provider.postMessageToWebview({
				type: "providerModels",
				modelSourceResult: {
					requestId: request.requestId,
					sourceId: request.source.id,
					...payload,
				},
			})
		} catch (error) {
			await provider.postMessageToWebview({
				type: "providerModels",
				modelSourceResult: {
					requestId: request.requestId,
					sourceId: request.source.id,
					error: error instanceof Error ? error.message : String(error),
				},
			})
		}
	},

	lockApiConfigAcrossModes: async (ctx, message) => {
		const { provider } = ctx
		const enabled = message.bool ?? false
		await provider.context.workspaceState.update("lockApiConfigAcrossModes", enabled)

		await provider.postStateToWebview()
	},

	cliModeProviderSettings: (ctx, message) => {
		const { provider } = ctx
		provider.setCliModeProviderSettings(message.cliModeProviderSettings)
	},

	assignCurrentApiConfigToModes: async (ctx, message) => {
		const { provider } = ctx
		const configId = message.values?.configId as string | undefined
		const modeSlugs = (message.values?.modeSlugs as string[] | undefined) ?? []

		if (configId && modeSlugs.length > 0) {
			await provider.providerSettingsManager.setModeConfigs(modeSlugs, configId)
			await provider.postStateToWebview()
		}
	},

	toggleApiConfigPin: async (ctx, message) => {
		const { provider, getGlobalState, updateGlobalState } = ctx
		if (message.text) {
			const currentPinned = getGlobalState("pinnedApiConfigs") ?? {}
			const updatedPinned: Record<string, boolean> = { ...currentPinned }

			if (currentPinned[message.text]) {
				delete updatedPinned[message.text]
			} else {
				updatedPinned[message.text] = true
			}

			await updateGlobalState("pinnedApiConfigs", updatedPinned)
			await provider.postStateToWebview()
		}
	},

	enhancementApiConfigId: async (ctx, message) => {
		const { provider, updateGlobalState } = ctx
		await updateGlobalState("enhancementApiConfigId", message.text)
		await provider.postStateToWebview()
	},

	upsertApiConfiguration: async (ctx, message) => {
		const { provider } = ctx
		if (message.text && message.apiConfiguration) {
			await provider.upsertProviderProfile(message.text, message.apiConfiguration)
		}
	},

	renameApiConfiguration: async (ctx, message) => {
		const { provider } = ctx
		if (message.values && message.apiConfiguration) {
			try {
				const { oldName, newName } = message.values

				if (oldName === newName) {
					return
				}

				// Load the old configuration to get its ID.
				const { id } = await provider.providerSettingsManager.getProfile({ name: oldName })

				// Create a new configuration with the new name and old ID.
				await provider.providerSettingsManager.saveConfig(newName, { ...message.apiConfiguration, id })

				// Delete the old configuration.
				await provider.providerSettingsManager.deleteConfig(oldName)

				// Re-activate to update the global settings related to the
				// currently activated provider profile.
				await provider.activateProviderProfile({ name: newName })
			} catch (error) {
				provider.log(`Error rename api configuration: ${serializeError(error)}`)

				const errorMessage = error instanceof Error ? error.message : String(error)
				vscode.window.showErrorMessage(t("common:errors.rename_api_config") + ": " + errorMessage)
			}
		}
	},

	loadApiConfiguration: async (ctx, message) => {
		const { provider } = ctx
		if (message.text) {
			try {
				await provider.activateProviderProfile({ name: message.text })
			} catch (error) {
				provider.log(`Error load api configuration: ${serializeError(error)}`)
				const errorMessage = error instanceof Error ? error.message : String(error)
				vscode.window.showErrorMessage(t("common:errors.load_api_config") + ": " + errorMessage)
			}
		}
	},

	loadApiConfigurationById: async (ctx, message) => {
		const { provider } = ctx
		if (message.text) {
			try {
				await provider.activateProviderProfile({ id: message.text })
			} catch (error) {
				provider.log(`Error load api configuration by ID: ${serializeError(error)}`)
				const errorMessage = error instanceof Error ? error.message : String(error)
				vscode.window.showErrorMessage(t("common:errors.load_api_config") + ": " + errorMessage)
			}
		}
	},

	deleteApiConfiguration: async (ctx, message) => {
		const { provider } = ctx
		if (message.text) {
			const answer = await vscode.window.showInformationMessage(
				t("common:confirmation.delete_config_profile"),
				{ modal: true },
				t("common:answers.yes"),
			)

			if (answer !== t("common:answers.yes")) {
				return
			}

			const oldName = message.text

			const newName = (await provider.providerSettingsManager.listConfig()).filter((c) => c.name !== oldName)[0]
				?.name

			if (!newName) {
				vscode.window.showErrorMessage(t("common:errors.delete_api_config"))
				return
			}

			try {
				await provider.providerSettingsManager.deleteConfig(oldName)
				await provider.activateProviderProfile({ name: newName })
			} catch (error) {
				logAndToast(ctx, "Error delete api configuration: ", error, "common:errors.delete_api_config")
			}
		}
	},
}
