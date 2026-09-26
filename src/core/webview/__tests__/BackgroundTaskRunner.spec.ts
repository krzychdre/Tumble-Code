import { EventEmitter } from "events"
import * as path from "path"

import { beforeEach, describe, expect, it, vi } from "vitest"

import { RooCodeEventName, type OrganizationAllowList, type ProviderSettings } from "@roo-code/types"

import { Task } from "../../task/Task"
import { OrganizationAllowListViolationError } from "../../../utils/errors"
import { BackgroundTaskRunner, type BackgroundTaskHost } from "../BackgroundTaskRunner"

/**
 * CORE-R6 (d): the headless background-task runner (parallel subagents) and
 * the memory writers' one-shot query as its own class. These tests pin the
 * memory query's profile choice and fallback, and the start / complete /
 * cancel / dispose ordering of a background task. A user cancel must never wait on or trigger a memory
 * writer (see ai_plans/2026-07-11_fix-stop-button-memory-writers-on-cancel.md).
 */

const rm = vi.hoisted(() => vi.fn(async () => {}))
vi.mock("fs/promises", () => ({ default: { rm }, rm }))

vi.mock("../../../utils/storage", () => ({
	getTaskDirectoryPath: vi.fn(async (storage: string, taskId: string) => `${storage}/tasks/${taskId}`),
}))

const showInformationMessage = vi.hoisted(() => vi.fn())
vi.mock("vscode", () => ({ window: { showInformationMessage } }))

const buildApiHandler = vi.hoisted(() => vi.fn())
vi.mock("../../../api", () => ({ buildApiHandler }))

const makeSideQuery = vi.hoisted(() => vi.fn())
vi.mock("../../memory/memoryTaskIntegration", () => ({ makeSideQuery }))

type FakeTask = EventEmitter & {
	taskId: string
	instanceId: string
	cwd: string
	options: Record<string, any>
	clineMessages: Array<{ type: string; say?: string; text?: string }>
	abortReason?: string
	apiFailureMessage?: string
	start: ReturnType<typeof vi.fn>
	abortTask: ReturnType<typeof vi.fn>
	fileContextTracker: { getAndClearCheckpointPossibleFile: ReturnType<typeof vi.fn> }
}

/** Every call into the fakes lands here, so tests can assert on the order. */
let events: string[] = []
let taskCounter = 0

vi.mock("../../task/Task", () => ({ Task: vi.fn() }))

function installTaskFake() {
	vi.mocked(Task).mockImplementation(function (options: Record<string, any>) {
		const emitter = new EventEmitter()
		const taskId = `bg-${++taskCounter}`
		const task = Object.assign(emitter, {
			taskId,
			instanceId: "1",
			cwd: options.workspacePath ?? "/work",
			options,
			clineMessages: [] as FakeTask["clineMessages"],
			abortReason: undefined as string | undefined,
			start: vi.fn(() => events.push(`start:${taskId}`)),
			abortTask: vi.fn(async (isAbandoned?: boolean) => {
				events.push(`abortTask:${taskId}:${isAbandoned === true}`)
			}),
			fileContextTracker: {
				getAndClearCheckpointPossibleFile: vi.fn(() => {
					events.push(`collectWrittenPaths:${taskId}`)
					return ["notes/a.md", "/abs/b.md"]
				}),
			},
		})
		return task
	} as never)
}

const ALLOW_ALL: OrganizationAllowList = { allowAll: true, providers: {} }
const ACTIVE: ProviderSettings = { apiProvider: "anthropic", apiModelId: "claude", consecutiveMistakeLimit: 3 }

function makeHost(overrides: Partial<BackgroundTaskHost> = {}) {
	const register = vi.fn((summary: { taskId: string }) => events.push(`register:${summary.taskId}`))
	const postMessageToWebview = vi.fn(async () => {})
	const log = vi.fn()
	const provider = { name: "provider" }
	const onCreated = vi.fn()
	const host: BackgroundTaskHost = {
		provider: provider as never,
		globalStoragePath: "/storage",
		subagentRegistry: { register },
		taskCreationCallback: onCreated,
		getState: vi.fn(async () => ({
			apiConfiguration: ACTIVE,
			currentApiConfigName: "active",
			experiments: {},
			organizationAllowList: ALLOW_ALL,
			mode: "code",
		})),
		getApiConfigurationForMode: vi.fn(async () => undefined),
		getMemoryWriterApiConfigId: vi.fn(() => undefined),
		getProfile: vi.fn(),
		postMessageToWebview,
		log,
		...overrides,
	}
	return { host, register, postMessageToWebview, log, provider, onCreated }
}

function lastTask(): FakeTask {
	const results = vi.mocked(Task).mock.results
	return results[results.length - 1].value as FakeTask
}

