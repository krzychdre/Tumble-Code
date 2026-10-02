// npx vitest run api/__tests__/cost-call-sites.characterization.spec.ts
//
// Pins the cost every call site computes for a table of realistic usages. The expected numbers in
// __fixtures__/cost-call-sites.ts were produced by the code before the cost formulas were merged into
// one function (packages/core/src/api/cost.ts), with the model prices frozen in the same file so a
// catalog price change does not move them. Regenerate only for a deliberate pricing change:
//   UPDATE_COST_FIXTURE=1 npx vitest run api/__tests__/cost-call-sites.characterization.spec.ts

import * as fs from "fs"
import * as path from "path"

import type { Anthropic } from "@anthropic-ai/sdk"
import type { ModelInfo, ServiceTier } from "@tumble-code/types"
import { TelemetryService } from "@tumble-code/telemetry"

import { TaskStreamProcessor, type TaskStreamProcessorAccess } from "../../core/task/TaskStreamProcessor"
import { processAnthropicStream } from "../transform/anthropic-stream"
import { openAiUsageChunk } from "../providers/utils/completion-usage"
import { OpenAiNativeHandler } from "../providers/openai-native"
import { GeminiHandler } from "../providers/gemini"

import { EXPECTED, MODELS } from "./__fixtures__/cost-call-sites"

vi.mock("@tumble-code/telemetry", () => ({
	TelemetryService: { instance: { capture: vi.fn(), captureException: vi.fn() } },
}))

type Usage = { input: number; output: number; cacheWrite: number; cacheRead: number }

// Input is the total prompt size, cache figures included (the OpenAI meaning). The Anthropic call sites
// get `input - cacheWrite - cacheRead` as their uncached input, so both protocols price the same request.
const USAGES: Record<string, Usage> = {
	small: { input: 1_000, output: 500, cacheWrite: 0, cacheRead: 0 },
	cached: { input: 12_000, output: 800, cacheWrite: 3_000, cacheRead: 6_000 },
	cacheOnly: { input: 5_000, output: 0, cacheWrite: 0, cacheRead: 5_000 },
	over200k: { input: 250_000, output: 4_000, cacheWrite: 0, cacheRead: 200_000 },
	over272k: { input: 300_000, output: 2_000, cacheWrite: 20_000, cacheRead: 250_000 },
}

const uncached = (u: Usage) => u.input - u.cacheWrite - u.cacheRead

// Call site 1 and 2: TaskStreamProcessor, the api_req_started message and the LLM Completion telemetry.
function makeProcessor(apiProvider: string, apiModelId: string) {
	const access = {
		taskId: "task-1",
		abort: false,
		abandoned: false,
		apiConfiguration: { apiProvider, apiModelId },
		clineMessages: [{ ts: 1, type: "say", say: "api_req_started", text: "{}" }],
		assistantMessageContent: [],
		history: {
			saveClineMessages: vi.fn().mockResolvedValue(undefined),
			updateClineMessage: vi.fn().mockResolvedValue(undefined),
		},
	} as unknown as TaskStreamProcessorAccess
	return { access, processor: new TaskStreamProcessor(access, {} as any) }
}

// Usage counts as the task sees them: Anthropic-protocol providers report the uncached input.
function taskTokens(apiProvider: string, u: Usage) {
	const anthropicStyle = apiProvider === "anthropic" || apiProvider === "minimax"
	return {
		input: anthropicStyle ? uncached(u) : u.input,
		output: u.output,
		cacheWrite: u.cacheWrite,
		cacheRead: u.cacheRead,
	}
}

function taskMessageCost(apiProvider: string, apiModelId: string, info: ModelInfo, u: Usage): number {
	const { access, processor } = makeProcessor(apiProvider, apiModelId)
	const t = taskTokens(apiProvider, u)
	const p = processor as any
	p._inputTokens = t.input
	p._outputTokens = t.output
	p._cacheWriteTokens = t.cacheWrite
	p._cacheReadTokens = t.cacheRead
	p._totalCost = undefined
	processor.createUpdateApiReqMsgFn(0, info)()
	return JSON.parse(access.clineMessages[0].text!).cost
}

async function taskTelemetryCost(apiProvider: string, apiModelId: string, info: ModelInfo, u: Usage) {
	const { processor } = makeProcessor(apiProvider, apiModelId)
	const t = taskTokens(apiProvider, u)
	const capture = vi.mocked(TelemetryService.instance.capture)
	capture.mockClear()
	const done = { next: async () => ({ done: true, value: undefined }) } as any
	await processor.createBackgroundUsageDrain(0, { ...t, total: undefined }, info, done, undefined, vi.fn())(0)
	return (capture.mock.calls[0]![1] as { cost: number }).cost
}

// Call site 3: the Anthropic-protocol stream (Anthropic, MiniMax, Anthropic on Vertex).
async function anthropicStreamCost(info: ModelInfo, u: Usage) {
	const events = [
		{
			type: "message_start",
			message: {
				usage: {
					input_tokens: uncached(u),
					output_tokens: 1,
					cache_creation_input_tokens: u.cacheWrite,
					cache_read_input_tokens: u.cacheRead,
				},
			},
		},
		{ type: "message_delta", usage: { output_tokens: u.output } },
	] as unknown as Anthropic.Messages.RawMessageStreamEvent[]
	async function* stream() {
		yield* events
	}
	let cost: number | undefined
	for await (const chunk of processAnthropicStream(stream(), info)) {
		if (chunk.type === "usage" && chunk.totalCost !== undefined) cost = chunk.totalCost
	}
	return cost
}

