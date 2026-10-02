import { promisify } from "util"
import { gzip as gzipCallback } from "zlib"

import {
	type AuthService,
	type LlmExchange,
	type LlmExchangeOutcome,
	LLM_EXCHANGE_MAX_COMPRESSED_BYTES,
	llmExchangeOutcomeSchema,
	llmExchangeSchema,
} from "@tumble-code/types"

import { getTumbleCodeApiUrl } from "./config.js"

const gzip = promisify(gzipCallback)

/** How long the recording switch read from the cloud is trusted. */
const RECORDING_FLAG_TTL_MS = 5 * 60_000
/** After a failed read of the switch, how long "off" is assumed before asking again. */
const RECORDING_FLAG_FAILURE_TTL_MS = 60_000
/** Waits before the second and third attempt of an upload. */
const RETRY_DELAYS_MS = [2_000, 8_000]
const REQUEST_TIMEOUT_MS = 60_000

interface RecordingFlag {
	token: string
	enabled: boolean
	expiresAt: number
}

interface ClientOptions {
	sleep?: (ms: number) => Promise<void>
	now?: () => number
}

/**
 * The cloud side of LLM exchange recording (the training dataset): whether the
 * signed-in user switched recording on (`GET /api/llm-exchanges/config`), and the
 * uploads of exchanges and their outcomes.
 *
 * Uploads do not use the persistent RetryQueue: it keeps request bodies in
 * workspace state, and a full snapshot of a long conversation is megabytes. A
 * failed upload is retried twice in memory and then reported as failed; the
 * recorder answers that by starting its delta chain again with a full snapshot,
 * so nothing the server lacks is ever referenced.
 */
export class LlmExchangeClient {
	private flag: RecordingFlag | undefined
	private pendingFlag: Promise<boolean> | undefined
	private readonly sleep: (ms: number) => Promise<void>
	private readonly now: () => number

	constructor(
		private readonly authService: AuthService,
		private readonly log: (...args: unknown[]) => void = () => {},
		options: ClientOptions = {},
	) {
		this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
		this.now = options.now ?? Date.now
	}

	private sessionToken(): string | undefined {
		if (!this.authService.isAuthenticated()) {
			return undefined
		}
		return this.authService.getSessionToken() || undefined
	}

	/**
	 * The recording switch as last read for the current session: true, false, or
	 * undefined when it was never read for this session or the reading is stale.
	 * Never throws and never fetches.
	 */
	public getRecordingState(): boolean | undefined {
		const token = this.sessionToken()
		if (!token || !this.flag || this.flag.token !== token || this.flag.expiresAt <= this.now()) {
			return token ? undefined : false
		}
		return this.flag.enabled
	}

	/** The recording switch, read from the cloud when not known or stale. False when signed out. */
	public async resolveRecordingEnabled(): Promise<boolean> {
		const known = this.getRecordingState()
		if (known !== undefined) {
			return known
		}
		if (!this.pendingFlag) {
			this.pendingFlag = this.fetchRecordingFlag().finally(() => {
				this.pendingFlag = undefined
			})
		}
		return this.pendingFlag
	}

	private async fetchRecordingFlag(): Promise<boolean> {
		const token = this.sessionToken()
		if (!token) {
			return false
		}
		let enabled = false
		let ttl = RECORDING_FLAG_FAILURE_TTL_MS
		try {
			const response = await fetch(`${getTumbleCodeApiUrl()}/api/llm-exchanges/config`, {
				method: "GET",
				headers: { Authorization: `Bearer ${token}` },
				signal: AbortSignal.timeout(30_000),
			})
			if (response.ok) {
				const body = (await response.json()) as { enabled?: unknown }
				enabled = body?.enabled === true
				ttl = RECORDING_FLAG_TTL_MS
			} else {
				this.log(`[LlmExchangeClient] recording config -> ${response.status}`)
			}
		} catch (error) {
			this.log(`[LlmExchangeClient] recording config failed: ${error}`)
		}
		this.flag = { token, enabled, expiresAt: this.now() + ttl }
		return enabled
	}

	/** Upload one exchange. True when the server took it (stored, or recording off there). */
	public async sendExchange(exchange: LlmExchange): Promise<boolean> {
		const parsed = llmExchangeSchema.safeParse(exchange)
		if (!parsed.success) {
			this.log(`[LlmExchangeClient] invalid exchange: ${parsed.error.message}`)
			return false
		}
		return this.post("llm-exchanges", parsed.data)
	}

	/** Upload what happened to the tool calls of an exchange. */
	public async sendOutcome(outcome: LlmExchangeOutcome): Promise<boolean> {
		const parsed = llmExchangeOutcomeSchema.safeParse(outcome)
		if (!parsed.success) {
			this.log(`[LlmExchangeClient] invalid outcome: ${parsed.error.message}`)
			return false
		}
		return this.post("llm-exchanges/outcome", parsed.data)
	}

	private async post(path: string, payload: unknown): Promise<boolean> {
		const body = await gzip(Buffer.from(JSON.stringify(payload), "utf8"))
		if (body.byteLength > LLM_EXCHANGE_MAX_COMPRESSED_BYTES) {
			this.log(`[LlmExchangeClient] ${path}: ${body.byteLength} bytes compressed, above the server's limit`)
			return false
		}

		for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
			if (attempt > 0) {
				await this.sleep(RETRY_DELAYS_MS[attempt - 1]!)
			}
			// Read per attempt: a sign-out during the backoff stops the upload.
			const token = this.sessionToken()
			if (!token) {
				return false
			}
			try {
				const response = await fetch(`${getTumbleCodeApiUrl()}/api/${path}`, {
					method: "POST",
					headers: {
						Authorization: `Bearer ${token}`,
						"Content-Type": "application/json",
						"Content-Encoding": "gzip",
					},
					body,
					signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
				})
				if (response.ok) {
					await this.noteServerFlag(token, response)
					return true
				}
				this.log(`[LlmExchangeClient] POST ${path} -> ${response.status}`)
				// A client error will not succeed on a retry; only 5xx and 429 are retried.
				if (response.status < 500 && response.status !== 429) {
					return false
				}
			} catch (error) {
				this.log(`[LlmExchangeClient] POST ${path} failed: ${error}`)
			}
		}
		return false
	}

	/** The server answers `recording: false` when the switch was turned off since it was read. */
	private async noteServerFlag(token: string, response: Response): Promise<void> {
		try {
			const body = (await response.json()) as { recording?: unknown }
			if (typeof body?.recording === "boolean") {
				this.flag = { token, enabled: body.recording, expiresAt: this.now() + RECORDING_FLAG_TTL_MS }
			}
		} catch {
			// No JSON answer: keep the cached flag.
		}
	}
}
