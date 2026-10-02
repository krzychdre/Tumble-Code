import axios from "axios"
import * as yaml from "yaml"
import { z } from "zod"

import {
	type MarketplaceItem,
	type MarketplaceItemType,
	modeMarketplaceItemSchema,
	mcpMarketplaceItemSchema,
} from "@tumble-code/types"
import { backoffDelayMsNoJitter } from "@tumble-code/core"
import { logger } from "../../utils/logging"

// The marketplace lives in the public GitHub repo, one YAML file per item:
// marketplace/modes/<id>.yaml and marketplace/mcps/<id>.yaml.
const MARKETPLACE_REPO_OWNER = "krzychdre"
const MARKETPLACE_REPO_NAME = "Tumble-Code"
const MARKETPLACE_REPO_BRANCH = "main"
const MARKETPLACE_REPO_PATH = "marketplace"

// The folder listing goes through the GitHub contents API, which allows 60
// unauthenticated requests per hour per IP. With the 5-minute cache below that
// is at most 2 listing calls (modes + MCPs) per 5 minutes. The item files
// themselves come from raw.githubusercontent.com, which is not counted
// against that limit.
const GITHUB_API_URL = "https://api.github.com"

const REQUEST_TIMEOUT_MS = 10_000

const githubContentsEntrySchema = z.object({
	name: z.string(),
	type: z.string(),
	download_url: z.string().nullable().optional(),
})

const githubContentsListingSchema = z.array(githubContentsEntrySchema)

type ItemFile = { name: string; downloadUrl: string }

export class RemoteConfigLoader {
	private cache: Map<string, { data: MarketplaceItem[]; timestamp: number }> = new Map()
	private cacheDuration = 5 * 60 * 1000 // 5 minutes

	async loadAllItems(hideMarketplaceMcps = false): Promise<MarketplaceItem[]> {
		const items: MarketplaceItem[] = []

		const modesPromise = this.fetchItems("mode")
		const mcpsPromise = hideMarketplaceMcps ? Promise.resolve([]) : this.fetchItems("mcp")

		const [modes, mcps] = await Promise.all([modesPromise, mcpsPromise])

		items.push(...modes, ...mcps)
		return items
	}

	private async fetchItems(type: MarketplaceItemType): Promise<MarketplaceItem[]> {
		const cacheKey = `${type}s`
		const cached = this.getFromCache(cacheKey)

		if (cached) {
			return cached
		}

		const files = await this.listItemFiles(`${type}s`)

		// Fetch every item file in parallel. A file that cannot be fetched, parsed
		// or validated is skipped, so one broken contribution does not empty the
		// whole marketplace.
		let complete = true
		const results = await Promise.all(
			files.map(async (file) => {
				try {
					const raw = await this.fetchWithRetry<unknown>(file.downloadUrl, { responseType: "text" })
					return this.parseItem(type, file.name, raw)
				} catch (error) {
					complete = false
					logger.warn(`[Marketplace] Failed to fetch ${type} file ${file.name}:`, error)
					return null
				}
			}),
		)

		const items = results.filter((item): item is MarketplaceItem => item !== null)

		// A network failure on a single file should not be pinned for 5 minutes.
		if (complete) {
			this.setCache(cacheKey, items)
		}

		return items
	}

	/**
	 * Lists the YAML files in marketplace/<folder> on the configured branch.
	 * A missing folder (404) is an empty marketplace section, not an error.
	 */
	private async listItemFiles(folder: string): Promise<ItemFile[]> {
		const url =
			`${GITHUB_API_URL}/repos/${MARKETPLACE_REPO_OWNER}/${MARKETPLACE_REPO_NAME}` +
			`/contents/${MARKETPLACE_REPO_PATH}/${folder}?ref=${MARKETPLACE_REPO_BRANCH}`

		let data: unknown
		try {
			data = await this.fetchWithRetry<unknown>(url, {
				headers: { Accept: "application/vnd.github+json" },
			})
		} catch (error) {
			if (isNotFound(error)) {
				return []
			}
			throw error
		}

		const listing = githubContentsListingSchema.parse(data)

		return listing
			.filter((entry) => entry.type === "file" && /\.ya?ml$/i.test(entry.name) && !!entry.download_url)
			.map((entry) => ({ name: entry.name, downloadUrl: entry.download_url! }))
	}

	private parseItem(type: MarketplaceItemType, fileName: string, raw: unknown): MarketplaceItem | null {
		let parsed: unknown
		try {
			parsed = typeof raw === "string" ? yaml.parse(raw) : raw
		} catch (error) {
			logger.warn(`[Marketplace] Skipping ${type} file ${fileName}: invalid YAML:`, error)
			return null
		}

		if (type === "mode") {
			const result = modeMarketplaceItemSchema.safeParse(parsed)
			if (!result.success) {
				logger.warn(`[Marketplace] Skipping ${type} file ${fileName}: ${formatIssues(result.error)}`)
				return null
			}
			return { type: "mode", ...result.data }
		}

		const result = mcpMarketplaceItemSchema.safeParse(parsed)
		if (!result.success) {
			logger.warn(`[Marketplace] Skipping ${type} file ${fileName}: ${formatIssues(result.error)}`)
			return null
		}
		return { type: "mcp", ...result.data }
	}

	private async fetchWithRetry<T>(
		url: string,
		options: { headers?: Record<string, string>; responseType?: "text" } = {},
		maxRetries = 3,
	): Promise<T> {
		let lastError: Error

		for (let i = 0; i < maxRetries; i++) {
			try {
				const response = await axios.get(url, {
					timeout: REQUEST_TIMEOUT_MS,
					...options,
				})
				return response.data as T
			} catch (error) {
				lastError = error as Error
				// A 404 will not change on retry.
				if (isNotFound(error)) {
					throw error
				}
				if (i < maxRetries - 1) {
					// Exponential backoff: 1s, 2s, 4s
					const delay = backoffDelayMsNoJitter(i, { baseMs: 1_000, capMs: 4_000 })
					await new Promise((resolve) => setTimeout(resolve, delay))
				}
			}
		}

		throw lastError!
	}

	async getItem(id: string, type: MarketplaceItemType): Promise<MarketplaceItem | null> {
		const items = await this.loadAllItems()
		return items.find((item) => item.id === id && item.type === type) || null
	}

	private getFromCache(key: string): MarketplaceItem[] | null {
		const cached = this.cache.get(key)
		if (!cached) return null

		const now = Date.now()
		if (now - cached.timestamp > this.cacheDuration) {
			this.cache.delete(key)
			return null
		}

		return cached.data
	}

	private setCache(key: string, data: MarketplaceItem[]): void {
		this.cache.set(key, {
			data,
			timestamp: Date.now(),
		})
	}

	clearCache(): void {
		this.cache.clear()
	}
}

function isNotFound(error: unknown): boolean {
	return (error as { response?: { status?: number } } | undefined)?.response?.status === 404
}

function formatIssues(error: z.ZodError): string {
	return error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; ")
}
