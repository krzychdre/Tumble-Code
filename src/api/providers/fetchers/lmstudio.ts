import axios from "axios"
import { LLM, LLMInfo, LLMInstanceInfo, LMStudioClient } from "@lmstudio/sdk"

import { type ModelInfo, lMStudioDefaultModelInfo } from "@roo-code/types"

import { flushModels } from "./modelCache"

const modelsWithLoadedDetails = new Set<string>()

/**
 * Bounds for the LM Studio calls. @lmstudio/sdk has no timeout of its own, and when an
 * answer fails its validation (an LM Studio older than the SDK's protocol) it logs a
 * console warning and never settles the call. Without a bound the model list never
 * returns and the preload before a task keeps the task from starting.
 */
export const LM_STUDIO_TIMEOUTS = {
	/**
	 * Reaching the server and listing or describing models. A local or LAN LM Studio
	 * answers these in milliseconds (they read its in-memory model index), so 10 s is
	 * ample headroom while still short enough to be noticed.
	 */
	requestMs: 10_000,
	/**
	 * Loading a model: the longest wait for the next sign of life (the first answer, then
	 * each progress report). A big model can take minutes to load, so the load itself has
	 * no total limit: LM Studio reports progress all along, and only silence ends it.
	 */
	loadIdleMs: 60_000,
}

class LmStudioTimeoutError extends Error {
	constructor(baseUrl: string, what: string, ms: number) {
		super(
			`LM Studio at ${baseUrl} did not answer ${what} within ${ms / 1000} s. ` +
				"Check that LM Studio is running and up to date: an LM Studio version that the extension's " +
				"LM Studio SDK does not understand never answers.",
		)
		this.name = "LmStudioTimeoutError"
	}
}

/** `promise`, or a timeout error after `ms` (the promise keeps running; the caller closes the client). */
function withTimeout<T>(promise: Promise<T>, ms: number, timeoutError: () => Error): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(() => reject(timeoutError()), ms)
	})
	return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

/**
 * Loads (or finds) the model, failing only when LM Studio stays silent for `loadIdleMs`:
 * every progress report restarts the wait. On timeout the load is cancelled on the server.
 */
function loadModel(client: LMStudioClient, baseUrl: string, modelId: string): Promise<LLM> {
	const controller = new AbortController()
	let timer: ReturnType<typeof setTimeout> | undefined
	return new Promise<LLM>((resolve, reject) => {
		const restartWait = () => {
			clearTimeout(timer)
			timer = setTimeout(() => {
				reject(new LmStudioTimeoutError(baseUrl, `while loading ${modelId}`, LM_STUDIO_TIMEOUTS.loadIdleMs))
				controller.abort()
			}, LM_STUDIO_TIMEOUTS.loadIdleMs)
		}
		restartWait()
		client.llm.model(modelId, { signal: controller.signal, onProgress: restartWait }).then(resolve, reject)
	}).finally(() => clearTimeout(timer))
}

/**
 * Closes the client's WebSocket connections; without this every model list or preload left
 * its sockets open. The SDK has no usable public close: 1.x has none, and 2.x's
 * `Symbol.asyncDispose` waits until the server has closed every channel, which a server that
 * stopped answering never does. So the sockets of the two ports this file uses are closed
 * directly (`llmPort`/`systemPort`, each port's `transport.ws`, the same in 1.x and 2.x).
 */
function closeClient(client: LMStudioClient): void {
	const ports = client as unknown as Record<string, { transport?: { ws?: { close(): void } | null } } | undefined>
	for (const name of ["llmPort", "systemPort"]) {
		try {
			ports[name]?.transport?.ws?.close()
		} catch {
			// Closing is best effort.
		}
	}
}

export const hasLoadedFullDetails = (modelId: string): boolean => modelsWithLoadedDetails.has(modelId)

