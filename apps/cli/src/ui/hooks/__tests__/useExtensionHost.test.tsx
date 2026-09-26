import { EventEmitter } from "events"

import { Text } from "ink"
import { render } from "ink-testing-library"
import pWaitFor from "p-wait-for"

import type { ExtensionHostInterface, ExtensionHostOptions } from "@/agent/index.js"
import { TranscriptReader, type TranscriptSink } from "@/agent/transcript-reader.js"

import { useCLIStore } from "../../store.js"
import { useExtensionHost } from "../useExtensionHost.js"

const sink: TranscriptSink = {
	view: () => ({ messages: [], isLoading: false, isResumingTask: false, currentTodos: [] }),
	nonInteractive: () => false,
	apply: () => {},
}

describe("useExtensionHost", () => {
	beforeEach(() => {
		useCLIStore.getState().reset()
	})

	it("hands every host option to the extension host, with output disabled", async () => {
		const options: ExtensionHostOptions = {
			mode: "architect",
			reasoningEffort: "high",
			consecutiveMistakeLimit: 3,
			user: null,
			provider: "openai",
			apiKey: "1111",
			model: "GLM-5.3-Flash-NVFP4",
			baseUrl: "http://192.168.50.194:11111/v1",
			modeProviderSettings: { base: { apiProvider: "openai" }, modes: {} },
			workspacePath: "/tmp/ws",
			extensionPath: "/tmp/ext",
			nonInteractive: true,
			ephemeral: false,
			debug: false,
			exitOnComplete: false,
			terminalShell: "/bin/zsh",
			exitOnError: true,
		}

		const createExtensionHost = vi.fn((_options: ExtensionHostOptions) => {
			const host = {
				on: vi.fn(),
				client: { on: vi.fn(), transcript: { attach: vi.fn(() => () => {}) } },
				activate: vi.fn(async () => {}),
				sendToExtension: vi.fn(),
			}
			return host as unknown as ExtensionHostInterface
		})

		function Harness() {
			useExtensionHost({ ...options, transcript: sink, createExtensionHost })
			return <Text>harness</Text>
		}

		render(<Harness />)
		await pWaitFor(() => createExtensionHost.mock.calls.length > 0, { timeout: 2000 })

		expect(createExtensionHost).toHaveBeenCalledWith({ ...options, disableOutput: true })
	})
})

describe("useExtensionHost task completion", () => {
	const options: ExtensionHostOptions = {
		mode: "code",
		user: null,
		provider: "openai",
		model: "m",
		workspacePath: "/tmp/ws",
		extensionPath: "/tmp/ext",
		nonInteractive: false,
		ephemeral: true,
		debug: false,
		exitOnComplete: true,
	}

	beforeEach(() => {
		useCLIStore.getState().reset()
	})

	async function mount() {
		const client = Object.assign(new EventEmitter(), { transcript: new TranscriptReader() })
		const dispose = vi.fn(async () => {})
		const host = {
			on: vi.fn(),
			client,
			activate: vi.fn(async () => {}),
			sendToExtension: vi.fn(),
			dispose,
		}
		const createExtensionHost = vi.fn(() => host as unknown as ExtensionHostInterface)

		function Harness() {
			useExtensionHost({ ...options, transcript: sink, createExtensionHost })
			return <Text>harness</Text>
		}

		render(<Harness />)
		await pWaitFor(() => host.activate.mock.calls.length > 0, { timeout: 2000 })
		return { client, dispose }
	}

	// The client reports `taskCompleted` for `resume_completed_task` too (the
	// ask the core shows when a finished task is opened again), see the
	// ExtensionClient spec. That is a task waiting for the next message, not a
	// task that just finished, so --oneshot must not end the session there.
	it("does not exit with --oneshot when a completed task is resumed", async () => {
		const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never)
		const { client, dispose } = await mount()

		client.emit("taskCompleted", {
			success: true,
			message: { ts: 1, type: "ask", ask: "resume_completed_task", text: "" },
			stateInfo: {},
		})
		await new Promise((resolve) => setTimeout(resolve, 150))

		expect(dispose).not.toHaveBeenCalled()
		expect(exit).not.toHaveBeenCalled()
		expect(useCLIStore.getState().isLoading).toBe(false)
		exit.mockRestore()
	})

	it("exits with --oneshot when the task completes", async () => {
		const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never)
		const { client, dispose } = await mount()

		client.emit("taskCompleted", {
			success: true,
			message: { ts: 1, type: "ask", ask: "completion_result", text: "" },
			stateInfo: {},
		})
		// The hook calls process.exit 100 ms after ink's exit(). Under
		// ink-testing-library ink 7 spends more time around that (its fake stdout
		// has no rows, so every layout asks terminal-size, which probes /dev/tty
		// and may run tput), so wait for the call instead of a fixed 150 ms.
		await pWaitFor(() => exit.mock.calls.length > 0, { timeout: 2000 })

		expect(dispose).toHaveBeenCalled()
		expect(exit).toHaveBeenCalledWith(0)
		exit.mockRestore()
	})
})
