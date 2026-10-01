/**
 * @fileoverview The extension's one logger
 *
 * Every diagnostic line goes through `logger`, which writes it to the Tumble
 * Code output channel (and, in development, to the console as well). This
 * module stays free of the `vscode` API: the extension hands it the channel's
 * `appendLine` on activation, so the CLI and the tests can use it too.
 */

import { formatWithOptions } from "util"

/** Log levels in ascending order of severity. */
export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const
export type LogLevel = (typeof LOG_LEVELS)[number]

export interface Logger {
	/** Detailed traces (per request, per chunk). Written only while debug logging is on. */
	debug(...args: unknown[]): void
	info(...args: unknown[]): void
	warn(...args: unknown[]): void
	error(...args: unknown[]): void
	/** A logger whose lines carry `[name]` after the level, for example `[bedrock]`. */
	scope(name: string): Logger
}

export interface LoggerOptions {
	/** Receives one formatted line per entry: the output channel's `appendLine`. */
	appendLine?: (line: string) => void
	/** Lowest level that is also written to the console. Leave it out to keep the console quiet. */
	consoleLevel?: LogLevel
	/** Whether `debug` entries are written at all. Off by default. */
	debug?: boolean
}

// Under test the logger is silent unless ROO_TEST_LOGS=1: printing every line
// buried the failure summary. Tests that assert on logging spy on `logger`.
const testDefaults: LoggerOptions =
	process.env.NODE_ENV === "test" && process.env.ROO_TEST_LOGS === "1" ? { consoleLevel: "debug", debug: true } : {}

let options: LoggerOptions = testDefaults

/**
 * Points every later `logger` call, including calls from modules that imported
 * `logger` before this ran, at a new destination.
 */
export function configureLogger(next: LoggerOptions): void {
	options = { ...next }
}

/** Turns `debug` entries on or off, for example when the debug setting changes. */
export function setDebugLogging(enabled: boolean): void {
	options = { ...options, debug: enabled }
}

/** Restores the defaults (a silent logger outside ROO_TEST_LOGS=1 runs). For tests. */
export function resetLoggerForTests(): void {
	options = testDefaults
}

function levelIndex(level: LogLevel): number {
	return LOG_LEVELS.indexOf(level)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	if (value === null || typeof value !== "object") return false
	const proto = Object.getPrototypeOf(value)
	return proto === Object.prototype || proto === null
}

/**
 * Older call sites pass `{ ctx: "bedrock", ...details }` as the last argument.
 * The `ctx` becomes the line's scope; the other fields stay as details.
 */
function splitContext(args: unknown[]): { ctx?: string; args: unknown[] } {
	const last = args[args.length - 1]
	if (args.length < 2 || !isPlainObject(last) || typeof last.ctx !== "string") {
		return { args }
	}
	const { ctx, ...rest } = last
	const head = args.slice(0, -1)
	return { ctx: ctx as string, args: Object.keys(rest).length > 0 ? [...head, rest] : head }
}

/** Formats like `console.log`, on one line per value; an error's stack follows on its own lines. */
function formatArgs(args: unknown[]): string {
	// A lone string is printed verbatim: util.format would turn "%%" into "%".
	if (args.length === 1 && typeof args[0] === "string") {
		return args[0]
	}
	try {
		return formatWithOptions({ breakLength: Infinity, depth: 4 }, ...args)
	} catch {
		// Logging must never throw because of what it was given.
		return args.map((arg) => (typeof arg === "string" ? arg : Object.prototype.toString.call(arg))).join(" ")
	}
}

function write(level: LogLevel, scopes: readonly string[], rawArgs: unknown[]): void {
	if (level === "debug" && !options.debug) {
		return
	}

	const { ctx, args } = splitContext(rawArgs)
	const parts = ctx && !scopes.includes(ctx) ? [...scopes, ctx] : scopes
	const prefix = parts.map((part) => `[${part}]`).join(" ")

	if (options.appendLine) {
		const head = `${new Date().toISOString()} [${level}]${prefix ? ` ${prefix}` : ""}`
		try {
			options.appendLine(`${head} ${formatArgs(args)}`)
		} catch {
			// A disposed channel must not break the caller.
		}
	}

	if (options.consoleLevel && levelIndex(level) >= levelIndex(options.consoleLevel)) {
		const consoleArgs = prefix ? [prefix, ...args] : args
		// The logger is the one place allowed to write to the console.
		// eslint-disable-next-line no-console
		console[level](...consoleArgs)
	}
}

function createLogger(scopes: readonly string[]): Logger {
	return {
		debug: (...args) => write("debug", scopes, args),
		info: (...args) => write("info", scopes, args),
		warn: (...args) => write("warn", scopes, args),
		error: (...args) => write("error", scopes, args),
		scope: (name) => createLogger([...scopes, name]),
	}
}

/**
 * Shared logger. Silent until the extension calls `configureLogger` on
 * activation, which points it at the Tumble Code output channel.
 */
export const logger: Logger = createLogger([])
