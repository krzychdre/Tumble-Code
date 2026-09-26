// cd src && ./node_modules/.bin/vitest run core/assistant-message/__tests__/NativeToolCallParser.partial-throttle.spec.ts

// API P2 (Phase 10): streamed tool arguments were re-parsed from the start on
// every chunk to feed the UI preview, which is quadratic in the argument size.
// Small arguments (paths, commands, queries) are still parsed on every chunk;
// large ones (file contents) at most once per interval. The complete call is
// always parsed in full by finalizeStreamingToolCall.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const parseJSON = vi.hoisted(() => ({ calls: 0, bytes: 0 }))

vi.mock("partial-json", async (importOriginal) => {
	const actual = await importOriginal<typeof import("partial-json")>()
	return {
		...actual,
		parseJSON: (text: string, ...rest: any[]) => {
			parseJSON.calls++
			parseJSON.bytes += text.length
			return (actual.parseJSON as any)(text, ...rest)
		},
	}
})

import {
	NativeToolCallParser,
	PARTIAL_ARGS_ALWAYS_PARSE_LENGTH,
	PARTIAL_ARGS_PARSE_INTERVAL_MS,
} from "../NativeToolCallParser"

/** A 50 KB write_to_file call, the size the plan measured. */
const content = Array.from({ length: 625 }, (_, i) => `line ${i} ${"x".repeat(70)}`).join("\n")
const args = JSON.stringify({ path: "src/big.ts", content })

/** Splits `text` into `count` chunks of (nearly) equal size, like a token stream. */
function chunksOf(text: string, count: number): string[] {
	const size = Math.ceil(text.length / count)
	const chunks: string[] = []
	for (let i = 0; i < text.length; i += size) {
		chunks.push(text.slice(i, i + size))
	}
	return chunks
}

describe("NativeToolCallParser partial-argument parsing (API P2)", () => {
	let now = 0

	beforeEach(() => {
		parseJSON.calls = 0
		parseJSON.bytes = 0
		now = 1_000
		vi.spyOn(Date, "now").mockImplementation(() => now)
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	it("parses a 50 KB argument stream in 12,637 chunks far fewer times, and the final call in full", () => {
		const parser = new NativeToolCallParser()
		parser.startStreamingToolCall("call_1", "write_to_file")

		let partials = 0
		let lastPartialContentLength = 0
		for (const chunk of chunksOf(args, 15_000)) {
			// 5 ms per chunk (about 200 chunks per second): a 63 s stream.
			now += 5
			const partial = parser.processStreamingChunk("call_1", chunk)
			if (partial) {
				partials++
				lastPartialContentLength = (partial.nativeArgs as { content?: string })?.content?.length ?? 0
			}
		}

		// Before: one parse of the whole accumulated text per chunk, 12,637 parses
		// and 319 million characters (1,604 and 18 million now). Now: every chunk up to the size limit,
		// then at most one parse per interval.
		expect(parseJSON.calls).toBe(partials)
		expect(parseJSON.calls).toBeLessThan(2_000)
		expect(parseJSON.bytes).toBeLessThan(60_000_000)
		// The preview kept up: the last partial is at most one interval of chunks behind.
		expect(content.length - lastPartialContentLength).toBeLessThan(
			(PARTIAL_ARGS_PARSE_INTERVAL_MS / 5) * Math.ceil(args.length / 15_000) + 1,
		)

		const final = parser.finalizeStreamingToolCall("call_1")
		expect((final as any)?.nativeArgs?.content).toBe(content)
	})

	it("parses every chunk while the arguments are small", () => {
		const parser = new NativeToolCallParser()
		parser.startStreamingToolCall("call_2", "execute_command")

		const small = JSON.stringify({ command: "ls -la " + "a".repeat(PARTIAL_ARGS_ALWAYS_PARSE_LENGTH - 100) })
		const chunks = chunksOf(small, 200)
		let partials = 0
		for (const chunk of chunks) {
			// No time passes: only the size limit decides.
			if (parser.processStreamingChunk("call_2", chunk)) {
				partials++
			}
		}

		expect(partials).toBe(chunks.length)
	})

	it("parses a large argument again once the interval has passed", () => {
		const parser = new NativeToolCallParser()
		parser.startStreamingToolCall("call_3", "write_to_file")

		expect(parser.processStreamingChunk("call_3", args.slice(0, PARTIAL_ARGS_ALWAYS_PARSE_LENGTH + 10))).not.toBeNull()
		expect(parser.processStreamingChunk("call_3", "abc")).toBeNull()

		now += PARTIAL_ARGS_PARSE_INTERVAL_MS
		expect(parser.processStreamingChunk("call_3", "def")).not.toBeNull()
	})
})
