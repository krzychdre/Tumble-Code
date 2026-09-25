import { EventEmitter } from "events"
import * as path from "path"

import { beforeEach, describe, expect, it, vi } from "vitest"

import { RooCodeEventName, type OrganizationAllowList, type ProviderSettings } from "@roo-code/types"

import { Task } from "../../task/Task"
import { OrganizationAllowListViolationError } from "../../../utils/errors"
import { BackgroundTaskRunner, type BackgroundTaskHost } from "../BackgroundTaskRunner"

/**
 * CORE-R6 (d): the headless background-task runner (memory writers and
 * parallel subagents) as its own class. These tests pin today's behavior of
 * the code that lived in ClineProvider: the memory runner's retry
 * classification, and the start / complete / cancel / dispose ordering of a
 * background task. A user cancel must never wait on or trigger a memory
 * writer (see ai_plans/2026-07-11_fix-stop-button-memory-writers-on-cancel.md).
 */

const rm = vi.hoisted(() => vi.fn(async () => {}))
vi.mock("fs/promises", () => ({ default: { rm }, rm }))

vi.mock("../../../utils/storage", () => ({
	getTaskDirectoryPath: vi.fn(async (storage: string, taskId: string) => `${storage}/tasks/${taskId}`),
}))

const showInformationMessage = vi.hoisted(() => vi.fn())
vi.mock("vscode", () => ({ window: { showInformationMessage } }))

vi.mock("../../memory", () => ({
	memoryWriteSandbox: vi.fn((cwd: string) => ({ sandboxFor: cwd })),
	filterMemoryWrittenPaths: vi.fn((paths: ReadonlyArray<string>) => paths.filter((p) => !p.endsWith(".ts"))),
}))

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
	vi.mocked(Task).mockImplementation(((options: Record<string, any>) => {
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
	}) as never)
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
		activateProfile: vi.fn(),
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

