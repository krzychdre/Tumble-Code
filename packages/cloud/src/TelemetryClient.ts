import {
	type TelemetryClient,
	type TelemetryEvent,
	type ClineMessage,
	type AuthService,
	type SettingsService,
	type ErrorReport,
	TelemetryEventName,
	errorReportSchema,
	tumbleCodeTelemetryEventSchema,
	TelemetryPropertiesProvider,
	TelemetryEventSubscription,
} from "@tumble-code/types"

import { readFile } from "node:fs/promises"
import path from "node:path"

import { redactSecrets } from "@tumble-code/core/redact"

import { getTumbleCodeApiUrl } from "./config.js"
import type { RetryQueue } from "./retry-queue/index.js"
import { findLocalImageReferences, locateTaskImage } from "./taskImages.js"

const MAX_EXCEPTION_MESSAGE_CHARS = 2_000
const MAX_EXCEPTION_STACK_CHARS = 4_000

/** How many uploaded images the client remembers, so a file is not sent twice. */
const MAX_REMEMBERED_TASK_IMAGES = 5_000

function truncate(text: string, max: number): string {
	return text.length > max ? `${text.slice(0, max)}…` : text
}

/** The event properties `CloudTelemetryClient.captureException` sends for one error. */
function exceptionProperties(error: Error, additionalProperties?: Record<string, unknown>): Record<string, unknown> {
	const ownFields = Object.entries(error).filter(
		([, value]) => typeof value === "string" || typeof value === "number" || typeof value === "boolean",
	)

	return {
		...Object.fromEntries(ownFields),
		...additionalProperties,
		errorName: error.name,
		errorMessage: truncate(error.message, MAX_EXCEPTION_MESSAGE_CHARS),
		...(error.stack ? { stack: truncate(error.stack, MAX_EXCEPTION_STACK_CHARS) } : {}),
	}
}

abstract class BaseTelemetryClient implements TelemetryClient {
	protected providerRef: WeakRef<TelemetryPropertiesProvider> | null = null
	protected telemetryEnabled: boolean = false

	constructor(
		public readonly subscription?: TelemetryEventSubscription,
		protected readonly debug = false,
	) {}

	protected isEventCapturable(eventName: TelemetryEventName): boolean {
		if (!this.subscription) {
			return true
		}

		return this.subscription.type === "include"
			? this.subscription.events.includes(eventName)
			: !this.subscription.events.includes(eventName)
	}

	/**
	 * Determines if a specific property should be included in telemetry events
	 * Override in subclasses to filter specific properties
	 */
	protected isPropertyCapturable(_propertyName: string): boolean {
		return true
	}

	protected async getEventProperties(event: TelemetryEvent): Promise<TelemetryEvent["properties"]> {
		let providerProperties: TelemetryEvent["properties"] = {}
		const provider = this.providerRef?.deref()

		if (provider) {
			try {
				// Get properties from the provider
				const taskId = event.properties?.taskId
				providerProperties = await provider.getTelemetryProperties(
					typeof taskId === "string" ? taskId : undefined,
				)
			} catch (error) {
				// Log error but continue with capturing the event.
				console.error(
					`Error getting telemetry properties: ${error instanceof Error ? error.message : String(error)}`,
				)
			}
		}

		// Merge provider properties with event-specific properties.
		// Event properties take precedence in case of conflicts.
		const mergedProperties = {
			...providerProperties,
			...(event.properties || {}),
		}

		// Filter out properties that shouldn't be captured by this client
		return Object.fromEntries(Object.entries(mergedProperties).filter(([key]) => this.isPropertyCapturable(key)))
	}

	public abstract capture(event: TelemetryEvent): Promise<void>

	public async captureException(_error: Error, _additionalProperties?: Record<string, unknown>): Promise<void> {}

	public setProvider(provider: TelemetryPropertiesProvider): void {
		this.providerRef = new WeakRef(provider)
	}

	public isTelemetryEnabled(): boolean {
		return this.telemetryEnabled
	}