beforeEach(() => {
	vi.mocked(Task).mockReset()
	installTaskFake()
	events = []
	rm.mockClear()
	showInformationMessage.mockClear()
})

describe("BackgroundTaskRunner.createBackgroundTask", () => {
	it("builds a headless task and registers it before starting it", async () => {
		const { host, provider, onCreated, register } = makeHost()
		const runner = new BackgroundTaskRunner(host)

		const task = (await runner.createBackgroundTask("extract", {
			taskMode: "code",
			workspacePath: "/mem",
			maxAgentTurns: 4,
			silentWrites: true,
		})) as unknown as FakeTask

		expect(task.options).toMatchObject({
			provider,
			apiConfiguration: ACTIVE,
			consecutiveMistakeLimit: 3,
			enableCheckpoints: false,
			experiments: {},
			task: "extract",
			taskMode: "code",
			workspacePath: "/mem",
			isBackground: true,
			maxAgentTurns: 4,
			silentWrites: true,
			startTask: false,
			onCreated,
		})
		expect(runner.getBackgroundTask(task.taskId)).toBe(task)
		// A memory writer (no subagentInfo) stays invisible in the panel.
		expect(register).not.toHaveBeenCalled()
		expect(task.start).toHaveBeenCalledTimes(1)
	})

	it("registers a subagent in the panel before start(), with the mode-pinned profile name", async () => {
		const pinned: ProviderSettings = { apiProvider: "anthropic", apiModelId: "pinned" }
		const { host, register } = makeHost({
			getApiConfigurationForMode: vi.fn(async () => ({ apiConfiguration: pinned, name: "pinned-profile" })),
		})
		const runner = new BackgroundTaskRunner(host)

		const task = (await runner.createBackgroundTask("work", {
			taskMode: "ask",
			subagentInfo: { parentTaskId: "parent", index: 2, description: "part two" },
		})) as unknown as FakeTask

		expect(events).toEqual([`register:${task.taskId}`, `start:${task.taskId}`])
		expect(register).toHaveBeenCalledWith(
			expect.objectContaining({
				taskId: task.taskId,
				parentTaskId: "parent",
				index: 2,
				mode: "ask",
				description: "part two",
				status: "running",
				apiConfigName: "pinned-profile",
			}),
		)
		expect(task.options.apiConfiguration).toBe(pinned)
	})

	it("skips the mode binding for an explicit profile and for tasks without subagentInfo", async () => {
		const { host } = makeHost()
		const runner = new BackgroundTaskRunner(host)
		const explicit: ProviderSettings = { apiProvider: "ollama" }

		await runner.createBackgroundTask("a", { taskMode: "code", apiConfiguration: explicit })
		expect(lastTask().options.apiConfiguration).toBe(explicit)
		await runner.createBackgroundTask("b", { taskMode: "code" })
		expect(lastTask().options.apiConfiguration).toBe(ACTIVE)
		expect(host.getApiConfigurationForMode).not.toHaveBeenCalled()
	})

	it("refuses a profile outside the organization allow list before creating anything", async () => {
		const { host, register } = makeHost({
			getState: vi.fn(async () => ({
				apiConfiguration: { apiProvider: "openrouter" } as ProviderSettings,
				currentApiConfigName: "active",
				experiments: {},
				organizationAllowList: { allowAll: false, providers: { anthropic: { allowAll: true } } },
				mode: "code",
			})),
		})
		const runner = new BackgroundTaskRunner(host)

		await expect(
			runner.createBackgroundTask("x", { subagentInfo: { parentTaskId: "p", index: 0, description: "x" } }),
		).rejects.toBeInstanceOf(OrganizationAllowListViolationError)
		expect(Task).not.toHaveBeenCalled()
		expect(register).not.toHaveBeenCalled()
	})
})

