// pnpm --filter @roo-code/telemetry test src/__tests__/TelemetryService.payloads.spec.ts
//
// Pins the exact event name and properties (values AND key order, because
// the payload is serialized as is) that every client receives. Each row
// builds its properties the way the call sites do (they replaced the old
// captureXxx wrappers); the expected payloads are the ones those wrappers
// produced, unchanged.

import { ZodError, z } from "zod"

import { type TelemetryClient, type TelemetryEvent, TelemetryEventName } from "@roo-code/types"

import { TelemetryService } from "../TelemetryService.js"

const makeClient = () => {
	const events: TelemetryEvent[] = []
	const client: TelemetryClient = {
		setProvider: vi.fn(),
		capture: vi.fn(async (event: TelemetryEvent) => {
			events.push(event)
		}),
		captureException: vi.fn(),
		updateTelemetryState: vi.fn(),
		isTelemetryEnabled: vi.fn(() => true),
		shutdown: vi.fn(),
	}
	return { client, events }
}

const zodError = (() => {
	const result = z.object({ a: z.string() }).safeParse({ a: 1 })
	return (result as { error: ZodError }).error
})()

type Row = [name: string, call: (s: TelemetryService) => void, expected: TelemetryEvent]

const E = TelemetryEventName

// Call sites spread an optional task id (`...(taskId && { taskId })`), which
// drops both undefined and the empty string.
const withTask = "t1" as string | undefined
const noTask = undefined as string | undefined
const emptyTask = "" as string | undefined