	public abstract shutdown(): Promise<void>
}

export class CloudTelemetryClient extends BaseTelemetryClient {
	private retryQueue: RetryQueue | null = null

	/**
	 * `taskId|ts|path|mtimeMs|size` of every image already sent (or being
	 * sent), oldest first. A changed file has a new key and is sent again.
	 */
	private sentTaskImages = new Set<string>()

	constructor(
		private authService: AuthService,
		private settingsService: SettingsService,
		private secretValues: () => readonly string[],
		retryQueue?: RetryQueue,
	) {
		super({
			type: "exclude",
			events: [TelemetryEventName.TASK_CONVERSATION_MESSAGE],
		})
		this.retryQueue = retryQueue || null
	}

	/** POSTs `payload` as JSON, redacted (`redactSecrets`) before it is serialized. */
	private async post(path: string, payload: unknown, allowQueueing = true) {
		if (!this.authService.isAuthenticated()) {
			return
		}

		const token = this.authService.getSessionToken()

		if (!token) {
			console.error(`[TelemetryClient#post] Unauthorized: No session token available.`)
			return
		}

		const url = `${getTumbleCodeApiUrl()}/api/${path}`
		const fetchOptions: RequestInit = {
			method: "POST",
			body: JSON.stringify(redactSecrets(payload, this.secretValues())),
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
			},
		}

