import { createInterface } from "readline"

import {
	rooCliCommandNames,
	type RooCliCommandName,
	type RooCliInputCommand,
	type RooCliStartCommand,
} from "@roo-code/types"

import { isRecord } from "@/lib/utils/guards.js"
import { isValidSessionId } from "@/lib/utils/session-id.js"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type StdinStreamCommandName = RooCliCommandName

export type StdinStreamCommand = RooCliInputCommand

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

export const VALID_STDIN_COMMANDS = new Set<StdinStreamCommandName>(rooCliCommandNames)

export function parseStdinStreamCommand(line: string, lineNumber: number): StdinStreamCommand {
	let parsed: unknown

	try {
		parsed = JSON.parse(line)
	} catch {
		throw new Error(`stdin command line ${lineNumber}: invalid JSON`)
	}

	if (!isRecord(parsed)) {
		throw new Error(`stdin command line ${lineNumber}: expected JSON object`)
	}

	const commandRaw = parsed.command
	const requestIdRaw = parsed.requestId

	if (typeof commandRaw !== "string") {
		throw new Error(`stdin command line ${lineNumber}: missing string "command"`)
	}

	if (!VALID_STDIN_COMMANDS.has(commandRaw as StdinStreamCommandName)) {
		throw new Error(
			`stdin command line ${lineNumber}: unsupported command "${commandRaw}" (expected start|message|cancel|ping|shutdown)`,
		)
	}

	if (typeof requestIdRaw !== "string" || requestIdRaw.trim().length === 0) {
		throw new Error(`stdin command line ${lineNumber}: missing non-empty string "requestId"`)
	}

	const command = commandRaw as StdinStreamCommandName
	const requestId = requestIdRaw.trim()

	if (command === "start" || command === "message") {
		const promptRaw = parsed.prompt

		if (typeof promptRaw !== "string" || promptRaw.trim().length === 0) {
			throw new Error(`stdin command line ${lineNumber}: "${command}" requires non-empty string "prompt"`)
		}

		const imagesRaw = parsed.images
		let images: string[] | undefined

		if (imagesRaw !== undefined) {
			if (!Array.isArray(imagesRaw) || !imagesRaw.every((image) => typeof image === "string")) {
				throw new Error(`stdin command line ${lineNumber}: "${command}" images must be an array of strings`)
			}

			images = imagesRaw
		}

		if (command === "start") {
			const taskIdRaw = parsed.taskId
			let taskId: string | undefined

			if (taskIdRaw !== undefined) {
				if (typeof taskIdRaw !== "string" || taskIdRaw.trim().length === 0) {
					throw new Error(`stdin command line ${lineNumber}: "start" taskId must be a non-empty string`)
				}
				taskId = taskIdRaw.trim()

				if (!isValidSessionId(taskId)) {
					throw new Error(`stdin command line ${lineNumber}: "start" taskId must be a valid UUID`)
				}
			}

			if (isRecord(parsed.configuration)) {
				return {
					command,
					requestId,
					prompt: promptRaw,
					...(taskId !== undefined ? { taskId } : {}),
					...(images !== undefined ? { images } : {}),
					configuration: parsed.configuration as RooCliStartCommand["configuration"],
				}
			}

			return {
				command,
				requestId,
				prompt: promptRaw,
				...(taskId !== undefined ? { taskId } : {}),
				...(images !== undefined ? { images } : {}),
			}
		}

		return {
			command,
			requestId,
			prompt: promptRaw,
			...(images !== undefined ? { images } : {}),
		}
	}

	return { command, requestId }
}

// ---------------------------------------------------------------------------
// NDJSON stdin reader
// ---------------------------------------------------------------------------

export async function* readCommandsFromStdinNdjson(): AsyncGenerator<StdinStreamCommand> {
	const lineReader = createInterface({
		input: process.stdin,
		crlfDelay: Infinity,
		terminal: false,
	})

	let lineNumber = 0

	try {
		for await (const line of lineReader) {
			lineNumber += 1
			const trimmed = line.trim()
			if (!trimmed) {
				continue
			}
			yield parseStdinStreamCommand(trimmed, lineNumber)
		}
	} finally {
		lineReader.close()
	}
}
