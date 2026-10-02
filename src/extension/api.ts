import { EventEmitter } from "events"
import fs from "fs/promises"
import * as path from "path"
import * as os from "os"

import * as vscode from "vscode"
import pWaitFor from "p-wait-for"

import {
	type TumbleCodeAPI,
	type TumbleCodeSettings,
	type TumbleCodeEvents,
	type ProviderSettings,
	type ProviderSettingsEntry,
	type CreateTaskOptions,
	TumbleCodeEventName,
	isSecretStateKey,
	SETTINGS_DEFAULTS,
} from "@tumble-code/types"

import { Package } from "../shared/package"
import { ClineProvider } from "../core/webview/ClineProvider"
import { Terminal } from "../integrations/terminal/Terminal"
import { TerminalRegistry } from "../integrations/terminal/TerminalRegistry"
import { openClineInNewTab } from "../activate/registerCommands"
import { logger } from "../utils/logging"

export class API extends EventEmitter<TumbleCodeEvents> implements TumbleCodeAPI {
	private readonly outputChannel: vscode.OutputChannel
	private readonly sidebarProvider: ClineProvider
	private readonly context: vscode.ExtensionContext
	private readonly log: (...args: unknown[]) => void
	private logfile?: string

	constructor(outputChannel: vscode.OutputChannel, provider: ClineProvider, enableLogging = false) {
		super()

		this.outputChannel = outputChannel
		this.sidebarProvider = provider
		this.context = provider.context

		if (enableLogging) {
			this.log = (...args: unknown[]) => logger.info(...args)

			this.logfile = path.join(os.tmpdir(), "roo-code-messages.log")
		} else {
			this.log = () => {}
		}

		this.registerListeners(this.sidebarProvider)
	}

	public async startNewTask({
		configuration,
		text,
		images,
		newTab,
	}: {
		configuration: TumbleCodeSettings
		text?: string
		images?: string[]
		newTab?: boolean
	}) {
		let provider: ClineProvider

		if (newTab) {
			await vscode.commands.executeCommand("workbench.action.files.revert")
			await vscode.commands.executeCommand("workbench.action.closeAllEditors")

			provider = await openClineInNewTab({ context: this.context, outputChannel: this.outputChannel })
			this.registerListeners(provider)
		} else {
			await vscode.commands.executeCommand(`${Package.name}.SidebarProvider.focus`)

			provider = this.sidebarProvider
		}

		await provider.clearCurrentTask()
		await provider.postStateToWebview()
		await provider.postMessageToWebview({ type: "action", action: "chatButtonClicked" })
		await provider.postMessageToWebview({ type: "invoke", invoke: "newChat", text, images })

		const options: CreateTaskOptions = {
			consecutiveMistakeLimit: Number.MAX_SAFE_INTEGER,
		}

		const task = await provider.createTask(text, images, undefined, options, configuration)

		if (!task) {
			throw new Error("Failed to create task due to policy restrictions")
		}

		return task.taskId
	}

	public async resumeTask(taskId: string): Promise<void> {
		await vscode.commands.executeCommand(`${Package.name}.SidebarProvider.focus`)
		await this.waitForWebviewLaunch(5_000)

		const historyItem = await this.sidebarProvider.getHistoryItem(taskId)
		await this.sidebarProvider.createTaskWithHistoryItem(historyItem)

		if (this.sidebarProvider.viewLaunched) {
			await this.sidebarProvider.postMessageToWebview({ type: "action", action: "chatButtonClicked" })
		} else {
			this.log(
				`[API#resumeTask] webview not launched after resume for task ${taskId}; continuing in headless mode`,
			)
		}
	}

	public async isTaskInHistory(taskId: string): Promise<boolean> {
		try {
			await this.sidebarProvider.getHistoryItem(taskId)
			return true
		} catch {
			return false
		}
	}

	public getCurrentTaskStack() {
		return this.sidebarProvider.getCurrentTaskStack()
	}

	public async clearCurrentTask(_lastMessage?: string) {
		// Legacy finishSubTask removed; clear current by closing active task instance.
		await this.sidebarProvider.clearCurrentTask()
		await this.sidebarProvider.postStateToWebview()
	}

	public async cancelCurrentTask() {
		await this.sidebarProvider.cancelTask()
	}

	public async sendMessage(text?: string, images?: string[]) {
		const currentTask = this.sidebarProvider.getCurrentTask()

		// In headless/sandbox flows the webview may not be launched, so routing
		// through invoke=sendMessage drops the message. Deliver directly to the
		// task ask-response channel instead.
		if (!this.sidebarProvider.viewLaunched) {
			if (!currentTask) {
				this.log("[API#sendMessage] no current task in headless mode; message dropped")
				return
			}

			await currentTask.submitUserMessage(text ?? "", images)
			return
		}

		await this.sidebarProvider.postMessageToWebview({ type: "invoke", invoke: "sendMessage", text, images })
	}

