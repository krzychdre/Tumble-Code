import type {
	TelemetryCaptureArgs,
	TelemetryClient,
	TelemetryEventName,
	TelemetryPropertiesProvider,
} from "@roo-code/types"

/**
 * TelemetryService wrapper class that defers initialization.
 * This ensures that we only create the various clients after environment
 * variables are loaded.
 */
export class TelemetryService {
	constructor(private clients: TelemetryClient[]) {}

	public register(client: TelemetryClient): void {
		this.clients.push(client)
	}

	/**
	 * Sets the ClineProvider reference to use for global properties
	 * @param provider A ClineProvider instance to use
	 */
	public setProvider(provider: TelemetryPropertiesProvider): void {
		// If client is initialized, pass the provider reference.
		if (this.isReady) {
			this.clients.forEach((client) => client.setProvider(provider))
		}
	}

	/**
	 * Base method for all telemetry operations
	 * Checks if the service is initialized before performing any operation
	 * @returns Whether the service is ready to use
	 */
	private get isReady(): boolean {
		return this.clients.length > 0
	}

	/**
	 * Updates the telemetry state based on user preferences and VSCode settings
	 * @param isOptedIn Whether the user is opted into telemetry
	 */
	public updateTelemetryState(isOptedIn: boolean): void {
		if (!this.isReady) {
			return
		}

		this.clients.forEach((client) => client.updateTelemetryState(isOptedIn))
	}

	/**
	 * Generic method to capture any type of event with specified properties
	 * @param eventName The event name to capture
	 * @param properties The event properties
	 */
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	public captureEvent(eventName: TelemetryEventName, properties?: Record<string, any>): void {
		if (!this.isReady) {
			return
		}

		this.clients.forEach((client) => client.capture({ event: eventName, properties }))
	}

	/**
	 * Captures an event with properties typed per event.
	 *
	 * Events listed in `TelemetryEventPayloads` (in @roo-code/types) require
	 * their properties; any other event takes an optional free-form record.
	 * The properties are forwarded to every client unchanged.
	 *
	 * @example
	 * TelemetryService.instance.capture(TelemetryEventName.TOOL_USED, { taskId, tool: "read_file" })
	 */
	public capture<E extends TelemetryEventName>(event: E, ...[properties]: TelemetryCaptureArgs<E>): void {
		this.captureEvent(event, properties)
	}

	/**
	 * Captures an exception using PostHog's error tracking
	 * @param error The error to capture
	 * @param additionalProperties Additional properties to include with the exception
	 */
	public captureException(error: Error, additionalProperties?: Record<string, unknown>): void {
		if (!this.isReady) {
			return
		}

		this.clients.forEach((client) => client.captureException(error, additionalProperties))
	}

	/**
	 * Checks if telemetry is currently enabled
	 * @returns Whether telemetry is enabled
	 */
	public isTelemetryEnabled(): boolean {
		return this.isReady && this.clients.some((client) => client.isTelemetryEnabled())
	}

	public async shutdown(): Promise<void> {
		if (!this.isReady) {
			return
		}

		this.clients.forEach((client) => client.shutdown())
	}

	private static _instance: TelemetryService | null = null

	static createInstance(clients: TelemetryClient[] = []) {
		if (this._instance) {
			throw new Error("TelemetryService instance already created")
		}

		this._instance = new TelemetryService(clients)
		return this._instance
	}

	static get instance() {
		if (!this._instance) {
			throw new Error("TelemetryService not initialized")
		}

		return this._instance
	}

	static hasInstance(): boolean {
		return this._instance !== null
	}

	/**
	 * Drops the singleton so the next `createInstance` starts fresh. For tests only.
	 */
	static resetInstance(): void {
		this._instance = null
	}
}
