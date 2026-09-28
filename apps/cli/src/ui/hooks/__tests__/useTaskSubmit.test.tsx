import fs from "fs"
import os from "os"
import path from "path"

import { Text } from "ink"
import { render } from "ink-testing-library"
import type { WebviewMessage } from "@roo-code/types"

import {
	PERMISSIONS_COMMAND_USAGE,
	getPermissionSettings,
	getPermissionsCommandHelp,
	type PermissionMode,
} from "../../../lib/utils/permissions.js"
import { useCLIStore } from "../../store.js"
import { useUIStateStore } from "../../stores/uiStateStore.js"
import { useTaskSubmit, type UseTaskSubmitReturn } from "../useTaskSubmit.js"

describe("useTaskSubmit permission commands", () => {
	let api: UseTaskSubmitReturn
	let permissionMode: PermissionMode
	let sendToExtension: ReturnType<typeof vi.fn<(message: WebviewMessage) => void>>
	let runTask: ReturnType<typeof vi.fn<(prompt: string) => Promise<void>>>
	let onPermissionModeChange: ReturnType<typeof vi.fn<(mode: PermissionMode) => void>>

	function Harness() {
		api = useTaskSubmit({
			sendToExtension,
			runTask,
			resetTranscript: () => {},
			permissionMode,
			onPermissionModeChange,
		})
		return <Text>harness</Text>
	}

	beforeEach(() => {
		useCLIStore.getState().reset()
		permissionMode = "ask"
		sendToExtension = vi.fn()
		runTask = vi.fn(async () => undefined)
		onPermissionModeChange = vi.fn((mode: PermissionMode) => {
			permissionMode = mode
		})
		render(<Harness />)
	})

	it("shows the current mode and available options without changing settings or reaching the model", async () => {
		await api.handleSubmit("/permissions")

		expect(sendToExtension).not.toHaveBeenCalled()
		expect(onPermissionModeChange).not.toHaveBeenCalled()
		expect(runTask).not.toHaveBeenCalled()
		expect(useCLIStore.getState().messages).toMatchObject([
			{
				role: "system",
				content: getPermissionsCommandHelp("ask"),
			},
		])
	})

	it("enables auto-approval explicitly without starting or continuing a model turn", async () => {
		await api.handleSubmit("/permissions allow")

		expect(sendToExtension).toHaveBeenCalledOnce()
		expect(sendToExtension).toHaveBeenCalledWith({
			type: "updateSettings",
			updatedSettings: getPermissionSettings("allow"),
		})
		expect(onPermissionModeChange).toHaveBeenCalledWith("allow")
		expect(runTask).not.toHaveBeenCalled()
		expect(useCLIStore.getState().messages).toMatchObject([
			{
				role: "system",
				content: "Permissions: allowing actions without approval for this session.",
			},
		])
	})

	it("applies an explicit manual-approval mode even when a task already exists", async () => {
		permissionMode = "allow"
		useCLIStore.getState().setHasStartedTask(true)
		render(<Harness />)

		await api.handleSubmit("/permissions ask")

		expect(sendToExtension).toHaveBeenCalledWith({
			type: "updateSettings",
			updatedSettings: getPermissionSettings("ask"),
		})
		expect(onPermissionModeChange).toHaveBeenCalledWith("ask")
		expect(runTask).not.toHaveBeenCalled()
		expect(useCLIStore.getState().messages.at(-1)).toMatchObject({
			role: "system",
			content: "Permissions: asking before actions for this session.",
		})
	})

	it("shows usage for invalid arguments without changing settings or reaching the model", async () => {
		await api.handleSubmit("/permissions everything")

		expect(sendToExtension).not.toHaveBeenCalled()
		expect(onPermissionModeChange).not.toHaveBeenCalled()
		expect(runTask).not.toHaveBeenCalled()
		expect(useCLIStore.getState().messages).toMatchObject([{ role: "system", content: PERMISSIONS_COMMAND_USAGE }])
	})
})

