// npx vitest run src/__tests__/telemetry-schema-coverage.spec.ts
//
// Every TelemetryEventName member must be accepted by exactly one branch of
// rooCodeTelemetryEventSchema; an event missing from the schema is silently
// dropped by the cloud telemetry client.

import { TelemetryEventName, rooCodeTelemetryEventSchema } from "../telemetry.js"

describe("rooCodeTelemetryEventSchema coverage", () => {
	const allEvents = Object.values(TelemetryEventName)

	it("has a schema entry for every enum member", () => {
		const covered = new Set(rooCodeTelemetryEventSchema.optionsMap.keys())
		const missing = allEvents.filter((event) => !covered.has(event))

		expect(missing).toEqual([])
	})

	it("has no entry that is not an enum member", () => {
		const known = new Set<unknown>(allEvents)
		const extra = [...rooCodeTelemetryEventSchema.optionsMap.keys()].filter((key) => !known.has(key))

		expect(extra).toEqual([])
		expect(rooCodeTelemetryEventSchema.optionsMap.size).toBe(allEvents.length)
	})

	it("keeps the dedicated property schemas for the events that have them", () => {
		const generic = rooCodeTelemetryEventSchema.optionsMap.get(TelemetryEventName.TASK_CREATED)
		const dedicated = [
			TelemetryEventName.TELEMETRY_SETTINGS_CHANGED,
			TelemetryEventName.TASK_MESSAGE,
			TelemetryEventName.LLM_COMPLETION,
			TelemetryEventName.EMBEDDING_USAGE,
		]

		for (const event of dedicated) {
			expect(rooCodeTelemetryEventSchema.optionsMap.get(event)).not.toBe(generic)
		}

		const genericEvents = allEvents.filter((event) => !dedicated.includes(event))
		for (const event of genericEvents) {
			expect(rooCodeTelemetryEventSchema.optionsMap.get(event)).toBe(generic)
		}
	})

	it("validates a generic event and strips unknown properties", () => {
		const result = rooCodeTelemetryEventSchema.safeParse({
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
		expect(result.data?.properties).not.toHaveProperty("tool")
	})
})
