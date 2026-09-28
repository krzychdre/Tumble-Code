import * as path from "path"
import * as fs from "fs"

import NodeCache from "node-cache"
import { z } from "zod"

import type { ProviderName, ModelRecord } from "@roo-code/types"
import { modelInfoSchema, TelemetryEventName } from "@roo-code/types"
import { TelemetryService } from "@roo-code/telemetry"

import { safeWriteJson } from "@roo-code/core/fs"
import { ContextProxy } from "../../../core/config/ContextProxy"
import { getCacheDirectoryPath } from "../../../utils/storage"
import type { GetModelsOptions } from "../../../shared/api"

import { getOpenRouterModels } from "./openrouter"
import { getLiteLLMModels } from "./litellm"
import { getOllamaModels } from "./ollama"
import { getLMStudioModels } from "./lmstudio"
import { getDeepSeekModels } from "./deepseek"

const memoryCache = new NodeCache({ stdTTL: 5 * 60, checkperiod: 5 * 60 })

// Zod schema for validating ModelRecord structure from disk cache
const modelRecordSchema = z.record(z.string(), modelInfoSchema)

// Track in-flight refresh requests to prevent concurrent API calls for the same provider
// This prevents race conditions where multiple calls might overwrite each other's results
type CacheableModelSourceId = GetModelsOptions["provider"]

const inFlightRefresh = new Map<CacheableModelSourceId, Promise<ModelRecord>>()

/**
 * How long a disk-cache lookup (hit or miss) is trusted before the file is
 * looked at again. Matches the memory cache TTL.
 */
const DISK_RECHECK_MS = 5 * 60 * 1000

/**
 * What this process last saw in (or wrote to) each provider's disk cache file:
 * the models, or `null` when there was no valid file. `getModelsFromCache` is
 * synchronous (it backs `getModel()`, which runs on every API request), so
 * after the first lookup it answers from here and revalidates the file in the
 * background instead of reading or stat-ing it on the event loop. Without this
 * mirror every memory expiry, and EVERY call for a provider with no cache file,
 * went to the disk synchronously.
 */
const diskMirror = new Map<ProviderName, { models: ModelRecord | null; checkedAt: number }>()

const inFlightDiskReads = new Map<ProviderName, Promise<ModelRecord | undefined>>()

function rememberDiskState(provider: ProviderName, models: ModelRecord | null): void {
	diskMirror.set(provider, { models, checkedAt: Date.now() })
}

/**
 * Parses and validates a disk cache file; `undefined` when it is not a valid
 * ModelRecord.
 */
function parseDiskModels(provider: ProviderName, data: string): ModelRecord | undefined {
	// Validate the disk cache data structure using Zod schema
	// This ensures the data conforms to ModelRecord = Record<string, ModelInfo>
	const validation = modelRecordSchema.safeParse(JSON.parse(data))
	if (!validation.success) {
		console.error(`[MODEL_CACHE] Invalid disk cache data structure for ${provider}:`, validation.error.format())
		return undefined
	}
	return validation.data
}

/**
 * Reads a provider's disk cache without blocking the event loop, refreshing
 * the mirror and, on a hit, the memory cache. Concurrent calls share one read.
 */
function readModelsFromDisk(provider: ProviderName): Promise<ModelRecord | undefined> {
	const existing = inFlightDiskReads.get(provider)
	if (existing) {
		return existing
	}

	const read = (async (): Promise<ModelRecord | undefined> => {
		try {
			const cacheDir = await getCacheDirectoryPath(ContextProxy.instance.globalStorageUri.fsPath)
			const data = await fs.promises.readFile(path.join(cacheDir, `${provider}_models.json`), "utf8")
			const models = parseDiskModels(provider, data)
			rememberDiskState(provider, models ?? null)
			if (models) {
				memoryCache.set(provider, models)
			}
			return models
		} catch (error) {
			if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
				console.error(`[MODEL_CACHE] Error loading ${provider} models from disk:`, error)
			}
			rememberDiskState(provider, null)
			return undefined
		} finally {
			inFlightDiskReads.delete(provider)
		}
	})()

	inFlightDiskReads.set(provider, read)
	return read
}

/** Forgets what this process saw on disk, so each spec starts cold. */
export function resetModelCacheForTests(): void {
	diskMirror.clear()
	inFlightDiskReads.clear()
}