describe("useTaskSubmit conversation commands", () => {
	let api: UseTaskSubmitReturn
	let sendToExtension: ReturnType<typeof vi.fn<(message: WebviewMessage) => void>>
	let runTask: ReturnType<typeof vi.fn<(prompt: string) => Promise<void>>>
	let resetTranscript: ReturnType<typeof vi.fn<() => void>>
	let frames: string[]

	function Harness() {
		api = useTaskSubmit({
			sendToExtension,
			runTask,
			resetTranscript,
			permissionMode: "ask",
			onPermissionModeChange: vi.fn(),
		})
		return <Text>harness</Text>
	}

	beforeEach(() => {
		useCLIStore.getState().reset()
		useUIStateStore.getState().resetUIState()
		sendToExtension = vi.fn()
		runTask = vi.fn(async () => undefined)
		resetTranscript = vi.fn()

		// Stand in for a conversation already in progress.
		useCLIStore.getState().setHasStartedTask(true)
		useCLIStore.getState().addMessage({ id: "m1", role: "user", content: "hello" })

		frames = render(<Harness />).frames
	})

	const expectConversationReset = () => {
		expect(useCLIStore.getState().messages).toEqual([])
		expect(useCLIStore.getState().hasStartedTask).toBe(false)
		expect(resetTranscript).toHaveBeenCalledTimes(1)
		expect(sendToExtension.mock.calls.map(([msg]) => msg.type)).toEqual([
			"clearTask",
			"requestCommands",
			"requestModes",
		])
		expect(runTask).not.toHaveBeenCalled()
	}

	describe("/mcp", () => {
		it("opens the MCP panel without touching the conversation, the extension or the model", async () => {
			await api.handleSubmit("/mcp")

			expect(useUIStateStore.getState().showMcpPanel).toBe(true)
			expect(useCLIStore.getState().messages).toHaveLength(1)
			expect(sendToExtension).not.toHaveBeenCalled()
			expect(runTask).not.toHaveBeenCalled()
		})
	})

	describe("/resume", () => {
		it("asks the prompt to open the task history picker, without touching the extension or the model", async () => {
			await api.handleSubmit("/resume")

			expect(useUIStateStore.getState().requestedInput).toBe("#")
			expect(sendToExtension).not.toHaveBeenCalled()
			expect(runTask).not.toHaveBeenCalled()
		})
	})

	describe("/clear", () => {
		it("drops the conversation and re-requests what the reset wiped", async () => {
			await api.handleSubmit("/clear")

			expectConversationReset()
		})

		it("wipes the screen and its scrollback", async () => {
			await api.handleSubmit("/clear")

			const written = frames.join("")
			expect(written).toContain("\x1b[2J")
			expect(written).toContain(process.platform === "win32" ? "\x1b[0f" : "\x1b[3J")
		})

		it("bumps the clear epoch so the banner prints again", async () => {
			await api.handleSubmit("/clear")

			expect(useUIStateStore.getState().transcriptClearEpoch).toBe(1)
		})

		it("wipes before resetting, so the reprinted banner survives", async () => {
			const order: string[] = []
			frames.push = ((...args: string[]) => {
				order.push("write")
				return Array.prototype.push.apply(frames, args)
			}) as typeof frames.push
			const unsubscribe = useCLIStore.subscribe(() => order.push("reset"))

			await api.handleSubmit("/clear")
			unsubscribe()

			expect(order.indexOf("write")).toBeLessThan(order.indexOf("reset"))
		})
	})

	describe("/new", () => {
		it("drops the conversation the same way", async () => {
			await api.handleSubmit("/new")

			expectConversationReset()
		})

		it("leaves the screen and the clear epoch alone", async () => {
			await api.handleSubmit("/new")

			expect(frames.join("")).not.toContain("\x1b[2J")
			expect(useUIStateStore.getState().transcriptClearEpoch).toBe(0)
		})
	})
})

