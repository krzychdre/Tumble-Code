// npx vitest run core/context-management/__tests__/compactProfile.spec.ts

import { getCompactOutputReservation } from "@tumble-code/core/browser"

import type { ApiHandler } from "../../../api"
import type { ApiMessage } from "../../task-persistence/apiMessages"
import { summarizeConversation } from "../../condense"
import { COMPACT_CONDENSE_THRESHOLD_PERCENT, resolveGlobalCondensePercent } from "../compactProfile"
import { resolveCondenseThreshold, willManageContext } from "../index"

vi.mock("@tumble-code/telemetry", () => ({
	TelemetryService: {
		hasInstance: vi.fn().mockReturnValue(true),
		instance: { capture: vi.fn() },
	},
}))

const WINDOW = 40_960

describe("resolveGlobalCondensePercent", () => {
	it("caps the global percent at 70 under the compact profile", () => {
		expect(COMPACT_CONDENSE_THRESHOLD_PERCENT).toBe(70)
		expect(resolveGlobalCondensePercent(100, true)).toBe(70)
		expect(resolveGlobalCondensePercent(90, true)).toBe(70)
	})

	it("lets a lower global setting win", () => {
		expect(resolveGlobalCondensePercent(50, true)).toBe(50)
	})

	it("leaves the global percent alone off the compact profile", () => {
		expect(resolveGlobalCondensePercent(100, false)).toBe(100)
		expect(resolveGlobalCondensePercent(50, false)).toBe(50)
	})

	it("still lets a valid per-profile threshold win, and -1 inherit the capped value", () => {
		const global = resolveGlobalCondensePercent(100, true)
		expect(resolveCondenseThreshold({ local: 85 }, "local", global)).toBe(85)
		expect(resolveCondenseThreshold({ local: -1 }, "local", global)).toBe(70)
		expect(resolveCondenseThreshold({}, "local", global)).toBe(70)
	})
})

describe("condense trigger for a 40,960-token window", () => {
	const base = {
		contextWindow: WINDOW,
		autoCondenseContext: true,
		profileThresholds: {},
		currentProfileId: "local",
		lastMessageTokens: 0,
	}

	it("compact: condenses from 70 percent, with 4,096 tokens reserved for the answer", () => {
		const compact = {
			...base,
			maxTokens: getCompactOutputReservation(WINDOW),
			autoCondenseContextPercent: resolveGlobalCondensePercent(100, true),
		}
		expect(willManageContext({ ...compact, totalTokens: 28_000 })).toBe(false)
		expect(willManageContext({ ...compact, totalTokens: 28_672 })).toBe(true)
	})

	it("flag off: today's trigger, only past the hard limit with nothing reserved (maxTokens -1)", () => {
		const today = { ...base, maxTokens: -1, autoCondenseContextPercent: resolveGlobalCondensePercent(100, false) }
		// allowedTokens = 0.9 * 40,960 - (-1) = 36,865: 90 percent of the window.
		expect(willManageContext({ ...today, totalTokens: 36_865 })).toBe(false)
		expect(willManageContext({ ...today, totalTokens: 36_866 })).toBe(true)
	})
})

describe("the condense request fits the compact window", () => {
	// Measured on what summarizeConversation actually sends: everything it adds on top of the
	// history (its system prompt and the condense instructions).
	it("adds about 6.3k characters to the history, so a 70 percent context plus the reservation fits", async () => {
		const sent: { systemPrompt: string; messages: Array<{ role: string; content: unknown }> }[] = []
		const handler = {
			createMessage: (systemPrompt: string, messages: Array<{ role: string; content: unknown }>) => {
				sent.push({ systemPrompt, messages })
				return (async function* () {
					yield { type: "text", text: "A summary." }
				})()
			},
			getModel: () => ({ id: "qwen3.5-4b-q4_k_m", info: { contextWindow: WINDOW, supportsPromptCache: false } }),
			countTokens: async () => 0,
		} as unknown as ApiHandler
		const history: ApiMessage[] = [
			{ role: "user", content: "Add two coffees to the diary", ts: 1 },
			{ role: "assistant", content: "Reading the diary", ts: 2 },
			{ role: "user", content: "Go on", ts: 3 },
		]

		await summarizeConversation({ messages: history, apiHandler: handler, systemPrompt: "unused", taskId: "t" })

		const { systemPrompt, messages } = sent[0]
		const instructions = messages[messages.length - 1].content as string
		const overheadChars = systemPrompt.length + instructions.length

		// Conservative tokenizer ratio for English prose (Qwen averages about 4 characters per token).
		const CHARS_PER_TOKEN = 3.5
		// The compact tool array budget from the overview plan (code mode, after conversion).
		const COMPACT_TOOLS_CHARS = 5_000
		const overheadTokens = Math.ceil((overheadChars + COMPACT_TOOLS_CHARS) / CHARS_PER_TOKEN)
		expect(overheadChars).toBeLessThanOrEqual(6_500)

		// The context at the threshold already includes the regular system prompt and tools, which the
		// condense request drops; counting them again keeps the bound on the safe side.
		const atThreshold = Math.ceil((WINDOW * COMPACT_CONDENSE_THRESHOLD_PERCENT) / 100)
		const condenseRequest = atThreshold + overheadTokens + getCompactOutputReservation(WINDOW)
		expect(condenseRequest).toBeLessThan(WINDOW)
		// About 5k tokens to spare even under these pessimistic assumptions (36,006 of 40,960 today).
		expect(WINDOW - condenseRequest).toBeGreaterThan(4_000)
	})
})