describe("BackgroundTaskRunner.awaitTaskCompletion ordering", () => {
	async function started(runner: BackgroundTaskRunner) {
		return (await runner.createBackgroundTask("work", { workspacePath: "/work" })) as unknown as FakeTask
	}

	it("complete: collects written paths, de-registers, disposes, then deletes the task directory", async () => {
		const runner = new BackgroundTaskRunner(makeHost().host)
		const task = await started(runner)
		task.clineMessages.push(
			{ type: "say", say: "completion_result", text: "first" },
			{ type: "say", say: "text", text: "between" },
			{ type: "say", say: "completion_result", text: "saved 2" },
		)
		const pending = runner.awaitTaskCompletion(task as never)

		task.emit(RooCodeEventName.TaskCompleted)

		await expect(pending).resolves.toEqual({
			completed: true,
			lastMessage: "saved 2",
			writtenPaths: [path.resolve("/work", "notes/a.md"), "/abs/b.md"],
		})
		expect(runner.getBackgroundTask(task.taskId)).toBeUndefined()
		await vi.waitFor(() => expect(rm).toHaveBeenCalledWith(`/storage/tasks/${task.taskId}`, expect.anything()))
		expect(rm).toHaveBeenCalledWith(`/storage/tasks/${task.taskId}`, { recursive: true, force: true })
		expect(events).toEqual([
			`start:${task.taskId}`,
			`collectWrittenPaths:${task.taskId}`,
			`abortTask:${task.taskId}:true`,
		])
	})

	it("abort: reports the abort reason, keeps the directory and does not dispose again", async () => {
		const runner = new BackgroundTaskRunner(makeHost().host)
		const task = await started(runner)
		const pending = runner.awaitTaskCompletion(task as never)

		task.abortReason = "max_turns_reached"
		task.emit(RooCodeEventName.TaskAborted)

		await expect(pending).resolves.toMatchObject({ completed: false, abortReason: "max_turns_reached" })
		expect(runner.getBackgroundTask(task.taskId)).toBeUndefined()
		await new Promise((resolve) => setTimeout(resolve, 0))
		expect(task.abortTask).not.toHaveBeenCalled()
		expect(rm).not.toHaveBeenCalled()
	})

	it.each([
		["a 401", 'API error 401 (invalid or missing API key) from provider "anthropic".'],
		["exhausted retries", 'API error 500 from provider "anthropic" after 7 attempts.'],
	])("abort after %s: reports the task's failure message", async (_label, failureMessage) => {
		const runner = new BackgroundTaskRunner(makeHost().host)
		const task = await started(runner)
		const pending = runner.awaitTaskCompletion(task as never)

		task.abortReason = "streaming_failed"
		task.apiFailureMessage = failureMessage
		task.emit(RooCodeEventName.TaskAborted)

		await expect(pending).resolves.toMatchObject({
			completed: false,
			abortReason: "streaming_failed",
			failureMessage,
		})
	})

	it("cancel: the signal aborts the task (not abandoned) and the first terminal event wins", async () => {
		const runner = new BackgroundTaskRunner(makeHost().host)
		const task = await started(runner)
		const controller = new AbortController()
		const pending = runner.awaitTaskCompletion(task as never, { signal: controller.signal })

		controller.abort()
		expect(task.abortTask).toHaveBeenCalledWith()
		task.abortReason = "user_cancelled"
		task.emit(RooCodeEventName.TaskAborted)
		task.emit(RooCodeEventName.TaskCompleted)

		await expect(pending).resolves.toMatchObject({ completed: false, abortReason: "user_cancelled" })
		expect(task.abortTask).toHaveBeenCalledTimes(1)
		expect(task.listenerCount(RooCodeEventName.TaskCompleted)).toBe(0)
		expect(task.listenerCount(RooCodeEventName.TaskAborted)).toBe(0)
	})

	it("an already aborted signal aborts the task at once", async () => {
		const runner = new BackgroundTaskRunner(makeHost().host)
		const task = await started(runner)
		const controller = new AbortController()
		controller.abort()

		void runner.awaitTaskCompletion(task as never, { signal: controller.signal })

		expect(task.abortTask).toHaveBeenCalledTimes(1)
	})

	it("a failing directory cleanup is logged, never thrown", async () => {
		const { host, log } = makeHost()
		const runner = new BackgroundTaskRunner(host)
		rm.mockRejectedValueOnce(new Error("EBUSY"))
		const task = await started(runner)
		const pending = runner.awaitTaskCompletion(task as never)

		task.emit(RooCodeEventName.TaskCompleted)

		await expect(pending).resolves.toMatchObject({ completed: true })
		await vi.waitFor(() =>
			expect(log).toHaveBeenCalledWith(
				`[cleanupBackgroundTaskFiles] failed to remove task directory for ${task.taskId}: EBUSY`,
			),
		)
	})
})

