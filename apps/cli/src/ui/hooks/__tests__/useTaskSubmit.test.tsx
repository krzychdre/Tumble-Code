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
