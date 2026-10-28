import { z } from "zod"

import { type AuthService, type ShareVisibility, type ShareResponse, shareResponseSchema } from "@tumble-code/types"

import { getTumbleCodeApiUrl } from "./config.js"
import { getUserAgent } from "./utils.js"
import { AuthenticationError, CloudAPIError, NetworkError, TaskNotFoundError } from "./errors.js"

/** The folder a recall call names; the cloud resolves it to the project (design: cross-session recall, section 7). */
export interface RecallFolder {
	workspacePath: string
	/** The sanitized https remote from `getGitRepositoryInfo`; absent without git or a remote. */
	repositoryUrl?: string
}

const recallScopeSchema = z.enum(["none", "owner", "members", "organization"])

export type RecallScope = z.infer<typeof recallScopeSchema>

const recallContextSchema = z.object({
	projectId: z.string(),
	projectName: z.string(),
	scope: recallScopeSchema,
})

const recallSearchSchema = z.object({
	results: z.array(
		z.object({
			sessionId: z.string(),
			projectName: z.string(),
			author: z.string(),
			lastActivity: z.string(),
			title: z.string(),
			completed: z.boolean(),
			snippets: z.array(z.string()),
		}),
	),
	tooBroad: z.boolean(),
})

export type RecallSearchResponse = z.infer<typeof recallSearchSchema>

const recallSessionSchema = z.object({
	sessionId: z.string(),
	projectName: z.string(),
	author: z.string(),
	lastActivity: z.string(),
	title: z.string(),
	part: z.enum(["summary", "conversation"]),
	text: z.string(),
	nextOffset: z.number().nullable(),
})

export type RecallSession = z.infer<typeof recallSessionSchema>

export interface RecallSearchParams {
	query: string
	/** Absent means the cloud's default, `all`. */
	scope?: "this_project" | "all"
	limit?: number
	/** The asking task, left out of the hits. */
	excludeTaskId: string
}

export interface RecallSessionParams {
	part?: RecallSession["part"]
	offset?: number
}

/** The query string of a recall call: the folder, then the call's own parameters that are set. */
function recallQuery(folder: RecallFolder, params: Record<string, string | number | undefined> = {}): string {
	const query = new URLSearchParams({ workspacePath: folder.workspacePath })
	for (const [key, value] of Object.entries({ repositoryUrl: folder.repositoryUrl, ...params })) {
		if (value !== undefined) {
			query.set(key, String(value))
		}
	}
	return query.toString()
}

/** The context lookup gates the tool list of a model request, so it may not hold one up for long. */
const RECALL_CONTEXT_TIMEOUT_MS = 5_000

interface CloudAPIRequestOptions extends Omit<RequestInit, "headers"> {
	timeout?: number
	headers?: Record<string, string>
}

export class CloudAPI {
	private authService: AuthService
	private log: (...args: unknown[]) => void
	private baseUrl: string

	constructor(authService: AuthService, log?: (...args: unknown[]) => void) {
		this.authService = authService
		this.log = log || console.log
		this.baseUrl = getTumbleCodeApiUrl()
	}

	private async request<T>(
		endpoint: string,
		options: CloudAPIRequestOptions & {
			parseResponse?: (data: unknown) => T
		} = {},
	): Promise<T> {
		const { timeout = 30_000, parseResponse, headers = {}, ...fetchOptions } = options

		const sessionToken = this.authService.getSessionToken()

		if (!sessionToken) {
			throw new AuthenticationError()
		}

		const url = `${this.baseUrl}${endpoint}`

		const requestHeaders = {
			"Content-Type": "application/json",
			Authorization: `Bearer ${sessionToken}`,
			"User-Agent": getUserAgent(),
			...headers,
		}

		try {
			const response = await fetch(url, {
				...fetchOptions,
				headers: requestHeaders,
				signal: AbortSignal.timeout(timeout),
			})

			if (!response.ok) {
				await this.handleErrorResponse(response, endpoint)
			}

			const data = await response.json()

			if (parseResponse) {
				return parseResponse(data)
			}

			return data as T
		} catch (error) {
			if (error instanceof TypeError && error.message.includes("fetch")) {
				throw new NetworkError(`Network error while calling ${endpoint}`)
			}

			if (error instanceof CloudAPIError) {
				throw error
			}

			if (error instanceof Error && error.name === "AbortError") {
				throw new CloudAPIError(`Request to ${endpoint} timed out`, undefined, undefined)
			}

			throw new CloudAPIError(
				`Unexpected error while calling ${endpoint}: ${error instanceof Error ? error.message : String(error)}`,
			)
		}
	}

	private async handleErrorResponse(response: Response, endpoint: string): Promise<never> {
		let responseBody: unknown

		try {
			responseBody = await response.json()
		} catch {
			responseBody = await response.text()
		}

		switch (response.status) {
			case 401:
				throw new AuthenticationError()
			case 404:
				if (endpoint.includes("/share")) {
					throw new TaskNotFoundError()
				}
				throw new CloudAPIError(`Resource not found: ${endpoint}`, 404, responseBody)
			default:
				throw new CloudAPIError(
					`HTTP ${response.status}: ${response.statusText}`,
					response.status,
					responseBody,
				)
		}
	}

	async shareTask(taskId: string, visibility: ShareVisibility = "organization"): Promise<ShareResponse> {
		this.log(`[CloudAPI] Sharing task ${taskId} with visibility: ${visibility}`)

		const response = await this.request("/api/extension/share", {
			method: "POST",
			body: JSON.stringify({ taskId, visibility }),
			parseResponse: (data) => shareResponseSchema.parse(data),
		})

		this.log("[CloudAPI] Share response:", response)
		return response
	}

	async bridgeConfig() {
		return this.request("/api/extension/bridge/config", {
			method: "GET",
			parseResponse: (data) =>
				z
					.object({
						userId: z.string(),
						socketBridgeUrl: z.string(),
						socketBridgePath: z.string().optional(),
						token: z.string(),
					})
					.parse(data),
		})
	}

	/** The project of a folder and its recall scope; the cloud creates the project when it is new. */
	async recallContext(folder: RecallFolder) {
		return this.request(`/api/recall/context?${recallQuery(folder)}`, {
			method: "GET",
			timeout: RECALL_CONTEXT_TIMEOUT_MS,
			parseResponse: (data) => recallContextSchema.parse(data),
		})
	}

	async recallSearch(folder: RecallFolder, params: RecallSearchParams): Promise<RecallSearchResponse> {
		const { query, ...rest } = params
		return this.request(`/api/recall/search?${recallQuery(folder, { q: query, ...rest })}`, {
			method: "GET",
			parseResponse: (data) => recallSearchSchema.parse(data),
		})
	}

	async recallSession(folder: RecallFolder, sessionId: string, params: RecallSessionParams): Promise<RecallSession> {
		return this.request(
			`/api/recall/sessions/${encodeURIComponent(sessionId)}?${recallQuery(folder, { ...params })}`,
			{
				method: "GET",
				parseResponse: (data) => recallSessionSchema.parse(data),
			},
		)
	}
}
