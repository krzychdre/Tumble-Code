import { OutputChannelTransport } from "../OutputChannelTransport"
import type { CompactLogEntry } from "../types"

const T = Date.UTC(2026, 8, 24, 14, 5, 31, 123)

function entry(overrides: Partial<CompactLogEntry> = {}): CompactLogEntry {
	return { t: T, l: "info", m: "Loaded settings", ...overrides }
}

function capture(level?: ConstructorParameters<typeof OutputChannelTransport>[1]) {
	const lines: string[] = []
	const transport = new OutputChannelTransport((line) => lines.push(line), level)
	return { lines, transport }
}

describe("OutputChannelTransport", () => {
	it("writes one readable line with time, level, context and metadata", () => {
		const { lines, transport } = capture()

		transport.write(entry({ l: "warn", c: "bedrock", m: "Request throttled", d: { retryAfter: 2 } }))

		expect(lines).toEqual(['2026-09-24T14:05:31.123Z [warn] [bedrock] Request throttled {"retryAfter":2}'])
	})

	it("leaves out the context and metadata when there are none", () => {
		const { lines, transport } = capture()

		transport.write(entry())

		expect(lines).toEqual(["2026-09-24T14:05:31.123Z [info] Loaded settings"])
	})

	it("drops entries below the configured level (info by default)", () => {
		const { lines, transport } = capture()

		transport.write(entry({ l: "debug" }))
		transport.write(entry({ l: "info" }))
		transport.write(entry({ l: "fatal" }))

		expect(lines.map((line) => line.split(" ")[1])).toEqual(["[info]", "[fatal]"])
	})

	it("honors a stricter level", () => {
		const { lines, transport } = capture("error")

		transport.write(entry({ l: "warn" }))
		transport.write(entry({ l: "error" }))

		expect(lines).toHaveLength(1)
	})

	it("prints an error's stack on its own lines instead of inside the JSON", () => {
		const { lines, transport } = capture()
		const stack = "Error: boom\n    at handler (bedrock.ts:12:3)"

		transport.write(
			entry({ l: "error", m: "boom", d: { error: { name: "Error", message: "boom", stack }, attempt: 1 } }),
		)

		expect(lines).toEqual(['2026-09-24T14:05:31.123Z [error] boom {"attempt":1}', stack])
	})

	it("never throws on metadata it cannot serialize", () => {
		const { lines, transport } = capture()
		const circular: Record<string, unknown> = {}
		circular.self = circular

		expect(() => transport.write(entry({ d: circular }))).not.toThrow()
		expect(lines[0]).toContain("[unserializable metadata]")
	})

	it("writes bigint metadata instead of failing on it", () => {
		const { lines, transport } = capture()

		transport.write(entry({ d: { tokens: 12n } }))

		expect(lines[0]).toContain('{"tokens":"12n"}')
	})
})
