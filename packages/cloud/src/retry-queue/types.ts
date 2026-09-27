/**
 * Where the retry queue keeps its requests between sessions. VS Code's
 * `Memento` (for example `ExtensionContext.workspaceState`) satisfies it
 * as is; tests and non-VS Code hosts can pass a plain in-memory object.
 */
export interface RetryQueueStorage {
	get<T>(key: string): T | undefined
	update(key: string, value: unknown): PromiseLike<void>
}

export interface QueuedRequest {
	id: string
	url: string
	options: RequestInit
	timestamp: number
	retryCount: number
	type: "api-call" | "telemetry" | "settings" | "other"
	operation?: string
	lastError?: string
	/**
	 * Earliest wall-clock time (Date.now()) this request may be retried again.
	 * Each request backs off on its own failures (R11), so one failing request
	 * never delays the others. Absent on fresh requests (retry immediately).
	 */
	nextAttemptAt?: number
}

export interface QueueStats {
	totalQueued: number
	byType: Record<string, number>
	oldestRequest?: Date
	newestRequest?: Date
	totalRetries: number
	failedRetries: number
}

export interface RetryQueueConfig {
	maxRetries: number // 0 means unlimited; default is 5
	/** Base delay for the per-request backoff after a failure (with equal jitter). */
	retryDelay: number
	/** Cap for the per-request backoff delay. */
	retryDelayMaxMs: number
	maxQueueSize: number // FIFO eviction when full
	persistQueue: boolean
	networkCheckInterval: number // milliseconds
	requestTimeout: number // milliseconds for request timeout
	/** Random source in [0, 1) for the jitter; injectable for deterministic tests. */
	random?: () => number
}

export interface RetryQueueEvents {
	"request-queued": [request: QueuedRequest]
	"request-retry-success": [request: QueuedRequest]
	"request-retry-failed": [request: QueuedRequest, error: Error]
	"request-max-retries-exceeded": [request: QueuedRequest, error: Error]
	"queue-cleared": []
}
