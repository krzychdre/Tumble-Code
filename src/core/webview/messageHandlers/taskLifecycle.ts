// Task lifecycle: webview launch, creating, answering, clearing, exporting and deleting tasks, the chat message queue.

import * as vscode from "vscode"
import { TelemetryService } from "@roo-code/telemetry"
import type { EditQueuedMessagePayload } from "@roo-code/types"
import { t } from "../../../i18n"
import { getTheme } from "../../../integrations/theme/getTheme"
import { checkExistKey } from "../../../shared/checkExistApiConfig"
import { setPendingTodoList } from "../../tools/UpdateTodoListTool"
import { resolveIncomingImages, serializeError } from "./context"
import type { MessageHandlerMap } from "./types"

export const taskLifecycleHandlers: MessageHandlerMap = {
	webviewDidLaunch: async (ctx) => {
		const { provider, getGlobalState, updateGlobalState } = ctx
		// Load custom modes first
		const customModes = await provider.customModesManager.getCustomModes()
		await updateGlobalState("customModes", customModes)

		provider.postStateToWebview()
		provider.workspaceTracker?.initializeFilePaths() // Don't await.

		getTheme().then((theme) => provider.postMessageToWebview({ type: "theme", text: JSON.stringify(theme) }))

		// If MCP Hub is already initialized, update the webview with
		// current server list.
		const mcpHub = provider.getMcpHub()

		if (mcpHub) {
			provider.postMessageToWebview({ type: "mcpServers", mcpServers: mcpHub.getAllServers() })
		}

		provider.providerSettingsManager
			.listConfig()
			.then(async (listApiConfig) => {
				if (!listApiConfig) {
					return
				}

				if (listApiConfig.length === 1) {
					// Check if first time init then sync with exist config.
					if (!checkExistKey(listApiConfig[0])) {
						const { apiConfiguration } = await provider.getState()

						// Only save if the current configuration has meaningful settings
						// (e.g., API keys). This prevents saving a default "anthropic"
						// fallback when no real config exists, which can happen during
						// CLI initialization before provider settings are applied.
						if (checkExistKey(apiConfiguration)) {
							await provider.providerSettingsManager.saveConfig(
								listApiConfig[0].name ?? "default",
								apiConfiguration,
							)

							listApiConfig[0].apiProvider = apiConfiguration.apiProvider
						}
					}
				}

				const currentConfigName = getGlobalState("currentApiConfigName")

				if (currentConfigName) {
					if (!(await provider.providerSettingsManager.hasConfig(currentConfigName))) {
						// Current config name not valid, get first config in list.
						const name = listApiConfig[0]?.name
						await updateGlobalState("currentApiConfigName", name)

						if (name) {
							await provider.activateProviderProfile({ name })
							return
						}
					}
				}

				await Promise.all([
					await updateGlobalState("listApiConfigMeta", listApiConfig),
					await provider.postMessageToWebview({ type: "listApiConfig", listApiConfig }),
				])
			})
			.catch((error) => provider.log(`Error list api configuration: ${serializeError(error)}`))

		// Enable telemetry by default (when unset) or when explicitly enabled
		TelemetryService.instance.updateTelemetryState(getGlobalState("telemetrySetting") !== "disabled")

		provider.isViewLaunched = true
	},

	newTask: async (ctx, message) => {
		const { provider } = ctx
		// Initializing new instance of Cline will make sure that any
		// agentically running promises in old instance don't affect our new
		// task. This essentially creates a fresh slate for the new task.
		try {
			const resolved = await resolveIncomingImages(ctx, { text: message.text, images: message.images })
			await provider.createTask(
				resolved.text,
				resolved.images,
				undefined,
				{ taskId: message.taskId },
				message.taskConfiguration,
			)
			// Task created successfully - notify the UI to reset
			await provider.postMessageToWebview({ type: "invoke", invoke: "newChat" })
		} catch (error) {
			// For all errors, reset the UI and show error
			await provider.postMessageToWebview({ type: "invoke", invoke: "newChat" })
			// Show error to user
			vscode.window.showErrorMessage(
				`Failed to create task: ${error instanceof Error ? error.message : String(error)}`,
			)
		}
	},

	askResponse: async (ctx, message) => {
		const { provider } = ctx
		{
			const resolved = await resolveIncomingImages(ctx, { text: message.text, images: message.images })
			// A taskId routes the answer to a live background subagent
			// (subagents panel). If that child is already gone the response
			// is DROPPED - falling back to the current task would answer a
			// foreground ask with text meant for the dead child.
			const target = message.taskId ? provider.getBackgroundTask(message.taskId) : provider.getCurrentTask()
			target?.handleWebviewAskResponse(message.askResponse!, resolved.text, resolved.images)
		}
	},

	terminalOperation: (ctx, message) => {
		const { provider } = ctx
		if (message.terminalOperation) {
			provider.getCurrentTask()?.handleTerminalOperation(message.terminalOperation)
		}
	},

	clearTask: async (ctx) => {
		const { provider } = ctx
		// Clear task resets the current session. Delegation flows are
		// handled via metadata; parent resumption occurs through
		// reopenParentFromDelegation, not via finishSubTask.
		await provider.clearTask()
		await provider.postStateToWebview()
	},

	didShowAnnouncement: async (ctx) => {
		const { provider, updateGlobalState } = ctx
		await updateGlobalState("lastShownAnnouncementId", provider.latestAnnouncementId)
		await provider.postStateToWebview()
	},

	exportCurrentTask: (ctx) => {
		const { provider } = ctx
		const currentTaskId = provider.getCurrentTask()?.taskId
		if (currentTaskId) {
			provider.exportTaskWithId(currentTaskId)
		}
	},

	showTaskWithId: (ctx, message) => {
		const { provider } = ctx
		provider.showTaskWithId(message.text!).catch((error) => {
			const errorMessage = error instanceof Error ? error.message : String(error)
			provider.log(`[showTaskWithId] Failed to show task ${message.text}: ${errorMessage}`)
			// Append the cause: "Task not found" and an I/O failure need
			// very different reactions from the user.
			vscode.window.showErrorMessage(t("common:errors.task_show_failed") + ": " + errorMessage)
		})
	},

	condenseTaskContextRequest: (ctx, message) => {
		const { provider } = ctx
		// Fire-and-forget: condenseTaskContext now has its own try/finally
		// that always sends condenseTaskContextResponse, so the spinner is
		// dismissed even on throw. This .catch prevents an unhandled
		// rejection (e.g. task-not-found) from surfacing as a stray error.
		provider.condenseTaskContext(message.text!).catch((error) => {
			provider.log(
				`[condenseTaskContext] Failed for task ${message.text}: ${
					error instanceof Error ? error.message : String(error)
				}`,
			)
		})
	},

	deleteTaskWithId: (ctx, message) => {
		const { provider } = ctx
		provider.deleteTaskWithId(message.text!)
	},

	deleteMultipleTasksWithIds: async (ctx, message) => {
		const { provider } = ctx
		const ids = message.ids

		if (Array.isArray(ids)) {
			// Process in batches of 20 (or another reasonable number)
			const batchSize = 20
			const results = []

			// Only log start and end of the operation
			console.log(`Batch deletion started: ${ids.length} tasks total`)

			for (let i = 0; i < ids.length; i += batchSize) {
				const batch = ids.slice(i, i + batchSize)

				const batchPromises = batch.map(async (id) => {
					try {
						await provider.deleteTaskWithId(id)
						return { id, success: true }
					} catch (error) {
						// Keep error logging for debugging purposes
						console.log(
							`Failed to delete task ${id}: ${error instanceof Error ? error.message : String(error)}`,
						)
						return { id, success: false }
					}
				})

				// Process each batch in parallel but wait for completion before starting the next batch
				const batchResults = await Promise.all(batchPromises)
				results.push(...batchResults)

				// Update the UI after each batch to show progress
				await provider.postStateToWebview()
			}

			// Log final results
			const successCount = results.filter((r) => r.success).length
			const failCount = results.length - successCount
			console.log(
				`Batch deletion completed: ${successCount}/${ids.length} tasks successful, ${failCount} tasks failed`,
			)
		}
	},

	exportTaskWithId: (ctx, message) => {
		const { provider } = ctx
		provider.exportTaskWithId(message.text!)
	},

	getTaskWithAggregatedCosts: async (ctx, message) => {
		const { provider } = ctx
		try {
			const taskId = message.text
			if (!taskId) {
				throw new Error("Task ID is required")
			}
			const result = await provider.getTaskWithAggregatedCosts(taskId)
			await provider.postMessageToWebview({
				type: "taskWithAggregatedCosts",
				// IMPORTANT: ChatView stores aggregatedCostsMap keyed by message.text (taskId)
				// so we must include it here.
				text: taskId,
				historyItem: result.historyItem,
				aggregatedCosts: result.aggregatedCosts,
			})
		} catch (error) {
			console.error("Error getting task with aggregated costs:", error)
			await provider.postMessageToWebview({
				type: "taskWithAggregatedCosts",
				// Include taskId when available for correlation in UI logs.
				text: message.text,
				error: error instanceof Error ? error.message : String(error),
			})
		}
	},

	cancelTask: async (ctx) => {
		const { provider } = ctx
		await provider.cancelTask()
	},

	cancelAutoApproval: (ctx) => {
		const { provider } = ctx
		// Cancel any pending auto-approval timeout for the current task
		provider.getCurrentTask()?.cancelAutoApprovalTimeout()
	},

	updateTodoList: (ctx, message) => {
		const { provider } = ctx
		const payload = message.payload as { todos?: any[] }
		const todos = payload?.todos
		if (Array.isArray(todos)) {
			// Route the edit to the task whose approval dialog it came from
			// (DEF-C3): a parallel subagent may be waiting on its own
			// update_todo_list approval at the same time. Without a taskId
			// the edit belongs to the foreground task.
			const currentTask = provider.getCurrentTask()
			const task =
				message.taskId === undefined || message.taskId === currentTask?.taskId
					? currentTask
					: provider.getBackgroundTask(message.taskId)
			if (task) {
				setPendingTodoList(task, todos)
			}
		}
	},

	queueMessage: async (ctx, message) => {
		const { provider } = ctx
		const resolved = await resolveIncomingImages(ctx, { text: message.text, images: message.images })
		provider.getCurrentTask()?.messageQueueService.addMessage(resolved.text, resolved.images)
	},

	removeQueuedMessage: (ctx, message) => {
		const { provider } = ctx
		provider.getCurrentTask()?.messageQueueService.removeMessage(message.text ?? "")
	},

	editQueuedMessage: (ctx, message) => {
		const { provider } = ctx
		if (message.payload) {
			const { id, text, images } = message.payload as EditQueuedMessagePayload
			provider.getCurrentTask()?.messageQueueService.updateMessage(id, text, images)
		}
	},
}
