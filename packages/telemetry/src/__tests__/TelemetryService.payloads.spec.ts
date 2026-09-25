// pnpm --filter @roo-code/telemetry test src/__tests__/TelemetryService.payloads.spec.ts
//
// Pins the exact event name and properties (values AND key order, because
// the payload is serialized as is) that each typed capture helper sends to
// every registered client.

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

const payloadRows: Row[] = [
	["task created", (s) => s.captureTaskCreated("t1"), { event: E.TASK_CREATED, properties: { taskId: "t1" } }],
	["task restarted", (s) => s.captureTaskRestarted("t1"), { event: E.TASK_RESTARTED, properties: { taskId: "t1" } }],
	[
		"task completed without extra properties",
		(s) => s.captureTaskCompleted("t1"),
		{ event: E.TASK_COMPLETED, properties: { taskId: "t1" } },
	],
	[
		"task completed with extra properties (taskId wins, stays last)",
		(s) => s.captureTaskCompleted("t1", { taskId: "stale", modelId: "m", mode: "code" }),
		{ event: E.TASK_COMPLETED, properties: { taskId: "t1", modelId: "m", mode: "code" } },
	],
	[
		"conversation message",
		(s) => s.captureConversationMessage("t1", "assistant"),
		{ event: E.TASK_CONVERSATION_MESSAGE, properties: { taskId: "t1", source: "assistant" } },
	],
	[
		"llm completion with a task",
		(s) =>
			s.captureLlmCompletion("t1", {
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
			s.captureLlmCompletion(undefined, {
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
		(s) => s.captureLlmCompletion("", { inputTokens: 1, outputTokens: 2, cacheWriteTokens: 0, cacheReadTokens: 0 }),
		{
			event: E.LLM_COMPLETION,
			properties: { inputTokens: 1, outputTokens: 2, cacheWriteTokens: 0, cacheReadTokens: 0 },
		},
	],
	[
		"embedding usage",
		(s) => s.captureEmbeddingUsage({ promptTokens: 5, totalTokens: 6, modelId: "e", source: "index" }),
		{
			event: E.EMBEDDING_USAGE,
			properties: { promptTokens: 5, totalTokens: 6, modelId: "e", source: "index" },
		},
	],
	[
		"mode switch",
		(s) => s.captureModeSwitch("t1", "ask"),
		{ event: E.MODE_SWITCH, properties: { taskId: "t1", newMode: "ask" } },
	],
	[
		"tool usage",
		(s) => s.captureToolUsage("t1", "read_file"),
		{ event: E.TOOL_USED, properties: { taskId: "t1", tool: "read_file" } },
	],
	[
		"checkpoint created",
		(s) => s.captureCheckpointCreated("t1"),
		{ event: E.CHECKPOINT_CREATED, properties: { taskId: "t1" } },
	],
	[
		"checkpoint diffed",
		(s) => s.captureCheckpointDiffed("t1"),
		{ event: E.CHECKPOINT_DIFFED, properties: { taskId: "t1" } },
	],
	[
		"checkpoint restored",
		(s) => s.captureCheckpointRestored("t1"),
		{ event: E.CHECKPOINT_RESTORED, properties: { taskId: "t1" } },
	],
	[
		"context condensed, minimal",
		(s) => s.captureContextCondensed("t1", false),
		{ event: E.CONTEXT_CONDENSED, properties: { taskId: "t1", isAutomaticTrigger: false } },
	],
	[
		"context condensed, custom prompt flag false is kept",
		(s) => s.captureContextCondensed("t1", true, false),
		{ event: E.CONTEXT_CONDENSED, properties: { taskId: "t1", isAutomaticTrigger: true, usedCustomPrompt: false } },
	],
	[
		"context condensed with prune details",
		(s) => s.captureContextCondensed("t1", true, true, { prunedCount: 2, bytesSaved: 30, summarySkipped: false }),
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
			s.captureContextCondensed("t1", true, undefined, { prunedCount: 1, bytesSaved: 3, summarySkipped: true }),
		{
			event: E.CONTEXT_CONDENSED,
			properties: { taskId: "t1", isAutomaticTrigger: true, prunedCount: 1, bytesSaved: 3, summarySkipped: true },
		},
	],
	[
		"context pruned",
		(s) => s.captureContextPruned("t1", { prunedCount: 4, bytesSaved: 40 }),
		{ event: E.CONTEXT_PRUNED, properties: { taskId: "t1", prunedCount: 4, bytesSaved: 40 } },
	],
	[
		"sliding window truncation",
		(s) => s.captureSlidingWindowTruncation("t1"),
		{ event: E.SLIDING_WINDOW_TRUNCATION, properties: { taskId: "t1" } },
	],
	[
		"context microcompacted",
		(s) =>
			s.captureContextMicrocompacted("t1", {
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
		(s) => s.captureCodeActionUsed("EXPLAIN"),
		{ event: E.CODE_ACTION_USED, properties: { actionType: "EXPLAIN" } },
	],
	[
		"prompt enhanced with a task",
		(s) => s.capturePromptEnhanced("t1"),
		{ event: E.PROMPT_ENHANCED, properties: { taskId: "t1" } },
	],
	["prompt enhanced without a task", (s) => s.capturePromptEnhanced(), { event: E.PROMPT_ENHANCED, properties: {} }],
	[
		"schema validation error (the zod error is formatted)",
		(s) => s.captureSchemaValidationError({ schemaName: "GlobalSettings", error: zodError }),
		{ event: E.SCHEMA_VALIDATION_ERROR, properties: { schemaName: "GlobalSettings", error: zodError.format() } },
	],
	[
		"diff application error",
		(s) => s.captureDiffApplicationError("t1", 3),
		{ event: E.DIFF_APPLICATION_ERROR, properties: { taskId: "t1", consecutiveMistakeCount: 3 } },
	],
	[
		"shell integration error",
		(s) => s.captureShellIntegrationError("t1"),
		{ event: E.SHELL_INTEGRATION_ERROR, properties: { taskId: "t1" } },
	],
	[
		"consecutive mistake error",
		(s) => s.captureConsecutiveMistakeError("t1"),
		{ event: E.CONSECUTIVE_MISTAKE_ERROR, properties: { taskId: "t1" } },
	],
	["tab shown", (s) => s.captureTabShown("settings"), { event: E.TAB_SHOWN, properties: { tab: "settings" } }],
	[
		"mode setting changed",
		(s) => s.captureModeSettingChanged("roleDefinition"),
		{ event: E.MODE_SETTINGS_CHANGED, properties: { settingName: "roleDefinition" } },
	],
	[
		"custom mode created",
		(s) => s.captureCustomModeCreated("slug", "Name"),
		{ event: E.CUSTOM_MODE_CREATED, properties: { modeSlug: "slug", modeName: "Name" } },
	],
	[
		"marketplace item installed without extra properties",
		(s) => s.captureMarketplaceItemInstalled("id", "mode", "Item", "project"),
		{
			event: E.MARKETPLACE_ITEM_INSTALLED,
			properties: { itemId: "id", itemType: "mode", itemName: "Item", target: "project" },
		},
	],
	[
		"marketplace item installed with extra properties",
		(s) => s.captureMarketplaceItemInstalled("id", "mcp", "Item", "global", { hasParameters: true }),
		{
			event: E.MARKETPLACE_ITEM_INSTALLED,
			properties: { itemId: "id", itemType: "mcp", itemName: "Item", target: "global", hasParameters: true },
		},
	],
	[
		"marketplace item removed",
		(s) => s.captureMarketplaceItemRemoved("id", "mode", "Item", "project"),
		{
			event: E.MARKETPLACE_ITEM_REMOVED,
			properties: { itemId: "id", itemType: "mode", itemName: "Item", target: "project" },
		},
	],
	[
		"title button clicked",
		(s) => s.captureTitleButtonClicked("plus"),
		{ event: E.TITLE_BUTTON_CLICKED, properties: { button: "plus" } },
	],
	[
		"telemetry settings changed",
		(s) => s.captureTelemetrySettingsChanged("enabled", "disabled"),
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

		service.captureToolUsage("t1", "read_file")

		expect(a.events).toEqual([{ event: E.TOOL_USED, properties: { taskId: "t1", tool: "read_file" } }])
		expect(b.events).toEqual(a.events)
	})

	it("drops events when no client is registered", () => {
		const service = new TelemetryService([])
		expect(() => service.captureTaskCreated("t1")).not.toThrow()
	})
})