		try {
			const response = await fetch(url, {
				...fetchOptions,
				signal: AbortSignal.timeout(30_000),
			})

			if (!response.ok) {
				console.error(`[TelemetryClient#post] POST ${path} -> ${response.status} ${response.statusText}`)

				// Queue for retry on server errors (5xx) or rate limiting (429)
				// Do NOT retry on client errors (4xx) except 429 - they won't succeed
				if (this.retryQueue && allowQueueing && (response.status >= 500 || response.status === 429)) {
					await this.retryQueue.enqueue(url, fetchOptions, "telemetry")
				}
			}

			return response
		} catch (error) {
			console.error(`[TelemetryClient#post] Network error for POST ${path}: ${error}`)

			// Queue for retry on network failures (typically TypeError with "fetch failed" message)
			// These are transient network issues that may succeed on retry
			if (
				this.retryQueue &&
				allowQueueing &&
				error instanceof TypeError &&
				error.message.includes("fetch failed")
			) {
				await this.retryQueue.enqueue(url, fetchOptions, "telemetry")
			}

			throw error
		}
	}

	public override async capture(event: TelemetryEvent) {
		if (!this.isTelemetryEnabled() || !this.isEventCapturable(event.event)) {
			if (this.debug) {
				console.info(`[TelemetryClient#capture] Skipping event: ${event.event}`)
			}

			return
		}

		const payload = {
			type: event.event,
			properties: await this.getEventProperties(event),
		}

		if (this.debug) {
			console.info(`[TelemetryClient#capture] ${JSON.stringify(payload)}`)
		}

		const result = tumbleCodeTelemetryEventSchema.safeParse(payload)

		if (!result.success) {
			console.error(
				`[TelemetryClient#capture] Invalid telemetry event: ${result.error.message} - ${JSON.stringify(payload)}`,
			)

			return
		}

		let response: Response | undefined

		try {
			response = await this.post(`events`, result.data)
		} catch (error) {
			console.error(`[TelemetryClient#capture] Error sending telemetry event: ${error}`)
			// Error is already queued for retry in the post method
		}

		const data = result.data
		if (response?.ok && data.type === TelemetryEventName.TASK_MESSAGE && data.properties.message.partial !== true) {
			// Not awaited: an upload must never hold up or break the event path.
			void this.uploadTaskImages(data.properties.taskId, [data.properties.message])
		}
	}

	/**
	 * Sends the error as an `Exception` event, so the cloud diagnostics page
	 * can group it. The error's own primitive fields (provider, modelId,
	 * taskId, ...) come along; the message and the stack are shortened.
	 */
	public override async captureException(error: Error, additionalProperties?: Record<string, unknown>) {
		await this.capture({
			event: TelemetryEventName.EXCEPTION,
			properties: exceptionProperties(error, additionalProperties),
		})
	}

	/**
	 * Sends one error report (`POST /api/error-reports`) with the same session
	 * token, timeout and retry queue as the telemetry events. Does nothing, and
	 * builds no request, when the user is not signed in to the cloud or
	 * telemetry is switched off by the environment.
	 */
	public async sendErrorReport(report: ErrorReport): Promise<void> {
		if (!this.isTelemetryEnabled() || !this.authService.isAuthenticated()) {
			return
		}

		const result = errorReportSchema.safeParse(report)

		if (!result.success) {
			console.error(`[TelemetryClient#sendErrorReport] Invalid error report: ${result.error.message}`)
			return
		}

		try {
			await this.post(`error-reports`, result.data)
		} catch (error) {
			console.error(`[TelemetryClient#sendErrorReport] Error sending error report: ${error}`)
			// A network failure is already queued for retry in the post method.
		}
	}

	public async backfillMessages(messages: ClineMessage[], taskId: string): Promise<void> {
		if (!this.isTelemetryEnabled()) {
			return
		}

		if (!this.authService.isAuthenticated()) {
			if (this.debug) {
				console.info(`[TelemetryClient#backfillMessages] Skipping: Not authenticated`)
			}
			return
		}

		const token = this.authService.getSessionToken()

		if (!token) {
			console.error(`[TelemetryClient#backfillMessages] Unauthorized: No session token available.`)
			return
		}

		try {
			const mergedProperties = await this.getEventProperties({
				event: TelemetryEventName.TASK_MESSAGE,
				properties: { taskId },
			})
			const secretValues = this.secretValues()

			const formData = new FormData()
			formData.append("taskId", taskId)
			formData.append("properties", JSON.stringify(redactSecrets(mergedProperties, secretValues)))

			// Worktree root, sent explicitly so the cloud web view can attribute
			// this (possibly offline) task to its project. Kept out of `properties`
			// to avoid embedding an absolute path in the per-event payload.
			const workspacePath = this.providerRef?.deref()?.getTelemetryWorkspacePath?.()
			if (workspacePath) {
				formData.append("workspacePath", workspacePath)
			}

			formData.append(
				"file",
				new File([JSON.stringify(redactSecrets(messages, secretValues))], "task.json", {
					type: "application/json",
				}),
			)

			if (this.debug) {
				console.info(
					`[TelemetryClient#backfillMessages] Uploading ${messages.length} messages for task ${taskId}`,
				)
			}

			const url = `${getTumbleCodeApiUrl()}/api/events/backfill`
			const fetchOptions: RequestInit = {
				method: "POST",
				headers: {
					Authorization: `Bearer ${token}`,
				},
				body: formData,
			}

			try {
				const response = await fetch(url, {
					...fetchOptions,
					signal: AbortSignal.timeout(30_000),
				})

				if (!response.ok) {
					console.error(
						`[TelemetryClient#backfillMessages] POST events/backfill -> ${response.status} ${response.statusText}`,
					)
				} else {
					// Not awaited, like the uploads after a live event.
					void this.uploadTaskImages(taskId, messages)
				}
			} catch (fetchError) {
				console.error(`[TelemetryClient#backfillMessages] Network error: ${fetchError}`)
				throw fetchError
			}
		} catch (error) {
			console.error(`[TelemetryClient#backfillMessages] Error uploading messages: ${error}`)
		}
	}

	/**
	 * Uploads the local image files the messages point to with `![alt](path)`
	 * (`POST /api/tasks/{taskId}/images`), so the cloud web view can show them
	 * (plan: 2026-10-12 cloud web task images). Relative paths are resolved
	 * against the task's workspace, as the CLI does when it draws them. Sent
	 * only where the messages themselves are sent; a file is sent once per
	 * message until it changes. Failures are logged and dropped, never retried
	 * here and never thrown.
	 */
	private async uploadTaskImages(taskId: string, messages: ClineMessage[]): Promise<void> {
		try {
			if (!this.isTelemetryEnabled() || !this.isEventCapturable(TelemetryEventName.TASK_MESSAGE)) {
				return
			}

			const workspacePath = this.providerRef?.deref()?.getTelemetryWorkspacePath?.()

			for (const message of messages) {
				if (message.partial === true || !message.text) {
					continue
				}

				for (const target of findLocalImageReferences(message.text)) {
					const image = await locateTaskImage(target, workspacePath)
					if (!image) {
						continue
					}

					const key = [taskId, message.ts, target, image.mtimeMs, image.size].join("|")
					if (this.sentTaskImages.has(key)) {
						continue
					}

					if (!this.authService.isAuthenticated()) {
						return
					}

					const token = this.authService.getSessionToken()
					if (!token) {
						console.error(`[TelemetryClient#uploadTaskImages] Unauthorized: No session token available.`)
						return
					}

					this.rememberTaskImage(key)
					const sent = await this.postTaskImage(token, taskId, message.ts, target, image.file, image.mime)
					if (!sent) {
						// A transient failure: a later send of this message may try again.
						this.sentTaskImages.delete(key)
					}
				}
			}
		} catch (error) {
			console.error(`[TelemetryClient#uploadTaskImages] Error uploading task images: ${error}`)
		}
	}

	private rememberTaskImage(key: string): void {
		this.sentTaskImages.add(key)
		if (this.sentTaskImages.size > MAX_REMEMBERED_TASK_IMAGES) {
			const oldest = this.sentTaskImages.values().next().value
			if (oldest !== undefined) {
				this.sentTaskImages.delete(oldest)
			}
		}
	}

	/**
	 * Posts one image. False when it may be worth sending again later: a network
	 * error, a server error, or 404 (the task row may not have landed yet).
	 * Any other refusal (413 too large, 415 not an image) is final.
	 */
	private async postTaskImage(
		token: string,
		taskId: string,
		messageTs: number,
		target: string,
		file: string,
		mime: string,
	): Promise<boolean> {
		const route = `tasks/${encodeURIComponent(taskId)}/images`

		try {
			const bytes = await readFile(file)
			const formData = new FormData()
			formData.append("messageTs", String(messageTs))
			formData.append("path", target)
			formData.append("file", new File([bytes], path.basename(file), { type: mime }))

			const response = await fetch(`${getTumbleCodeApiUrl()}/api/${route}`, {
				method: "POST",
				headers: { Authorization: `Bearer ${token}` },
				body: formData,
				signal: AbortSignal.timeout(30_000),
			})

			if (!response.ok) {
				console.error(
					`[TelemetryClient#uploadTaskImages] POST ${route} -> ${response.status} ${response.statusText}`,
				)
				return response.status < 500 && response.status !== 429 && response.status !== 404
			}

			return true
		} catch (error) {
			console.error(`[TelemetryClient#uploadTaskImages] Network error for POST ${route}: ${error}`)
			return false
		}
	}

	public override isTelemetryEnabled(): boolean {
		// ROO_CODE_DISABLE_TELEMETRY is the former name, still honoured.
		if (process.env.TUMBLE_CODE_DISABLE_TELEMETRY === "1" || process.env.ROO_CODE_DISABLE_TELEMETRY === "1") {
			return false
		}

		return true
	}

	protected override isEventCapturable(eventName: TelemetryEventName): boolean {
		// Ensure that this event type is supported by the telemetry client
		if (!super.isEventCapturable(eventName)) {
			return false
		}

		// Only record message telemetry if task sync is enabled
		if (eventName === TelemetryEventName.TASK_MESSAGE) {
			return this.settingsService.isTaskSyncEnabled()
		}

		// Other telemetry types are capturable at this point
		return true
	}

	public override async shutdown() {}
}