describe("BackgroundTaskRunner.memorySubTaskRunner retry classification", () => {
	type Outcome = { completed: boolean; writtenPaths: string[]; abortReason?: string }

	/**
	 * Drives the real memory runner: every background task it creates ends
	 * with the outcome `outcomeFor(apiConfiguration)` returns.
	 */
	function runWith(opts: {
		writerProfile?: ProviderSettings
		outcomeFor: (apiConfiguration: ProviderSettings | undefined) => Outcome
		signal?: AbortSignal
	}) {
		const { host, postMessageToWebview, log } = makeHost({
			getMemoryWriterApiConfigId: vi.fn(() => (opts.writerProfile ? "writer" : undefined)),
			activateProfile: vi.fn(async () => ({ name: "writer", ...opts.writerProfile! })),
		})
		const runner = new BackgroundTaskRunner(host)
		const configs: Array<ProviderSettings | undefined> = []
		const created: Array<Record<string, unknown>> = []
		vi.spyOn(runner, "createBackgroundTask").mockImplementation(async (text, options) => {
			configs.push(options?.apiConfiguration)
			created.push({ text, ...options })
			return { options } as never
		})
		vi.spyOn(runner, "awaitTaskCompletion").mockImplementation(async (task) => {
			const outcome = opts.outcomeFor((task as unknown as FakeTask).options.apiConfiguration)
			return { lastMessage: undefined, ...outcome }
		})
		const result = runner.memorySubTaskRunner({
			cwd: "/mem",
			systemPrompt: "SYSTEM",
			userPrompt: "USER",
			maxTurns: 6,
			signal: opts.signal ?? new AbortController().signal,
		})
		return { result, configs, created, postMessageToWebview, log }
	}

	const WRITER: ProviderSettings = { apiProvider: "ollama", apiModelId: "small" }
	const aborted = () => {
		const controller = new AbortController()
		controller.abort()
		return controller.signal
	}

	it.each([
		{ name: "writer profile completes", writer: true, first: { completed: true }, attempts: 1 },
		{
			name: "writer profile streaming_failed",
			writer: true,
			first: { abortReason: "streaming_failed" },
			attempts: 2,
		},
		{
			name: "writer profile max_turns_reached",
			writer: true,
			first: { abortReason: "max_turns_reached" },
			attempts: 1,
		},
		{ name: "writer profile user_cancelled", writer: true, first: { abortReason: "user_cancelled" }, attempts: 1 },
		{ name: "writer profile unknown reason", writer: true, first: { abortReason: undefined }, attempts: 1 },
		{ name: "writer profile other reason", writer: true, first: { abortReason: "tool_error" }, attempts: 1 },
		{
			name: "writer profile streaming_failed after the signal aborted",
			writer: true,
			first: { abortReason: "streaming_failed" },
			signalAborted: true,
			attempts: 1,
		},
		{
			name: "no writer profile, streaming_failed",
			writer: false,
			first: { abortReason: "streaming_failed" },
			attempts: 1,
		},
		{ name: "no writer profile, completes", writer: false, first: { completed: true }, attempts: 1 },
	])("$name: $attempts attempt(s)", async ({ writer, first, signalAborted, attempts }) => {
		const { result, configs } = runWith({
			writerProfile: writer ? WRITER : undefined,
			signal: signalAborted ? aborted() : undefined,
			outcomeFor: (config) =>
				config === undefined && writer
					? { completed: true, writtenPaths: ["/mem/second.md", "/mem/shared.md"] }
					: {
							completed: first.completed ?? false,
							writtenPaths: ["/mem/first.md", "/mem/shared.md", "/mem/skip.ts"],
							abortReason: first.abortReason,
						},
		})

		const { writtenPaths } = await result

		expect(configs).toHaveLength(attempts)
		expect(configs[0]).toEqual(writer ? WRITER : undefined)
		if (attempts === 2) {
			// The retry runs on the foreground profile and reports the union.
			expect(configs[1]).toBeUndefined()
			expect(writtenPaths).toEqual(["/mem/first.md", "/mem/shared.md", "/mem/second.md"])
		} else {
			expect(writtenPaths).toEqual(["/mem/first.md", "/mem/shared.md"])
		}
	})

	it("spawns a write-sandboxed, silent, turn-capped code task in the memory directory", async () => {
		const { result, created } = runWith({ outcomeFor: () => ({ completed: true, writtenPaths: [] }) })
		await result
		expect(created).toEqual([
			{
				text: "SYSTEM\n\n---\n\nUSER",
				taskMode: "code",
				workspacePath: "/mem",
				maxAgentTurns: 6,
				autoApprovalOverride: { sandboxFor: "/mem" },
				silentWrites: true,
				apiConfiguration: undefined,
			},
		])
	})

	it("opens and closes the write-activity window around the run, even when it throws", async () => {
		const { host, postMessageToWebview } = makeHost()
		const runner = new BackgroundTaskRunner(host)
		vi.spyOn(runner, "createBackgroundTask").mockRejectedValue(new OrganizationAllowListViolationError("no"))

		await expect(
			runner.memorySubTaskRunner({
				cwd: "/mem",
				systemPrompt: "",
				userPrompt: "U",
				maxTurns: 1,
				signal: new AbortController().signal,
			}),
		).rejects.toBeInstanceOf(OrganizationAllowListViolationError)
		expect(postMessageToWebview.mock.calls).toEqual([
			[{ type: "memoryActivity", memoryActivity: { recall: 0, write: 1 } }],
			[{ type: "memoryActivity", memoryActivity: { recall: 0, write: 0 } }],
		])
		expect(runner.memoryActivity).toEqual({ recall: 0, write: 0 })
	})

	it("a stale writer profile falls back to the foreground profile and logs why", async () => {
		const { host, log } = makeHost({
			getMemoryWriterApiConfigId: vi.fn(() => "stale"),
			activateProfile: vi.fn(async () => {
				throw new Error("not found")
			}),
		})
		const runner = new BackgroundTaskRunner(host)
		const create = vi.spyOn(runner, "createBackgroundTask").mockResolvedValue({ options: {} } as never)
		vi.spyOn(runner, "awaitTaskCompletion").mockResolvedValue({ completed: true, writtenPaths: [] })

		await runner.memorySubTaskRunner({
			cwd: "/mem",
			systemPrompt: "",
			userPrompt: "U",
			maxTurns: 1,
			signal: new AbortController().signal,
		})

		expect(create.mock.calls[0][1]?.apiConfiguration).toBeUndefined()
		expect(log).toHaveBeenCalledWith(
			"[memorySubTaskRunner] failed to load writer profile stale, falling back to foreground: not found",
		)
	})

	// A background task that hits 401/403/404 ends as streaming_failed with a
	// failure message (TaskApiLoop fail-fast). The runner must settle, keep the
	// one foreground fallback for a writer profile, and log each failure once to
	// the output channel, with no toast.
	describe("a writer that fails fast on 401/403/404", () => {
		const FAILURE = 'API error 401 (invalid or missing API key) from provider "ollama", model "small".'

		async function run(writer: boolean) {
			const { host, log } = makeHost({
				getMemoryWriterApiConfigId: vi.fn(() => (writer ? "writer" : undefined)),
				activateProfile: vi.fn(async () => ({ name: "writer", ...WRITER })),
			})
			const runner = new BackgroundTaskRunner(host)
			const result = runner.memorySubTaskRunner({
				cwd: "/mem",
				systemPrompt: "",
				userPrompt: "U",
				maxTurns: 3,
				signal: new AbortController().signal,
			})
			const failTask = async (n: number) => {
				await vi.waitFor(() => expect(Task).toHaveBeenCalledTimes(n))
				const task = lastTask()
				task.abortReason = "streaming_failed"
				task.apiFailureMessage = FAILURE
				task.emit(RooCodeEventName.TaskAborted)
			}
			return { runner, result, log, failTask }
		}

		it("with a writer profile: one fallback run on the foreground profile, then it settles", async () => {
			const { runner, result, log, failTask } = await run(true)

			await failTask(1)
			await failTask(2)

			await expect(result).resolves.toMatchObject({ writtenPaths: expect.any(Array) })
			expect(Task).toHaveBeenCalledTimes(2)
			expect(vi.mocked(Task).mock.calls[0][0]).toMatchObject({ apiConfiguration: WRITER })
			expect(vi.mocked(Task).mock.calls[1][0]).toMatchObject({ apiConfiguration: ACTIVE })
			const failureLogs = log.mock.calls.filter(([line]) => String(line).includes(FAILURE))
			expect(failureLogs).toHaveLength(2)
			expect(showInformationMessage).not.toHaveBeenCalled()
			expect(runner.memoryActivity.write).toBe(0)
		})

		it("without a writer profile: one run, logged once, then it settles", async () => {
			const { result, log, failTask } = await run(false)

			await failTask(1)

			await expect(result).resolves.toMatchObject({ writtenPaths: expect.any(Array) })
			expect(Task).toHaveBeenCalledTimes(1)
			const failureLogs = log.mock.calls.filter(([line]) => String(line).includes(FAILURE))
			expect(failureLogs).toHaveLength(1)
			expect(showInformationMessage).not.toHaveBeenCalled()
		})
	})

	it("a user cancel of a running writer settles without a retry or a second task", async () => {
		const { host } = makeHost({
			getMemoryWriterApiConfigId: vi.fn(() => "writer"),
			activateProfile: vi.fn(async () => ({ name: "writer", ...WRITER })),
		})
		const runner = new BackgroundTaskRunner(host)
		const controller = new AbortController()

		const result = runner.memorySubTaskRunner({
			cwd: "/mem",
			systemPrompt: "",
			userPrompt: "U",
			maxTurns: 3,
			signal: controller.signal,
		})
		await vi.waitFor(() => expect(Task).toHaveBeenCalledTimes(1))
		const task = lastTask()
		controller.abort()
		// The cancel reaches the writer task at once (the drain never waits on it).
		expect(task.abortTask).toHaveBeenCalledTimes(1)
		task.abortReason = "streaming_failed"
		task.emit(RooCodeEventName.TaskAborted)

		await expect(result).resolves.toEqual({ writtenPaths: [path.resolve("/mem", "notes/a.md"), "/abs/b.md"] })
		expect(Task).toHaveBeenCalledTimes(1)
		expect(runner.memoryActivity.write).toBe(0)
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
