// cd src && ./node_modules/.bin/vitest run core/task/__tests__/ApiRequestBuilder.rooignore.spec.ts

import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"

import { RooIgnoreController } from "../../ignore/RooIgnoreController"
import { TaskApiLoop, type TaskApiLoopAccess } from "../TaskApiLoop"
import { generateSystemPrompt } from "../../webview/generateSystemPrompt"
import type { ClineProvider } from "../../webview/ClineProvider"

const systemPromptMock = vi.hoisted(() => vi.fn().mockResolvedValue("system prompt"))
vi.mock("../../prompts/system", () => ({ SYSTEM_PROMPT: systemPromptMock }))

// The preview builds a throwaway handler only to read `isStealthModel`.
vi.mock("../../../api", () => ({
	buildApiHandler: () => ({ getModel: () => ({ id: "m", info: {} }) }),
}))

// The shared vscode mock has no RelativePattern, which RooIgnoreController needs for its watcher.
vi.mock("vscode", async (importOriginal) => {
	const actual = await importOriginal<typeof import("vscode")>()
	return {
		...actual,
		RelativePattern: vi.fn().mockImplementation((base: string, pattern: string) => ({ base, pattern })),
	}
})

// SYSTEM_PROMPT(context, cwd, supportsComputerUse, mcpHub, diffStrategy, mode, customModePrompts,
//   customModes, customInstructions, experiments, language, rooIgnoreInstructions, ...)
const ROO_IGNORE_ARG = 11

/**
 * DEF-C1: the live system prompt lost the `.rooignore` section on 2026-05-05 (commit fcdd9bf35
 * moved prompt building into ApiRequestBuilder and left `rooIgnoreInstructions = undefined`),
 * while the "copy system prompt" preview kept passing it. These tests pin that the live prompt
 * carries the section again and that preview and live prompt receive the same value.
 */
describe("ApiRequestBuilder .rooignore instructions (DEF-C1)", () => {
	let cwd: string
	let controller: RooIgnoreController

	beforeEach(async () => {
		systemPromptMock.mockClear()
		cwd = await fs.mkdtemp(path.join(os.tmpdir(), "rooignore-live-prompt-"))
		await fs.writeFile(path.join(cwd, ".rooignore"), "secrets/\n*.env\n")
		controller = new RooIgnoreController(cwd)
		await controller.initialize()
	})

	afterEach(async () => {
		controller.dispose()
		await fs.rm(cwd, { recursive: true, force: true })
	})

	function makeTask(provider: unknown) {
		// The Task hands itself to TaskApiLoop as its access object (Task.ts `new TaskApiLoop(this)`).
		return {
			taskId: "task-1",
			instanceId: "instance-1",
			isBackground: false,
			apiConfiguration: {},
			api: { getModel: () => ({ id: "m", info: {} }) },
			apiConversationHistory: [],
			microcompactedToolUseIds: new Set<string>(),
			providerRef: { deref: () => provider },
			cwd,
			contextManager: {},
			getTokenUsage: () => ({}),
			getTaskMode: vi.fn().mockResolvedValue("code"),
			emit: vi.fn(),
			materializedDeferredTools: new Set<string>(),
			deferredToolDirectory: new Map(),
			rooIgnoreController: controller as RooIgnoreController | undefined,
		}
	}

	function makeProvider() {
		const provider = {
			getState: vi.fn().mockResolvedValue({ mode: "code", mcpEnabled: false, apiConfiguration: {} }),
			context: {},
			cwd: "",
			getSkillsManager: vi.fn().mockReturnValue(undefined),
			customModesManager: { getCustomModes: vi.fn().mockResolvedValue([]) },
			getMcpHub: vi.fn().mockReturnValue(undefined),
			getCurrentTask: vi.fn(),
		}
		return provider
	}

	it("passes the .rooignore instructions to the live system prompt", async () => {
		const provider = makeProvider()
		const task = makeTask(provider)
		const loop = new TaskApiLoop(task as unknown as TaskApiLoopAccess)

		await loop.getSystemPrompt()

		expect(systemPromptMock).toHaveBeenCalledTimes(1)
		const live = systemPromptMock.mock.calls[0][ROO_IGNORE_ARG]
		expect(live).toBe(controller.getInstructions())
		expect(live).toContain("# .rooignore")
		expect(live).toContain("secrets/")
		expect(live).toContain("*.env")
	})

	it("gives the preview and the live prompt the same .rooignore instructions", async () => {
		const provider = makeProvider()
		provider.cwd = cwd
		const task = makeTask(provider)
		provider.getCurrentTask.mockReturnValue(task)
		const loop = new TaskApiLoop(task as unknown as TaskApiLoopAccess)

		await generateSystemPrompt(provider as unknown as ClineProvider, { type: "getSystemPrompt", mode: "code" })
		await loop.getSystemPrompt()

		expect(systemPromptMock).toHaveBeenCalledTimes(2)
		const preview = systemPromptMock.mock.calls[0][ROO_IGNORE_ARG]
		const live = systemPromptMock.mock.calls[1][ROO_IGNORE_ARG]
		expect(preview).toBeDefined()
		expect(live).toBe(preview)
	})

	it("reads the task's controller at request time, not when the loop was built", async () => {
		const provider = makeProvider()
		const task = makeTask(provider)
		task.rooIgnoreController = undefined
		const loop = new TaskApiLoop(task as unknown as TaskApiLoopAccess)

		await loop.getSystemPrompt()
		expect(systemPromptMock.mock.calls[0][ROO_IGNORE_ARG]).toBeUndefined()

		task.rooIgnoreController = controller
		await loop.getSystemPrompt()
		expect(systemPromptMock.mock.calls[1][ROO_IGNORE_ARG]).toBe(controller.getInstructions())
	})
})