export const forceFullModelDetailsLoad = async (baseUrl: string, modelId: string): Promise<void> => {
	try {
		// Test the connection to LM Studio first
		// Errors will be caught further down.
		await axios.get(`${baseUrl}/v1/models`, { timeout: LM_STUDIO_TIMEOUTS.requestMs })
		const lmsUrl = baseUrl.replace(/^http:\/\//, "ws://").replace(/^https:\/\//, "wss://")

		const client = new LMStudioClient({ baseUrl: lmsUrl })
		try {
			await loadModel(client, baseUrl, modelId)
		} finally {
			closeClient(client)
		}
		// Flush and refresh cache to get updated model details
		await flushModels({ provider: "lmstudio", baseUrl }, true)

		// Mark this model as having full details loaded.
		modelsWithLoadedDetails.add(modelId)
	} catch (error) {
		if (error instanceof LmStudioTimeoutError) {
			// Shown to the user by the caller; the task still starts.
			console.error(error.message)
			throw error
		}
		if (error.code === "ECONNREFUSED") {
			console.warn(`Error connecting to LMStudio at ${baseUrl}`)
		} else {
			console.error(
				`Error refreshing LMStudio model details: ${JSON.stringify(error, Object.getOwnPropertyNames(error), 2)}`,
			)
		}
	}
}

export const parseLMStudioModel = (rawModel: LLMInstanceInfo | LLMInfo): ModelInfo => {
	// Handle both LLMInstanceInfo (from loaded models) and LLMInfo (from downloaded models)
	const contextLength = "contextLength" in rawModel ? rawModel.contextLength : rawModel.maxContextLength

	const modelInfo: ModelInfo = Object.assign({}, lMStudioDefaultModelInfo, {
		description: `${rawModel.displayName} - ${rawModel.path}`,
		contextWindow: contextLength,
		supportsPromptCache: true,
		supportsImages: rawModel.vision,
		maxTokens: contextLength,
	})

	return modelInfo
}

export async function getLMStudioModels(baseUrl = "http://localhost:1234"): Promise<Record<string, ModelInfo>> {
	// clear the set of models that have full details loaded
	modelsWithLoadedDetails.clear()
	// clearing the input can leave an empty string; use the default in that case
	baseUrl = baseUrl === "" ? "http://localhost:1234" : baseUrl

	const models: Record<string, ModelInfo> = {}
	let client: LMStudioClient | undefined
	// ws is required to connect using the LMStudio library
	const lmsUrl = baseUrl.replace(/^http:\/\//, "ws://").replace(/^https:\/\//, "wss://")

	try {
		if (!URL.canParse(lmsUrl)) {
			return models
		}

		// test the connection to LM Studio first
		// errors will be caught further down
		await axios.get(`${baseUrl}/v1/models`, { timeout: LM_STUDIO_TIMEOUTS.requestMs })

		client = new LMStudioClient({ baseUrl: lmsUrl })
		const request = <T>(promise: Promise<T>, what: string) =>
			withTimeout(
				promise,
				LM_STUDIO_TIMEOUTS.requestMs,
				() => new LmStudioTimeoutError(baseUrl, what, LM_STUDIO_TIMEOUTS.requestMs),
			)

		// First, try to get all downloaded models
		try {
			const downloadedModels = await request(
				client.system.listDownloadedModels("llm"),
				"the list of downloaded models",
			)
			for (const model of downloadedModels) {
				// Use the model path as the key since that's what users select
				models[model.path] = parseLMStudioModel(model)
			}
		} catch (error) {
			if (error instanceof LmStudioTimeoutError) {
				// An LM Studio that does not answer this will not answer the next call either.
				throw error
			}
			console.warn("Failed to list downloaded models, falling back to loaded models only")
		}

		// Get loaded models for their runtime info (context size)
		const loadedModels = (await request(
			client.llm.listLoaded().then((models: LLM[]) => Promise.all(models.map((m) => m.getModelInfo()))),
			"the list of loaded models",
		)) as Array<LLMInstanceInfo>

		// Deduplicate: For each loaded model, check if any downloaded model path contains the loaded model's key
		// This handles cases like loaded "llama-3.1" matching downloaded "Meta/Llama-3.1/Something"
		// If found, remove the downloaded version and add the loaded model (prefer loaded over downloaded for accurate runtime info)
		for (const lmstudioModel of loadedModels) {
			const loadedModelId = lmstudioModel.modelKey.toLowerCase()

			// Find if any downloaded model path contains the loaded model's key as a path segment
			// Use word boundaries or path separators to avoid false matches like "llama" matching "codellama"
			const existingKey = Object.keys(models).find((key) => {
				const keyLower = key.toLowerCase()
				// Check if the loaded model ID appears as a distinct segment in the path
				// This matches "llama-3.1" in "Meta/Llama-3.1/Something" but not "llama" in "codellama"
				return (
					keyLower.includes(`/${loadedModelId}/`) ||
					keyLower.includes(`/${loadedModelId}`) ||
					keyLower.startsWith(`${loadedModelId}/`) ||
					keyLower === loadedModelId
				)
			})

			if (existingKey) {
				// Remove the downloaded version
				delete models[existingKey]
			}

			// Add the loaded model (either as replacement or new entry)
			models[lmstudioModel.modelKey] = parseLMStudioModel(lmstudioModel)
			modelsWithLoadedDetails.add(lmstudioModel.modelKey)
		}
	} catch (error) {
		if (error instanceof LmStudioTimeoutError) {
			console.error(`Error fetching LMStudio models: ${error.message}`)
			return {}
		}
		if (error.code === "ECONNREFUSED") {
			console.warn(`Error connecting to LMStudio at ${baseUrl}`)
		} else {
			console.error(
				`Error fetching LMStudio models: ${JSON.stringify(error, Object.getOwnPropertyNames(error), 2)}`,
			)
		}
	} finally {
		if (client) closeClient(client)
	}

	return models
}
