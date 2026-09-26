/**
 * Debug-only performance counters (CORE-R7 step 1).
 *
 * They count the host-side work that grows with a conversation: settings
 * reads (`getState`), messages posted to the webview and their size, and the
 * task files written to disk and their size. Off by default; the
 * `tumble-code.debug` setting turns them on, and each API request cycle then
 * logs one `[perf]` line with the work it caused to the Tumble Code output
 * channel.
 *
 * While disabled every call returns after one boolean check. Sizes are
 * measured with `JSON.stringify`, which costs as much as the work being
 * measured, so they are only taken while enabled.
 *
 * The counters are process-wide: a background task that streams during the
 * same cycle adds to the same numbers.
 */

export const PERF_COUNTER_NAMES = [
	/** `ProviderStateBuilder.getState()` calls (the settings accessor). */
	"getState",
	/** `state` messages posted to the webview (full state pushes). */
	"statePosts",
	/** Serialized size of those state messages, in bytes. */
	"statePostBytes",
	/** `clineMessages` entries carried by those state messages. */
	"statePostMessages",
	/** `messageUpdated` messages posted to the webview (one chat message each). */
	"messageUpdatedPosts",
	/** Serialized size of those messages, in bytes. */
	"messageUpdatedBytes",
	/** Every other message posted to the webview. */
	"otherPosts",
	/** Serialized size of those messages, in bytes. */
	"otherPostBytes",
	/** `ui_messages.json` writes. */
	"uiMessagesSaves",
	/** Serialized size of those writes, in bytes. */
	"uiMessagesSaveBytes",
	/** `api_conversation_history.json` writes. */
	"apiHistorySaves",
	/** Serialized size of those writes, in bytes. */
	"apiHistorySaveBytes",
	/** `taskMetadata()` runs (metrics over the whole message list, per save). */
	"taskMetadataRuns",
] as const

export type PerfCounterName = (typeof PERF_COUNTER_NAMES)[number]

export type PerfCounterValues = Record<PerfCounterName, number>

function zeroValues(): PerfCounterValues {
	return Object.fromEntries(PERF_COUNTER_NAMES.map((name) => [name, 0])) as PerfCounterValues
}

/** UTF-8 size of `value` as JSON, the way the webview and the task files receive it. */
export function jsonByteLength(value: unknown): number {
	try {
		const json = JSON.stringify(value)
		return json === undefined ? 0 : Buffer.byteLength(json, "utf8")
	} catch {
		return 0
	}
}

class PerfCounters {
	private enabled = false
	private values: PerfCounterValues = zeroValues()

	isEnabled(): boolean {
		return this.enabled
	}

	setEnabled(enabled: boolean): void {
		this.enabled = enabled
	}

	/** Adds `amount` (default 1) to a counter while enabled. */
	add(name: PerfCounterName, amount = 1): void {
		if (!this.enabled) {
			return
		}

		this.values[name] += amount
	}

	/** Counts one webview message by kind and adds its size to that kind's byte counter. */
	recordWebviewPost(message: { type: string; state?: { clineMessages?: unknown[] } }): void {
		if (!this.enabled) {
			return
		}

		const bytes = jsonByteLength(message)

		if (message.type === "state") {
			this.values.statePosts += 1
			this.values.statePostBytes += bytes
			this.values.statePostMessages += message.state?.clineMessages?.length ?? 0
		} else if (message.type === "messageUpdated") {
			this.values.messageUpdatedPosts += 1
			this.values.messageUpdatedBytes += bytes
		} else {
			this.values.otherPosts += 1
			this.values.otherPostBytes += bytes
		}
	}

	/** Counts one task-file write and adds its size. */
	recordSave(file: "uiMessages" | "apiHistory", content: unknown): void {
		if (!this.enabled) {
			return
		}

		const bytes = jsonByteLength(content)

		if (file === "uiMessages") {
			this.values.uiMessagesSaves += 1
			this.values.uiMessagesSaveBytes += bytes
		} else {
			this.values.apiHistorySaves += 1
			this.values.apiHistorySaveBytes += bytes
		}
	}

	/** A copy of the current totals. */
	snapshot(): PerfCounterValues {
		return { ...this.values }
	}

	/** Sets every counter back to zero (tests and fresh measurements). */
	reset(): void {
		this.values = zeroValues()
	}
}

/** The process-wide counters. */
export const perfCounters = new PerfCounters()

/** What happened between two snapshots, counter by counter. */
export function diffPerfCounters(before: PerfCounterValues, after: PerfCounterValues): PerfCounterValues {
	const delta = zeroValues()

	for (const name of PERF_COUNTER_NAMES) {
		delta[name] = after[name] - before[name]
	}

	return delta
}

/** One log line: the non-zero counters of `delta`, in declaration order. */
export function formatPerfCounters(delta: PerfCounterValues): string {
	const parts = PERF_COUNTER_NAMES.filter((name) => delta[name] !== 0).map((name) => `${name}=${delta[name]}`)
	return parts.length > 0 ? parts.join(" ") : "no counted work"
}
