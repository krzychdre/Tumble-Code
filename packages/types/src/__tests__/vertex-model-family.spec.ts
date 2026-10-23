// The Vertex model family decides the handler (Claude on the Anthropic Vertex handler, the rest on the
// Gemini-based one), the model info and the unknown-id stand-in. See ai_plans/2026-10-17_12-48_vertex-model-family.md.

import type { ModelInfo } from "../model.js"
import {
	geminiModels,
	resolveProviderModelSelection,
	selectAnthropicVertexModel,
	selectVertexModel,
	vertexDefaultModelId,
	vertexModelFamily,
	vertexModels,
	vertexUnknownClaudeModelStandInId,
	vertexUnknownGeminiModelStandInId,
} from "../index.js"

const table = vertexModels as unknown as Record<string, ModelInfo>

describe("vertexModelFamily", () => {
	it.each([
		["no id (the default model)", undefined, "claude"],
		["an empty id (the default model)", "", "claude"],
		["a listed Claude id", "claude-sonnet-4-5@20250929", "claude"],
		["a listed Gemini id", "gemini-2.5-pro", "gemini"],
		["a saved open model id (no longer listed)", "deepseek-r1-0528-maas", "open"],
		["an unknown Claude id", "claude-next-preview", "claude"],
		["an unknown Gemini id", "gemini-9-ultra", "gemini"],
		["an unknown open model id", "llama-9-maas", "open"],
	] as const)("%s is %s", (_, apiModelId, family) => {
		expect(vertexModelFamily({ apiModelId })).toBe(family)
	})

	// The open models were dropped from the table (#901): the Gemini path cannot call them.
	it("the table lists only Claude and Gemini models", () => {
		expect(Object.keys(table).filter((id) => vertexModelFamily({ apiModelId: id }) === "open")).toEqual([])
	})

	it("the default model is a listed Claude model", () => {
		expect(Object.hasOwn(table, vertexDefaultModelId)).toBe(true)
		expect(vertexModelFamily({ apiModelId: vertexDefaultModelId })).toBe("claude")
	})

	// A Gemini model that Google retires on both platforms must be hidden by the picker on both.
	it("a Gemini id both tables list is deprecated on Vertex exactly when it is in the Gemini table", () => {
		const shared = Object.entries(geminiModels as Record<string, ModelInfo>).filter(([id]) =>
			Object.hasOwn(table, id),
		)

		expect(shared.length).toBeGreaterThan(0)
		for (const [id, info] of shared) {
			expect(table[id]!.deprecated, id).toBe(info.deprecated)
		}
	})
})

// Shut down by Google (Gemini API deprecations page and the Vertex model versions page, read 2026-10-24); see
// ai_plans/2026-10-24_01-10_r4-fu-gemini-vertex-shut-down-models.md. Vertex also retired Gemini 2.5 on 2026-10-20.
const SHUT_DOWN_GEMINI_ID = /^gemini-(1\.5|2\.0)-|^gemini-2\.5-.*(preview|exp)|^gemini-3-pro-preview$/

describe("Gemini model tables", () => {
	it("offer no model Google has shut down", () => {
		const ids = [...Object.keys(geminiModels), ...Object.keys(table)]

		expect(ids.filter((id) => SHUT_DOWN_GEMINI_ID.test(id))).toEqual([])
		expect(Object.keys(table).filter((id) => id.startsWith("gemini-2.5"))).toEqual([])
	})

	// A profile that still selects a removed id keeps it (the settings warn about an unknown model).
	it.each([
		["gemini", "gemini-2.5-pro-preview-06-05"],
		["vertex", "gemini-2.5-pro"],
	] as const)("%s keeps the removed id %s as an unknown model", (apiProvider, apiModelId) => {
		expect(resolveProviderModelSelection({ apiProvider, apiModelId })).toMatchObject({
			id: apiModelId,
			known: false,
		})
	})
})

describe("Vertex unknown-id stand-ins", () => {
	it("each stand-in is a listed model of its own family", () => {
		expect(Object.hasOwn(table, vertexUnknownClaudeModelStandInId)).toBe(true)
		expect(vertexModelFamily({ apiModelId: vertexUnknownClaudeModelStandInId })).toBe("claude")
		expect(Object.hasOwn(table, vertexUnknownGeminiModelStandInId)).toBe(true)
		expect(vertexModelFamily({ apiModelId: vertexUnknownGeminiModelStandInId })).toBe("gemini")
	})

	// A newer Claude we know nothing about must get no effort level.
	it("the Claude stand-in lists no effort levels", () => {
		const info = table[vertexUnknownClaudeModelStandInId]!

		expect(info.supportsReasoningEffort).toBeUndefined()
		expect(info.reasoningEffort).toBeUndefined()
	})

	// Vertex serves only Gemini 3 and later, so an unknown Gemini id is a newer one: it gets no thinking budget
	// (a 2.5-only parameter) and a default thinking level every listed Gemini accepts.
	it("the Gemini stand-in asks for no thinking budget and a thinking level every listed Gemini takes", () => {
		const info = table[vertexUnknownGeminiModelStandInId]!
		const geminiIds = Object.keys(table).filter((id) => vertexModelFamily({ apiModelId: id }) === "gemini")

		expect(info.supportsReasoningBudget).toBeUndefined()
		expect(info.requiredReasoningBudget).toBeUndefined()
		for (const id of geminiIds) {
			expect(table[id]!.supportsReasoningEffort, id).toContain(info.reasoningEffort)
		}
	})

	// Regression (defect 2): one Claude record used to stand in for unknown Gemini ids too.
	it.each([
		["Gemini", "gemini-9-ultra", vertexUnknownGeminiModelStandInId],
		["open model", "llama-9-maas", vertexUnknownGeminiModelStandInId],
		["Claude", "claude-next-preview", vertexUnknownClaudeModelStandInId],
	])("an unknown %s id keeps its id and gets its family's stand-in", (_, apiModelId, standInId) => {
		expect(resolveProviderModelSelection({ apiProvider: "vertex", apiModelId })).toEqual({
			id: apiModelId,
			info: table[standInId],
			known: false,
			...(standInId === vertexUnknownClaudeModelStandInId ? { enable1MContext: false } : {}),
		})
	})

	it("the handlers' own selections use the same stand-ins", () => {
		expect(selectVertexModel({ apiModelId: "gemini-9-ultra" }).info).toBe(table[vertexUnknownGeminiModelStandInId])
		expect(selectAnthropicVertexModel({ apiModelId: "claude-next-preview" }).info).toBe(
			table[vertexUnknownClaudeModelStandInId],
		)
	})
})