async function writeModels(router: CacheableModelSourceId, data: ModelRecord) {
	const filename = `${router}_models.json`
	const cacheDir = await getCacheDirectoryPath(ContextProxy.instance.globalStorageUri.fsPath)
	await safeWriteJson(path.join(cacheDir, filename), data)
	rememberDiskState(router, data)
}

/**
 * Fetch models from the provider API.
 * Extracted to avoid duplication between getModels() and refreshModels().
 *
 * @param options - Provider options for fetching models
 * @returns Fresh models from the provider API
 */
async function fetchModelsFromProvider(options: GetModelsOptions): Promise<ModelRecord> {
	const { provider } = options

	let models: ModelRecord

	switch (provider) {
		case "openrouter":
			models = await getOpenRouterModels()
			break
		case "litellm":
			// Type safety ensures apiKey and baseUrl are always provided for LiteLLM.
			models = await getLiteLLMModels(options.apiKey, options.baseUrl)
			break
		case "ollama":
			models = await getOllamaModels(options.baseUrl, options.apiKey)
			break
		case "lmstudio":
			models = await getLMStudioModels(options.baseUrl)
			break
		case "deepseek":
			models = await getDeepSeekModels(options.baseUrl, options.apiKey)
			break
		default: {
			// Ensures model source handling is exhaustive.
			const exhaustiveCheck: never = provider
			throw new Error(`Unknown provider: ${exhaustiveCheck}`)
		}
	}

	return models
}

/**
 * Get models from the cache or fetch them from the provider and cache them.
 * There are two caches:
 * 1. Memory cache - This is a simple in-memory cache that is used to store models for a short period of time.
 * 2. File cache - This is a file-based cache that is used to store models for a longer period of time.
 *
 * @param router - The router to fetch models from.
 * @param apiKey - Optional API key for the provider.
 * @param baseUrl - Optional base URL for the provider (currently used only for LiteLLM).
 * @returns The models from the cache or the fetched models.
 */
export const getModels = async (options: GetModelsOptions): Promise<ModelRecord> => {
	const { provider } = options

	// Memory first, then the disk cache, read asynchronously: this path may
	// await, so it never needs the synchronous cold read.
	let models = memoryCache.get<ModelRecord>(provider) ?? (await readModelsFromDisk(provider))

	if (models) {
		return models
	}

	try {
		models = await fetchModelsFromProvider(options)
		const modelCount = Object.keys(models).length

		// Only cache non-empty results to prevent persisting failed API responses
		// Empty results could indicate API failure rather than "no models exist"
		if (modelCount > 0) {
			memoryCache.set(provider, models)

			await writeModels(provider, models).catch((err) =>
				console.error(`[MODEL_CACHE] Error writing ${provider} models to file cache:`, err),
			)
		} else {
			TelemetryService.instance.captureEvent(TelemetryEventName.MODEL_CACHE_EMPTY_RESPONSE, {
				provider,
				context: "getModels",
				hasExistingCache: false,
			})
		}

		return models
	} catch (error) {
		// Log the error and re-throw it so the caller can handle it (e.g., show a UI message).
		console.error(`[getModels] Failed to fetch models in modelCache for ${provider}:`, error)

		throw error // Re-throw the original error to be handled by the caller.
	}
}

/**
 * Force-refresh models from API, bypassing cache.
 * Uses atomic writes so cache remains available during refresh.
 * This function also prevents concurrent API calls for the same provider using
 * in-flight request tracking to avoid race conditions.
 *
 * @param options - Provider options for fetching models
 * @returns Fresh models from API, or existing cache if refresh yields worse data
 */