	public deleteQueuedMessage(messageId: string) {
		const currentTask = this.sidebarProvider.getCurrentTask()

		if (!currentTask) {
			this.log(`[API#deleteQueuedMessage] no current task; ignoring delete for messageId ${messageId}`)
			return
		}

		currentTask.messageQueueService.removeMessage(messageId)
	}

	public async pressPrimaryButton() {
		await this.sidebarProvider.postMessageToWebview({ type: "invoke", invoke: "primaryButtonClick" })
	}

	public async pressSecondaryButton() {
		await this.sidebarProvider.postMessageToWebview({ type: "invoke", invoke: "secondaryButtonClick" })
	}

	public isReady() {
		return this.sidebarProvider.viewLaunched
	}

	private async waitForWebviewLaunch(timeoutMs: number): Promise<boolean> {
		try {
			await pWaitFor(() => this.sidebarProvider.viewLaunched, {
				timeout: timeoutMs,
				interval: 50,
			})

			return true
		} catch {
			this.log(`[API#waitForWebviewLaunch] webview did not launch within ${timeoutMs}ms`)
			return false
		}
	}

	private registerListeners(provider: ClineProvider) {
		// Delegation lifecycle. DelegationService emits these on the provider
		// (its host), never on a Task, and the payload already names both the
		// parent and the child, so they are forwarded once per provider rather
		// than per task. ClineProvider.dispose() removes all of its listeners,
		// these included.

		provider.on(TumbleCodeEventName.TaskDelegated, (parentTaskId, childTaskId) => {
			this.emit(TumbleCodeEventName.TaskDelegated, parentTaskId, childTaskId)
		})

		provider.on(TumbleCodeEventName.TaskDelegationCompleted, (parentTaskId, childTaskId, summary) => {
			this.emit(TumbleCodeEventName.TaskDelegationCompleted, parentTaskId, childTaskId, summary)
		})

		provider.on(TumbleCodeEventName.TaskDelegationResumed, (parentTaskId, childTaskId) => {
			this.emit(TumbleCodeEventName.TaskDelegationResumed, parentTaskId, childTaskId)
		})

		provider.on(TumbleCodeEventName.TaskCreated, (task) => {
			// Task Lifecycle

			task.on(TumbleCodeEventName.TaskStarted, async () => {
				this.emit(TumbleCodeEventName.TaskStarted, task.taskId)
				await this.fileLog(`[${new Date().toISOString()}] taskStarted -> ${task.taskId}\n`)
			})

			task.on(TumbleCodeEventName.TaskCompleted, async (_, tokenUsage, toolUsage) => {
				this.emit(TumbleCodeEventName.TaskCompleted, task.taskId, tokenUsage, toolUsage, {
					isSubtask: !!task.parentTaskId,
				})

				await this.fileLog(
					`[${new Date().toISOString()}] taskCompleted -> ${task.taskId} | ${JSON.stringify(tokenUsage, null, 2)} | ${JSON.stringify(toolUsage, null, 2)}\n`,
				)
			})

			task.on(TumbleCodeEventName.TaskAborted, () => {
				this.emit(TumbleCodeEventName.TaskAborted, task.taskId)
			})

			task.on(TumbleCodeEventName.TaskFocused, () => {
				this.emit(TumbleCodeEventName.TaskFocused, task.taskId)
			})

			task.on(TumbleCodeEventName.TaskUnfocused, () => {
				this.emit(TumbleCodeEventName.TaskUnfocused, task.taskId)
			})

			task.on(TumbleCodeEventName.TaskActive, () => {
				this.emit(TumbleCodeEventName.TaskActive, task.taskId)
			})

			task.on(TumbleCodeEventName.TaskInteractive, () => {
				this.emit(TumbleCodeEventName.TaskInteractive, task.taskId)
			})

			task.on(TumbleCodeEventName.TaskResumable, () => {
				this.emit(TumbleCodeEventName.TaskResumable, task.taskId)
			})

			task.on(TumbleCodeEventName.TaskIdle, () => {
				this.emit(TumbleCodeEventName.TaskIdle, task.taskId)
			})

			// Subtask Lifecycle

			task.on(TumbleCodeEventName.TaskPaused, () => {
				this.emit(TumbleCodeEventName.TaskPaused, task.taskId)
			})

			task.on(TumbleCodeEventName.TaskUnpaused, () => {
				this.emit(TumbleCodeEventName.TaskUnpaused, task.taskId)
			})

			task.on(TumbleCodeEventName.TaskSpawned, (childTaskId) => {
				this.emit(TumbleCodeEventName.TaskSpawned, task.taskId, childTaskId)
			})

			// Task Execution

			task.on(TumbleCodeEventName.Message, async (message) => {
				this.emit(TumbleCodeEventName.Message, { taskId: task.taskId, ...message })

				if (message.message.partial !== true) {
					await this.fileLog(`[${new Date().toISOString()}] ${JSON.stringify(message.message, null, 2)}\n`)
				}
			})

			task.on(TumbleCodeEventName.TaskModeSwitched, (taskId, mode) => {
				this.emit(TumbleCodeEventName.TaskModeSwitched, taskId, mode)
			})

			task.on(TumbleCodeEventName.TaskAskResponded, () => {
				this.emit(TumbleCodeEventName.TaskAskResponded, task.taskId)
			})

			task.on(TumbleCodeEventName.QueuedMessagesUpdated, (taskId, messages) => {
				this.emit(TumbleCodeEventName.QueuedMessagesUpdated, taskId, messages)
			})

			// Task Analytics

			task.on(TumbleCodeEventName.TaskToolFailed, (taskId, tool, error) => {
				this.emit(TumbleCodeEventName.TaskToolFailed, taskId, tool, error)
			})

			task.on(TumbleCodeEventName.TaskTokenUsageUpdated, (_, tokenUsage, toolUsage) => {
				this.emit(TumbleCodeEventName.TaskTokenUsageUpdated, task.taskId, tokenUsage, toolUsage)
			})

			// Let's go!

			this.emit(TumbleCodeEventName.TaskCreated, task.taskId)
		})
	}