describe("BackgroundTaskRunner.memoryWriterQuery", () => {
	const WRITER: ProviderSettings = { apiProvider: "ollama", apiModelId: "small" }

	/**
	 * Every handler built for a query answers through `answerFor(config)`;
	 * returns the configs the calls ran on, in order.
	 */
	function queryWith(opts: {
		writerProfile?: ProviderSettings
		answerFor: (config: ProviderSettings) => Promise<string>
		noSingleCompletion?: boolean
	}) {
		const { host, postMessageToWebview, log } = makeHost({
			getMemoryWriterApiConfigId: vi.fn(() => (opts.writerProfile ? "writer" : undefined)),
			getProfile: vi.fn(async () => ({ name: "writer", ...opts.writerProfile! })),
		})
		const configs: ProviderSettings[] = []
		const disposed: ProviderSettings[] = []
		buildApiHandler.mockImplementation((config: ProviderSettings) => ({
			config,
			dispose: () => disposed.push(config),
		}))
		makeSideQuery.mockImplementation((handler: { config: ProviderSettings }) =>
			opts.noSingleCompletion
				? undefined
				: async () => {
						configs.push(handler.config)
						return opts.answerFor(handler.config)
					},
		)
		const runner = new BackgroundTaskRunner(host)
		return {
			query: runner.memoryWriterQuery(ACTIVE, "task-1"),
			runner,
			configs,
			disposed,
			postMessageToWebview,
			log,
		}
	}

	it("asks one completion on the writer profile and never creates a Task", async () => {
		const { query, configs, disposed } = queryWith({ writerProfile: WRITER, answerFor: async () => "NONE" })
		await expect(query("S", "U", new AbortController().signal)).resolves.toBe("NONE")
		expect(configs).toEqual([WRITER])
		expect(disposed).toEqual([WRITER])
		expect(Task).not.toHaveBeenCalled()
	})

	it("without a writer profile, asks on the finishing task's profile", async () => {
		const { query, configs } = queryWith({ answerFor: async () => "NONE" })
		await query("S", "U", new AbortController().signal)
		expect(configs).toEqual([ACTIVE])
	})

	it("a failing writer profile is retried once on the foreground profile, and logged", async () => {
		const { query, configs, log } = queryWith({
			writerProfile: WRITER,
			answerFor: async (config) => {
				if (config.apiModelId === WRITER.apiModelId) throw new Error("connection refused")
				return "KEEP"
			},
		})
		await expect(query("S", "U", new AbortController().signal)).resolves.toBe("KEEP")
		expect(configs).toEqual([WRITER, ACTIVE])
		expect(log).toHaveBeenCalledWith(
			"[memoryWriterQuery] memory writer profile failed, retrying on foreground: connection refused",
		)
	})

	it("a cancelled call is never retried", async () => {
		const controller = new AbortController()
		const { query, configs } = queryWith({
			writerProfile: WRITER,
			answerFor: async () => {
				controller.abort()
				throw new Error("aborted")
			},
		})
		await expect(query("S", "U", controller.signal)).rejects.toThrow("aborted")
		expect(configs).toEqual([WRITER])
	})

	it("a provider without single completions fails the call instead of hanging", async () => {
		const { query } = queryWith({ answerFor: async () => "", noSingleCompletion: true })
		await expect(query("S", "U", new AbortController().signal)).rejects.toThrow("no single-completion support")
	})

	it("opens and closes the write-activity window around the call, even when it throws", async () => {
		const { query, runner, postMessageToWebview } = queryWith({
			answerFor: async () => {
				throw new Error("boom")
			},
		})
		await expect(query("S", "U", new AbortController().signal)).rejects.toThrow("boom")
		expect(postMessageToWebview.mock.calls).toEqual([
			[{ type: "memoryActivity", memoryActivity: { recall: 0, write: 1 } }],
			[{ type: "memoryActivity", memoryActivity: { recall: 0, write: 0 } }],
		])
		expect(runner.memoryActivity).toEqual({ recall: 0, write: 0 })
	})

	it("a stale writer profile falls back to the foreground profile and logs why", async () => {
		const { host, log } = makeHost({
			getMemoryWriterApiConfigId: vi.fn(() => "stale"),
			getProfile: vi.fn(async () => {
				throw new Error("not found")
			}),
		})
		const configs: ProviderSettings[] = []
		buildApiHandler.mockImplementation((config: ProviderSettings) => ({ config }))
		makeSideQuery.mockImplementation((handler: { config: ProviderSettings }) => async () => {
			configs.push(handler.config)
			return "NONE"
		})
		await new BackgroundTaskRunner(host).memoryWriterQuery(ACTIVE)("S", "U", new AbortController().signal)
		expect(configs).toEqual([ACTIVE])
		expect(log).toHaveBeenCalledWith(
			"[memoryWriterQuery] failed to load writer profile stale, falling back to foreground: not found",
		)
	})
})

describe("BackgroundTaskRunner memory activity and outcome toasts", () => {
	it("counts overlapping windows and never goes below zero", () => {
		const { host, postMessageToWebview } = makeHost()
		const runner = new BackgroundTaskRunner(host)

		runner.setMemoryActivity("recall", true)
		runner.setMemoryActivity("recall", true)
		runner.setMemoryActivity("write", false)
		runner.setMemoryActivity("recall", false)

		expect(runner.memoryActivity).toEqual({ recall: 1, write: 0 })
		expect(postMessageToWebview).toHaveBeenLastCalledWith({
			type: "memoryActivity",
			memoryActivity: { recall: 1, write: 0 },
		})
	})

	it("shows background outcomes as an information toast", () => {
		const runner = new BackgroundTaskRunner(makeHost().host)
		runner.notifyBackgroundOutcome("saved 2 memories")
		expect(showInformationMessage).toHaveBeenCalledWith("saved 2 memories")
	})
})
