// npx vitest run src/message-utils/__tests__/consolidateTokenUsage.golden.spec.ts

// The token and cost totals of a task are computed in three places: here
// (authoritative), in the self-hosted cloud API (Python, task_summary.message_metrics)
// and in its web view (render.js getMetrics). One shared fixture holds the
// cases and the expected totals; the cloud API's pytest suite checks the other
// two against the same file (tests/test_token_golden_fixtures.py). The file
// lives under self-hosted-cloudapi/ so that editing it also runs the cloud API
// workflow, which only triggers on changes inside that directory.

import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

import type { ClineMessage } from "@roo-code/types"

import { consolidateTokenUsage } from "../consolidateTokenUsage.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const FIXTURE_PATH = path.resolve(
	__dirname,
	"..",
	"..",
	"..",
	"..",
	"..",
	"self-hosted-cloudapi",
	"tests",
	"fixtures",
	"token_usage_golden.json",
)

type GoldenCase = {
	name: string
	messages: ClineMessage[]
	expected: {
		totalTokensIn: number
		totalTokensOut: number
		totalCacheWrites: number | null
		totalCacheReads: number | null
		totalCost: number
		contextTokens: number
	}
}

const { cases } = JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8")) as { cases: GoldenCase[] }

describe("consolidateTokenUsage golden fixtures", () => {
	beforeEach(() => {
		// Malformed request text is part of the fixture; its parse error log is expected noise.
		vi.spyOn(console, "error").mockImplementation(() => {})
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	it("loads a non-trivial fixture", () => {
		expect(cases.length).toBeGreaterThanOrEqual(15)
	})

	it.each(cases.map((c) => [c.name, c] as const))("%s", (_name, c) => {
		const result = consolidateTokenUsage(c.messages)

		expect(result.totalTokensIn).toBe(c.expected.totalTokensIn)
		expect(result.totalTokensOut).toBe(c.expected.totalTokensOut)
		// The fixture writes an unreported cache total as null (JSON has no undefined).
		expect(result.totalCacheWrites).toBe(c.expected.totalCacheWrites ?? undefined)
		expect(result.totalCacheReads).toBe(c.expected.totalCacheReads ?? undefined)
		expect(result.totalCost).toBeCloseTo(c.expected.totalCost, 10)
		expect(result.contextTokens).toBe(c.expected.contextTokens)
	})
})
