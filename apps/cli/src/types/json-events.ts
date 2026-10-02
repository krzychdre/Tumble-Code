import {
	rooCliOutputFormats,
	type RooCliCost,
	type RooCliEventType,
	type RooCliFinalOutput,
	type RooCliOutputFormat,
	type RooCliStreamEvent,
} from "@tumble-code/types"

/**
 * JSON Event Types for Structured CLI Output
 *
 * The fields of each event are declared once, by the schemas in
 * `@tumble-code/types` (packages/types/src/cli.ts). The output format is NDJSON
 * (newline-delimited JSON) for stream-json mode, or a single JSON object for
 * json mode.
 *
 * Schema is optimized for efficiency with high message volume:
 * - Minimal fields per event
 * - No redundant wrappers
 * - `done` flag instead of partial:false
 * - Each streamed delta carries the message `id`; the final one has `done: true`
 *
 * Which messages become events: every message the task adds or changes, once
 * per change, with the message's ts as the event `id`. That includes a message
 * that arrives together with the next one in one update from the extension.
 * A task resumed with `--session-id` emits only what it does from then on,
 * nothing of its history.
 */

export type OutputFormat = RooCliOutputFormat

export function isValidOutputFormat(format: string): format is OutputFormat {
	return (rooCliOutputFormats as readonly string[]).includes(format)
}

/** Cost and token usage information. */
export type JsonEventCost = RooCliCost

/** One output event; every event names its type. */
export type JsonEvent = RooCliStreamEvent & { type: RooCliEventType }

/** Final JSON output for "json" mode (single object at end). */
export type JsonFinalOutput = RooCliFinalOutput