const payloadRows: Row[] = [
	[
		"task created",
		(s) => s.capture(E.TASK_CREATED, { taskId: "t1" }),
		{ event: E.TASK_CREATED, properties: { taskId: "t1" } },
	],
	[
		"task restarted",
		(s) => s.capture(E.TASK_RESTARTED, { taskId: "t1" }),
		{ event: E.TASK_RESTARTED, properties: { taskId: "t1" } },
	],
	[
		"task completed without extra properties",
		(s) => s.capture(E.TASK_COMPLETED, { taskId: "t1" }),
		{ event: E.TASK_COMPLETED, properties: { taskId: "t1" } },
	],
	[
		"task completed with extra properties (taskId wins, stays last)",
		(s) => s.capture(E.TASK_COMPLETED, { ...{ taskId: "stale", modelId: "m", mode: "code" }, taskId: "t1" }),
		{ event: E.TASK_COMPLETED, properties: { taskId: "t1", modelId: "m", mode: "code" } },
	],
	[
		"conversation message",
		(s) => s.capture(E.TASK_CONVERSATION_MESSAGE, { taskId: "t1", source: "assistant" }),
		{ event: E.TASK_CONVERSATION_MESSAGE, properties: { taskId: "t1", source: "assistant" } },
	],
	[
		"llm completion with a task",
		(s) =>
			s.capture(E.LLM_COMPLETION, {
				...(withTask && { taskId: withTask }),
				inputTokens: 1,
				outputTokens: 2,
				cacheWriteTokens: 3,
				cacheReadTokens: 4,
				cost: 0.5,
				completionKind: "condense",
			}),
		{
			event: E.LLM_COMPLETION,
			properties: {
				taskId: "t1",
				inputTokens: 1,
				outputTokens: 2,
				cacheWriteTokens: 3,
				cacheReadTokens: 4,
				cost: 0.5,
				completionKind: "condense",
			},
		},
	],
	[
		"llm completion without a task",
		(s) =>
			s.capture(E.LLM_COMPLETION, {
				...(noTask && { taskId: noTask }),
				inputTokens: 1,
				outputTokens: 2,
				cacheWriteTokens: 0,
				cacheReadTokens: 0,
				completionKind: "enhance",
			}),
		{
			event: E.LLM_COMPLETION,
			properties: {
				inputTokens: 1,
				outputTokens: 2,
				cacheWriteTokens: 0,
				cacheReadTokens: 0,
				completionKind: "enhance",
			},
		},
	],
	[
		"llm completion with an empty task id",
		(s) =>
			s.capture(E.LLM_COMPLETION, {
				...(emptyTask && { taskId: emptyTask }),
				inputTokens: 1,
				outputTokens: 2,
				cacheWriteTokens: 0,
				cacheReadTokens: 0,
			}),
		{
			event: E.LLM_COMPLETION,
			properties: { inputTokens: 1, outputTokens: 2, cacheWriteTokens: 0, cacheReadTokens: 0 },
		},
	],
	[
		"embedding usage",
		(s) => s.capture(E.EMBEDDING_USAGE, { promptTokens: 5, totalTokens: 6, modelId: "e", source: "index" }),
		{
			event: E.EMBEDDING_USAGE,
			properties: { promptTokens: 5, totalTokens: 6, modelId: "e", source: "index" },
		},
	],
	[
		"mode switch",
		(s) => s.capture(E.MODE_SWITCH, { taskId: "t1", newMode: "ask" }),
		{ event: E.MODE_SWITCH, properties: { taskId: "t1", newMode: "ask" } },
	],
	[
		"tool usage",
		(s) => s.capture(E.TOOL_USED, { taskId: "t1", tool: "read_file" }),
		{ event: E.TOOL_USED, properties: { taskId: "t1", tool: "read_file" } },
	],
	[
		"checkpoint created",
		(s) => s.capture(E.CHECKPOINT_CREATED, { taskId: "t1" }),
		{ event: E.CHECKPOINT_CREATED, properties: { taskId: "t1" } },
	],
	[
		"checkpoint diffed",
		(s) => s.capture(E.CHECKPOINT_DIFFED, { taskId: "t1" }),
		{ event: E.CHECKPOINT_DIFFED, properties: { taskId: "t1" } },
	],
	[
		"checkpoint restored",
		(s) => s.capture(E.CHECKPOINT_RESTORED, { taskId: "t1" }),
		{ event: E.CHECKPOINT_RESTORED, properties: { taskId: "t1" } },
	],
	[
		"context condensed, minimal",
		(s) => s.capture(E.CONTEXT_CONDENSED, { taskId: "t1", isAutomaticTrigger: false }),
		{ event: E.CONTEXT_CONDENSED, properties: { taskId: "t1", isAutomaticTrigger: false } },
	],
	[
		"context condensed, custom prompt flag false is kept",
		(s) => s.capture(E.CONTEXT_CONDENSED, { taskId: "t1", isAutomaticTrigger: true, usedCustomPrompt: false }),
		{ event: E.CONTEXT_CONDENSED, properties: { taskId: "t1", isAutomaticTrigger: true, usedCustomPrompt: false } },
	],
	[
		"context condensed with prune details",
		(s) =>
			s.capture(E.CONTEXT_CONDENSED, {
				taskId: "t1",
				isAutomaticTrigger: true,
				usedCustomPrompt: true,
				...{ prunedCount: 2, bytesSaved: 30 },
				summarySkipped: false,
			}),
		{
			event: E.CONTEXT_CONDENSED,
			properties: {
				taskId: "t1",
				isAutomaticTrigger: true,
				usedCustomPrompt: true,
				prunedCount: 2,
				bytesSaved: 30,
				summarySkipped: false,
			},
		},
	],
	[
		"context condensed with prune details but no prompt flag",
		(s) =>
			s.capture(E.CONTEXT_CONDENSED, {
				taskId: "t1",
				isAutomaticTrigger: true,
				prunedCount: 1,
				bytesSaved: 3,
				summarySkipped: true,
			}),
		{
			event: E.CONTEXT_CONDENSED,
			properties: { taskId: "t1", isAutomaticTrigger: true, prunedCount: 1, bytesSaved: 3, summarySkipped: true },
		},
	],
	[
		"context pruned",
		(s) => s.capture(E.CONTEXT_PRUNED, { taskId: "t1", prunedCount: 4, bytesSaved: 40 }),
		{ event: E.CONTEXT_PRUNED, properties: { taskId: "t1", prunedCount: 4, bytesSaved: 40 } },
	],
	[
		"sliding window truncation",
		(s) => s.capture(E.SLIDING_WINDOW_TRUNCATION, { taskId: "t1" }),
		{ event: E.SLIDING_WINDOW_TRUNCATION, properties: { taskId: "t1" } },
	],
	[
		"context microcompacted",
		(s) =>
			s.capture(E.CONTEXT_MICROCOMPACTED, {
				taskId: "t1",
				candidates: 1,
				cleared: 2,
				protectedResults: 3,
				releasedProtected: 4,
				tokensCleared: 5,
				prevContextTokens: 6,
				reclaimRatio: 0.5,
			}),
		{
			event: E.CONTEXT_MICROCOMPACTED,
			properties: {
				taskId: "t1",
				candidates: 1,
				cleared: 2,
				protectedResults: 3,
				releasedProtected: 4,
				tokensCleared: 5,
				prevContextTokens: 6,
				reclaimRatio: 0.5,
			},
		},
	],
	[
		"code action used",
		(s) => s.capture(E.CODE_ACTION_USED, { actionType: "EXPLAIN" }),
		{ event: E.CODE_ACTION_USED, properties: { actionType: "EXPLAIN" } },
	],
	[
		"prompt enhanced with a task",
		(s) => s.capture(E.PROMPT_ENHANCED, { ...(withTask && { taskId: withTask }) }),
		{ event: E.PROMPT_ENHANCED, properties: { taskId: "t1" } },
	],
	[
		"prompt enhanced without a task",
		(s) => s.capture(E.PROMPT_ENHANCED, { ...(noTask && { taskId: noTask }) }),
		{ event: E.PROMPT_ENHANCED, properties: {} },
	],
	[
		"schema validation error (the zod error is formatted)",
		(s) => s.capture(E.SCHEMA_VALIDATION_ERROR, { schemaName: "GlobalSettings", error: zodError.format() }),
		{ event: E.SCHEMA_VALIDATION_ERROR, properties: { schemaName: "GlobalSettings", error: zodError.format() } },
	],
	[
		"diff application error",
		(s) => s.capture(E.DIFF_APPLICATION_ERROR, { taskId: "t1", consecutiveMistakeCount: 3 }),
		{ event: E.DIFF_APPLICATION_ERROR, properties: { taskId: "t1", consecutiveMistakeCount: 3 } },
	],
	[
		"shell integration error",
		(s) => s.capture(E.SHELL_INTEGRATION_ERROR, { taskId: "t1" }),
		{ event: E.SHELL_INTEGRATION_ERROR, properties: { taskId: "t1" } },
	],
	[
		"consecutive mistake error",
		(s) => s.capture(E.CONSECUTIVE_MISTAKE_ERROR, { taskId: "t1" }),
		{ event: E.CONSECUTIVE_MISTAKE_ERROR, properties: { taskId: "t1" } },
	],
	[
		"tab shown",
		(s) => s.capture(E.TAB_SHOWN, { tab: "settings" }),
		{ event: E.TAB_SHOWN, properties: { tab: "settings" } },
	],
	[
		"mode setting changed",
		(s) => s.capture(E.MODE_SETTINGS_CHANGED, { settingName: "roleDefinition" }),
		{ event: E.MODE_SETTINGS_CHANGED, properties: { settingName: "roleDefinition" } },
	],
	[
		"custom mode created",
		(s) => s.capture(E.CUSTOM_MODE_CREATED, { modeSlug: "slug", modeName: "Name" }),
		{ event: E.CUSTOM_MODE_CREATED, properties: { modeSlug: "slug", modeName: "Name" } },
	],
	[
		"marketplace item installed without extra properties",
		(s) =>
			s.capture(E.MARKETPLACE_ITEM_INSTALLED, {
				itemId: "id",
				itemType: "mode",
				itemName: "Item",
				target: "project",
			}),
		{
			event: E.MARKETPLACE_ITEM_INSTALLED,
			properties: { itemId: "id", itemType: "mode", itemName: "Item", target: "project" },
		},
	],
	[
		"marketplace item installed with extra properties",
		(s) =>
			s.capture(E.MARKETPLACE_ITEM_INSTALLED, {
				itemId: "id",
				itemType: "mcp",
				itemName: "Item",
				target: "global",
				...{ hasParameters: true },
			}),
		{
			event: E.MARKETPLACE_ITEM_INSTALLED,
			properties: { itemId: "id", itemType: "mcp", itemName: "Item", target: "global", hasParameters: true },
		},
	],
	[
		"marketplace item removed",
		(s) =>
			s.capture(E.MARKETPLACE_ITEM_REMOVED, {
				itemId: "id",
				itemType: "mode",
				itemName: "Item",
				target: "project",
			}),
		{
			event: E.MARKETPLACE_ITEM_REMOVED,
			properties: { itemId: "id", itemType: "mode", itemName: "Item", target: "project" },
		},
	],
	[
		"title button clicked",
		(s) => s.capture(E.TITLE_BUTTON_CLICKED, { button: "plus" }),
		{ event: E.TITLE_BUTTON_CLICKED, properties: { button: "plus" } },
	],
	[
		"telemetry settings changed",
		(s) => s.capture(E.TELEMETRY_SETTINGS_CHANGED, { previousSetting: "enabled", newSetting: "disabled" }),
		{ event: E.TELEMETRY_SETTINGS_CHANGED, properties: { previousSetting: "enabled", newSetting: "disabled" } },
	],
]