	// Logging

	private async fileLog(message: string) {
		if (!this.logfile) {
			return
		}

		try {
			await fs.appendFile(this.logfile, message, "utf8")
		} catch (_) {
			this.logfile = undefined
		}
	}

	// Global Settings Management

	public getConfiguration(): TumbleCodeSettings {
		return Object.fromEntries(
			Object.entries(this.sidebarProvider.getValues()).filter(([key]) => !isSecretStateKey(key)),
		)
	}

	public async setConfiguration(values: TumbleCodeSettings) {
		await this.sidebarProvider.contextProxy.setValues(values)
		await this.sidebarProvider.providerSettingsManager.saveConfig(
			values.currentApiConfigName || SETTINGS_DEFAULTS.currentApiConfigName,
			values,
		)
		await this.sidebarProvider.postStateToWebview()
	}

	public setTerminalProfile(name: string | undefined): void {
		const previousProfile = Terminal.getTerminalProfile()
		Terminal.setTerminalProfile(name)

		if (Terminal.getTerminalProfile() !== previousProfile) {
			TerminalRegistry.closeIdleTerminals()
		}
	}

	// Provider Profile Management

	public getProfiles(): string[] {
		return this.sidebarProvider.getProviderProfileEntries().map(({ name }) => name)
	}

	public getProfileEntry(name: string): ProviderSettingsEntry | undefined {
		return this.sidebarProvider.getProviderProfileEntry(name)
	}

	public async createProfile(name: string, profile?: ProviderSettings, activate: boolean = true) {
		const entry = this.getProfileEntry(name)

		if (entry) {
			throw new Error(`Profile with name "${name}" already exists`)
		}

		const id = await this.sidebarProvider.upsertProviderProfile(name, profile ?? {}, activate)

		if (!id) {
			throw new Error(`Failed to create profile with name "${name}"`)
		}

		return id
	}

	public async updateProfile(
		name: string,
		profile: ProviderSettings,
		activate: boolean = true,
	): Promise<string | undefined> {
		const entry = this.getProfileEntry(name)

		if (!entry) {
			throw new Error(`Profile with name "${name}" does not exist`)
		}

		const id = await this.sidebarProvider.upsertProviderProfile(name, profile, activate)

		if (!id) {
			throw new Error(`Failed to update profile with name "${name}"`)
		}

		return id
	}

	public async upsertProfile(
		name: string,
		profile: ProviderSettings,
		activate: boolean = true,
	): Promise<string | undefined> {
		const id = await this.sidebarProvider.upsertProviderProfile(name, profile, activate)

		if (!id) {
			throw new Error(`Failed to upsert profile with name "${name}"`)
		}

		return id
	}

	public async deleteProfile(name: string): Promise<void> {
		const entry = this.getProfileEntry(name)

		if (!entry) {
			throw new Error(`Profile with name "${name}" does not exist`)
		}

		await this.sidebarProvider.deleteProviderProfile(entry)
	}

	public getActiveProfile(): string | undefined {
		return this.getConfiguration().currentApiConfigName
	}

	public async setActiveProfile(name: string): Promise<string | undefined> {
		const entry = this.getProfileEntry(name)

		if (!entry) {
			throw new Error(`Profile with name "${name}" does not exist`)
		}

		await this.sidebarProvider.activateProviderProfile({ name })
		return this.getActiveProfile()
	}
}