export const refreshModels = async (options: GetModelsOptions): Promise<ModelRecord> => {
	const { provider } = options

	// Check if there's already an in-flight refresh for this provider
	// This prevents race conditions where multiple concurrent refreshes might
	// overwrite each other's results
	const existingRequest = inFlightRefresh.get(provider)
	if (existingRequest) {
		return existingRequest
	}

	// Create the refresh promise and track it
	const refreshPromise = (async (): Promise<ModelRecord> => {
		try {
			// Force fresh API fetch - skip getModelsFromCache() check
			const models = await fetchModelsFromProvider(options)
			const modelCount = Object.keys(models).length

			// Get existing cached data for comparison
			const existingCache = getModelsFromCache(provider)
			const existingCount = existingCache ? Object.keys(existingCache).length : 0

			if (modelCount === 0) {
				TelemetryService.instance.captureEvent(TelemetryEventName.MODEL_CACHE_EMPTY_RESPONSE, {
					provider,
					context: "refreshModels",
					hasExistingCache: existingCount > 0,
					existingCacheSize: existingCount,
				})
				if (existingCount > 0) {
					return existingCache!
				} else {
					return {}
				}
			}

			// Update memory cache first
			memoryCache.set(provider, models)

			// Atomically write to disk (safeWriteJson handles atomic writes)
			await writeModels(provider, models).catch((err) =>
				console.error(`[refreshModels] Error writing ${provider} models to disk:`, err),
			)

			return models
		} catch (error) {
			// Log the error for debugging, then return existing cache if available (graceful degradation)
			console.error(`[refreshModels] Failed to refresh ${provider} models:`, error)
			return getModelsFromCache(provider) || {}
		} finally {
			// Always clean up the in-flight tracking
			inFlightRefresh.delete(provider)
		}
	})()

	// Track the in-flight request
	inFlightRefresh.set(provider, refreshPromise)

	return refreshPromise
}

/**
 * Flush models memory cache for a specific router.
 *
 * @param options - The options for fetching models, including provider, apiKey, and baseUrl
 * @param refresh - If true, immediately fetch fresh data from API
 */
export const flushModels = async (options: GetModelsOptions, refresh: boolean = false): Promise<void> => {
	const { provider } = options
	if (refresh) {
		// Don't delete memory cache - let refreshModels atomically replace it
		// This prevents a race condition where getModels() might be called
		// before refresh completes, avoiding a gap in cache availability
		// Await the refresh to ensure the cache is updated before returning
		await refreshModels(options)
	} else {
		// Only delete memory cache when not refreshing
		memoryCache.del(provider)
	}
}

/**
 * Get models from cache, checking memory first, then disk.
 * This ensures providers always have access to last known good data,
 * preventing fallback to hardcoded defaults on startup.
 *
 * Synchronous because `getModel()` is. Only the very first lookup of a
 * provider in this process reads the disk synchronously (a cold start must not
 * fall back to default model info); every later one answers from the disk
 * mirror and, once the mirror is older than `DISK_RECHECK_MS`, revalidates the
 * file in the background.
 *
 * @param provider - The provider to get models for.
 * @returns Models from memory cache, disk cache, or undefined if not cached.
 */
export function getModelsFromCache(provider: ProviderName): ModelRecord | undefined {
	// Check memory cache first (fast)
	const memoryModels = memoryCache.get<ModelRecord>(provider)
	if (memoryModels) {
		return memoryModels
	}

	const mirrored = diskMirror.get(provider)
	if (mirrored) {
		if (Date.now() - mirrored.checkedAt >= DISK_RECHECK_MS) {
			void readModelsFromDisk(provider)
		}
		if (mirrored.models) {
			memoryCache.set(provider, mirrored.models)
		}
		return mirrored.models ?? undefined
	}

	// Cold start: the one synchronous read per provider per process.
	try {
		const filename = `${provider}_models.json`
		const cacheDir = getCacheDirectoryPathSync()
		if (!cacheDir) {
			return undefined
		}

		const filePath = path.join(cacheDir, filename)

		if (!fs.existsSync(filePath)) {
			rememberDiskState(provider, null)
			return undefined
		}

		const models = parseDiskModels(provider, fs.readFileSync(filePath, "utf8"))
		rememberDiskState(provider, models ?? null)

		if (models) {
			// Populate memory cache for future fast access
			memoryCache.set(provider, models)
		}

		return models
	} catch (error) {
		console.error(`[MODEL_CACHE] Error loading ${provider} models from disk:`, error)
		rememberDiskState(provider, null)
	}

	return undefined
}

/**
 * Synchronous version of getCacheDirectoryPath for use in getModelsFromCache.
 * Returns the cache directory path without async operations.
 */
function getCacheDirectoryPathSync(): string | undefined {
	try {
		const globalStoragePath = ContextProxy.instance?.globalStorageUri?.fsPath
		if (!globalStoragePath) {
			return undefined
		}
		const cachePath = path.join(globalStoragePath, "cache")
		return cachePath
	} catch (error) {
		console.error(`[MODEL_CACHE] Error getting cache directory path:`, error)
		return undefined
	}
}
