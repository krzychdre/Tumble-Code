import { Anthropic } from "@anthropic-ai/sdk"
import workerpool from "workerpool"

import { countTokensPerBlockResultSchema, countTokensResultSchema } from "../workers/types"
import { tiktoken, tiktokenPerBlock } from "./tiktoken"

let pool: workerpool.Pool | null | undefined = undefined

// workerpool (10.x, src/Pool.js exec) throws this synchronously when the task
// queue is full. It is back-pressure from a burst of calls, not a broken
// worker: the pool itself is healthy and drains on its own.
const QUEUE_FULL_MESSAGE = /^Max queue size of \d+ reached$/

export function isQueueFullError(error: unknown): boolean {
	return error instanceof Error && QUEUE_FULL_MESSAGE.test(error.message)
}

export type CountTokensOptions = {
	useWorker?: boolean
}

function getPool(useWorker: boolean): workerpool.Pool | null {
	// Lazily create the worker pool if it doesn't exist.
	if (useWorker && typeof pool === "undefined") {
		pool = workerpool.pool(__dirname + "/workers/countTokens.js", {
			maxWorkers: 1,
			maxQueueSize: 10,
		})
	}
	return useWorker && pool ? pool : null
}

/**
 * Runs one worker method and falls back to the inline tokenizer when the pool
 * is unavailable or the call fails. A full queue is transient: count this call
 * inline and keep the pool for the next ones. Anything else (the worker crashed
 * or cannot start, or it answered with a failure) disables the pool for the
 * session so every later call does not pay for another failing round trip.
 */
async function runCount<T>(
	useWorker: boolean,
	run: (pool: workerpool.Pool) => Promise<T>,
	inline: () => Promise<T>,
): Promise<T> {
	// If the worker pool doesn't exist or the caller doesn't want to use it
	// then, use the non-worker implementation.
	const activePool = getPool(useWorker)
	if (!activePool) {
		return inline()
	}

	try {
		return await run(activePool)
	} catch (error) {
		if (!isQueueFullError(error)) {
			pool = null
			console.error(error)
		}

		return inline()
	}
}

export async function countTokens(
	content: Anthropic.Messages.ContentBlockParam[],
	{ useWorker = true }: CountTokensOptions = {},
): Promise<number> {
	return runCount(
		useWorker,
		async (activePool) => {
			const result = countTokensResultSchema.parse(await activePool.exec("countTokens", [content]))
			if (!result.success) {
				throw new Error(result.error)
			}
			return result.count
		},
		() => tiktoken(content),
	)
}

/**
 * Raw token count of each block (no fudge factor), counted in the worker like
 * `countTokens`. Used by callers that remember counts per block, see
 * BlockTokenCountCache.
 */
export async function countTokensPerBlock(
	content: Anthropic.Messages.ContentBlockParam[],
	{ useWorker = true }: CountTokensOptions = {},
): Promise<number[]> {
	return runCount(
		useWorker,
		async (activePool) => {
			const result = countTokensPerBlockResultSchema.parse(
				await activePool.exec("countTokensPerBlock", [content]),
			)
			if (!result.success) {
				throw new Error(result.error)
			}
			if (result.counts.length !== content.length) {
				throw new Error(
					`countTokensPerBlock answered ${result.counts.length} counts for ${content.length} blocks`,
				)
			}
			return result.counts
		},
		() => tiktokenPerBlock(content),
	)
}
