import { Anthropic } from "@anthropic-ai/sdk"
import workerpool from "workerpool"

import { countTokensResultSchema } from "../workers/types"
import { tiktoken } from "./tiktoken"

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

export async function countTokens(
	content: Anthropic.Messages.ContentBlockParam[],
	{ useWorker = true }: CountTokensOptions = {},
): Promise<number> {
	// Lazily create the worker pool if it doesn't exist.
	if (useWorker && typeof pool === "undefined") {
		pool = workerpool.pool(__dirname + "/workers/countTokens.js", {
			maxWorkers: 1,
			maxQueueSize: 10,
		})
	}

	// If the worker pool doesn't exist or the caller doesn't want to use it
	// then, use the non-worker implementation.
	if (!useWorker || !pool) {
		return tiktoken(content)
	}

	try {
		const data = await pool.exec("countTokens", [content])
		const result = countTokensResultSchema.parse(data)

		if (!result.success) {
			throw new Error(result.error)
		}

		return result.count
	} catch (error) {
		// A full queue is transient: count this call inline and keep the pool
		// for the next ones. Anything else (the worker crashed or cannot start,
		// or it answered with a failure) disables the pool for the session so
		// every later call does not pay for another failing round trip.
		if (!isQueueFullError(error)) {
			pool = null
			console.error(error)
		}

		return tiktoken(content)
	}
}
