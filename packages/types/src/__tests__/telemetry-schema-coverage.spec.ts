// npx vitest run src/__tests__/telemetry-schema-coverage.spec.ts
//
// Every TelemetryEventName member must be accepted by exactly one branch of
// tumbleCodeTelemetryEventSchema; an event missing from the schema is silently
// dropped by the cloud telemetry client.

import { TelemetryEventName, tumbleCodeTelemetryEventSchema } from "../telemetry.js"

import { discriminatorMap } from "./helpers/discriminated-union.js"

const optionsMap = discriminatorMap(tumbleCodeTelemetryEventSchema, "type")

describe("tumbleCodeTelemetryEventSchema coverage", () => {
	const allEvents = Object.values(TelemetryEventName)

	it("has a schema entry for every enum member", () => {
		const covered = new Set(optionsMap.keys())
		const missing = allEvents.filter((event) => !covered.has(event))

		expect(missing).toEqual([])
	})

	it("has no entry that is not an enum member", () => {
		const known = new Set<unknown>(allEvents)
		const extra = [...optionsMap.keys()].filter((key) => !known.has(key))

		expect(extra).toEqual([])
		expect(optionsMap.size).toBe(allEvents.length)
	})

	it("keeps the dedicated property schemas for the events that have them", () => {
		const generic = optionsMap.get(TelemetryEventName.TASK_CREATED)
		const dedicated = [
			TelemetryEventName.TASK_MESSAGE,
			TelemetryEventName.LLM_COMPLETION,
			TelemetryEventName.EMBEDDING_USAGE,
		]

		for (const event of dedicated) {
			expect(optionsMap.get(event)).not.toBe(generic)
		}

		const genericEvents = allEvents.filter((event) => !dedicated.includes(event))
		for (const event of genericEvents) {
			expect(optionsMap.get(event)).toBe(generic)
		}
	})

	it("validates a generic event and keeps its own properties", () => {
		const result = tumbleCodeTelemetryEventSchema.safeParse({
			type: TelemetryEventName.TOOL_USED,
			properties: {
				appName: "a",
				appVersion: "1",
				vscodeVersion: "1",
				platform: "linux",
				editorName: "code",
				language: "en",
				mode: "code",
				taskId: "t1",
				tool: "read_file",
			},
		})

		expect(result.success).toBe(true)
		expect(result.data?.properties).toHaveProperty("tool", "read_file")
	})

	// Regression: the embedding event borrowed the chat-provider enum for
	// apiProvider, so every event from an "openai-compatible" or other
	// embedding-only provider was rejected and the cloud never saw one.
	it("accepts an embedding event from an embedder that is not a chat provider", () => {
		const result = tumbleCodeTelemetryEventSchema.safeParse({
			type: TelemetryEventName.EMBEDDING_USAGE,
			properties: {
				appName: "a",
				appVersion: "1",
				vscodeVersion: "1",
				platform: "linux",
				editorName: "code",
				language: "en",
				mode: "code",
				promptTokens: 1705,
				totalTokens: 1705,
				apiProvider: "openai-compatible",
				source: "index-watch",
			},
		})

		expect(result.success).toBe(true)
	})

	describe("clientKind", () => {
		const base = {
			appName: "a",
			appVersion: "1",
			vscodeVersion: "1",
			platform: "linux",
			editorName: "wrapper|cli|",
			language: "en",
			mode: "code",
		}

		// The dedicated schemas strip unknown keys, so the field must be part of
		// the shared app properties or an LLM Completion would lose it.
		it("keeps clientKind and clientVersion on an LLM Completion", () => {
			const result = tumbleCodeTelemetryEventSchema.safeParse({
				type: TelemetryEventName.LLM_COMPLETION,
				properties: { ...base, clientKind: "cli", clientVersion: "0.2.0", inputTokens: 1, outputTokens: 2 },
			})

			expect(result.success).toBe(true)
			expect(result.data?.properties).toMatchObject({ clientKind: "cli", clientVersion: "0.2.0" })
		})

		it("still accepts an event from a producer that does not send clientKind", () => {
			const result = tumbleCodeTelemetryEventSchema.safeParse({
				type: TelemetryEventName.LLM_COMPLETION,
				properties: { ...base, inputTokens: 1, outputTokens: 2 },
			})

			expect(result.success).toBe(true)
		})
	})
})