describe("TelemetryService event payloads", () => {
	it.each(payloadRows)("%s", (_name, call, expected) => {
		const { client, events } = makeClient()
		const service = new TelemetryService([client])

		call(service)

		expect(events).toHaveLength(1)
		expect(events[0]).toStrictEqual(expected)
		// Same key order, so the serialized payload is byte-identical.
		expect(JSON.stringify(events[0])).toBe(JSON.stringify(expected))
	})

	it("sends every event to every registered client", () => {
		const a = makeClient()
		const b = makeClient()
		const service = new TelemetryService([a.client])
		service.register(b.client)

		service.capture(E.TOOL_USED, { taskId: "t1", tool: "read_file" })

		expect(a.events).toEqual([{ event: E.TOOL_USED, properties: { taskId: "t1", tool: "read_file" } }])
		expect(b.events).toEqual(a.events)
	})

	it("accepts free-form properties, or none, for events without a typed payload", () => {
		const { client, events } = makeClient()
		const service = new TelemetryService([client])

		service.capture(E.MODE_SELECTOR_OPENED)
		service.capture(E.CODE_INDEX_ERROR, { reason: "x" })

		expect(events).toStrictEqual([
			{ event: E.MODE_SELECTOR_OPENED, properties: undefined },
			{ event: E.CODE_INDEX_ERROR, properties: { reason: "x" } },
		])
	})

	it("drops events when no client is registered", () => {
		const service = new TelemetryService([])
		expect(() => service.capture(E.TASK_CREATED, { taskId: "t1" })).not.toThrow()
	})
})

describe("TelemetryService.resetInstance", () => {
	afterEach(() => TelemetryService.resetInstance())

	it("lets a test create a fresh singleton", () => {
		const first = TelemetryService.createInstance([])
		expect(() => TelemetryService.createInstance([])).toThrow("TelemetryService instance already created")

		TelemetryService.resetInstance()
		expect(TelemetryService.hasInstance()).toBe(false)

		const second = TelemetryService.createInstance([])
		expect(second).not.toBe(first)
		expect(TelemetryService.instance).toBe(second)
	})
})