// UI plan §4: /copy puts the last answer (or its last code block) on the
// clipboard with OSC 52; /export writes the transcript to a Markdown file.
describe("useTaskSubmit /copy and /export", () => {
	let api: UseTaskSubmitReturn
	let sendToExtension: ReturnType<typeof vi.fn<(message: WebviewMessage) => void>>
	let runTask: ReturnType<typeof vi.fn<(prompt: string) => Promise<void>>>
	let frames: string[]
	let workspace: string

	function Harness() {
		api = useTaskSubmit({
			sendToExtension,
			runTask,
			resetTranscript: () => {},
			permissionMode: "ask",
			onPermissionModeChange: vi.fn(),
			workspacePath: workspace,
		})
		return <Text>harness</Text>
	}

	const systemMessages = () =>
		useCLIStore
			.getState()
			.messages.filter((m) => m.role === "system")
			.map((m) => m.content)

	beforeEach(() => {
		workspace = fs.mkdtempSync(path.join(os.tmpdir(), "cli-export-test-"))
		useCLIStore.getState().reset()
		sendToExtension = vi.fn()
		runTask = vi.fn(async () => undefined)
		useCLIStore.getState().setHasStartedTask(true)
		useCLIStore.getState().addMessage({ id: "u1", role: "user", content: "Show the build command" })
		useCLIStore.getState().addMessage({ id: "a1", role: "assistant", content: "Use:\n```sh\npnpm build\n```" })
		frames = render(<Harness />).frames
	})

	afterEach(() => {
		fs.rmSync(workspace, { recursive: true, force: true })
	})

	it("/copy sends the last answer as OSC 52 and says how much was copied", async () => {
		await api.handleSubmit("/copy")

		const encoded = Buffer.from("Use:\n```sh\npnpm build\n```", "utf8").toString("base64")
		expect(frames.join("")).toContain(`]52;c;${encoded}`)
		expect(systemMessages().at(-1)).toMatch(/Copied the last answer/)
		expect(systemMessages().at(-1)).toContain("OSC 52")
		expect(sendToExtension).not.toHaveBeenCalled()
		expect(runTask).not.toHaveBeenCalled()
	})

	it("/copy code sends only the last code block", async () => {
		await api.handleSubmit("/copy code")

		expect(frames.join("")).toContain(`]52;c;${Buffer.from("pnpm build", "utf8").toString("base64")}`)
		expect(systemMessages().at(-1)).toMatch(/Copied the last code block/)
	})

	it("/copy with nothing to copy says so and writes no escape", async () => {
		useCLIStore.getState().reset()

		await api.handleSubmit("/copy")

		expect(frames.join("")).not.toContain("]52;")
		expect(systemMessages().at(-1)).toMatch(/nothing to copy/i)
	})

	it("/export writes the transcript as Markdown into the workspace and prints the path", async () => {
		await api.handleSubmit("/export")

		const files = fs.readdirSync(workspace).filter((name) => name.endsWith(".md"))
		expect(files).toHaveLength(1)
		const file = path.join(workspace, files[0]!)
		const markdown = fs.readFileSync(file, "utf8")
		expect(markdown).toContain("## You\n\nShow the build command")
		expect(markdown).toContain("pnpm build")
		expect(systemMessages().at(-1)).toContain(file)
		expect(runTask).not.toHaveBeenCalled()
	})

	it("/export <file> writes to that file relative to the workspace and never overwrites", async () => {
		await api.handleSubmit("/export notes/chat.md")

		const file = path.join(workspace, "notes", "chat.md")
		expect(fs.existsSync(file)).toBe(true)
		expect(systemMessages().at(-1)).toContain(file)

		await api.handleSubmit("/export notes/chat.md")
		expect(systemMessages().at(-1)).toMatch(/already exists/)
	})
})