// Call site 4: an OpenAI Chat Completions usage block priced from the model.
function openAiChunkCost(info: ModelInfo, u: Usage) {
	return openAiUsageChunk(
		{
			prompt_tokens: u.input,
			completion_tokens: u.output,
			prompt_tokens_details: { cached_tokens: u.cacheRead, cache_write_tokens: u.cacheWrite },
		},
		{ modelInfo: info },
	).totalCost
}

// Call site 5: OpenAI Native (Responses API), with the requested and the reported service tier.
function openAiNativeCost(info: ModelInfo, u: Usage, requested?: ServiceTier, reported?: ServiceTier) {
	const handler = new OpenAiNativeHandler({ openAiNativeApiKey: "k", openAiNativeServiceTier: requested })
	const totalCost = (handler as any).core.options.totalCost
	return totalCost(
		{ inputTokens: u.input, outputTokens: u.output, cacheWriteTokens: u.cacheWrite, cacheReadTokens: u.cacheRead },
		info,
		reported,
	)
}

// Call site 6: Gemini, which bills thinking tokens as output and prices by prompt size.
function geminiCost(info: ModelInfo, u: Usage) {
	const handler = new GeminiHandler({ geminiApiKey: "k" })
	return handler.calculateCost({
		info,
		inputTokens: u.input,
		outputTokens: u.output,
		cacheReadTokens: u.cacheRead,
		reasoningTokens: Math.round(u.output / 2),
	})
}

async function computeAll(): Promise<Record<string, number | undefined>> {
	const out: Record<string, number | undefined> = {}
	const task: [string, string, string][] = [
		["anthropic", "claude-sonnet-4-6", "claudeSonnet46"],
		["anthropic", "claude-opus-5", "claudeOpus5"],
		["minimax", "MiniMax-M2.7", "minimaxM27"],
		["openai-native", "gpt-5.4", "gpt54"],
		["xai", "grok-4.6", "grok46"],
		["deepseek", "deepseek-chat", "deepseekChat"],
		["gemini", "gemini-3.1-pro-preview", "gemini31Pro"],
		["openai", "custom", "noWritePrice"],
	]
	for (const [usageName, u] of Object.entries(USAGES)) {
		for (const [provider, modelId, model] of task) {
			out[`task message/${model}/${usageName}`] = taskMessageCost(provider, modelId, MODELS[model], u)
			out[`task telemetry/${model}/${usageName}`] = await taskTelemetryCost(provider, modelId, MODELS[model], u)
		}
		for (const model of ["claudeSonnet46", "claudeOpus5", "minimaxM27", "noWritePrice"]) {
			out[`anthropic stream/${model}/${usageName}`] = await anthropicStreamCost(MODELS[model], u)
		}
		for (const model of ["deepseekChat", "grok46", "gpt54", "gemini31Pro", "noWritePrice"]) {
			out[`openai usage chunk/${model}/${usageName}`] = openAiChunkCost(MODELS[model], u)
		}
		for (const [requested, reported] of [
			[undefined, undefined],
			["flex", undefined],
			["flex", "priority"],
			[undefined, "default"],
		] as [ServiceTier | undefined, ServiceTier | undefined][]) {
			for (const model of ["gpt54", "gpt56Sol"]) {
				out[`openai native/${model}/${requested ?? "-"}/${reported ?? "-"}/${usageName}`] = openAiNativeCost(
					MODELS[model],
					u,
					requested,
					reported,
				)
			}
		}
		for (const model of ["gemini31Pro", "gemini25Flash", "noInputPrice"]) {
			out[`gemini/${model}/${usageName}`] = geminiCost(MODELS[model], u)
		}
	}
	return out
}

describe("cost per call site (characterization)", () => {
	it("matches the numbers the code produced before the cost formulas were merged", async () => {
		const actual = await computeAll()

		if (process.env.UPDATE_COST_FIXTURE === "1") {
			const file = path.join(__dirname, "__fixtures__", "cost-call-sites.ts")
			const source = fs.readFileSync(file, "utf8")
			const head = source.slice(0, source.indexOf("export const EXPECTED"))
			fs.writeFileSync(
				file,
				`${head}export const EXPECTED: Record<string, number | null> = ${JSON.stringify(actual, (_k, v) => v ?? null, "\t")}\n`,
			)
			return
		}

		expect(Object.keys(actual).sort()).toEqual(Object.keys(EXPECTED).sort())
		for (const [key, expected] of Object.entries(EXPECTED)) {
			// null in the fixture: the call site reported no cost.
			const value = actual[key] ?? null
			if (expected === null || value === null) {
				expect({ key, value }).toEqual({ key, value: expected })
				continue
			}
			// The formulas multiply in a different order now, so allow float rounding and nothing more.
			expect(Math.abs(value - expected), key).toBeLessThanOrEqual(1e-12 * Math.max(1, Math.abs(expected)))
		}
	})
})
