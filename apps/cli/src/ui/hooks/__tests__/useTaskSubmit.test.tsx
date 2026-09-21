import { Text } from "ink"
import { render } from "ink-testing-library"
import { createRef } from "react"
import type { WebviewMessage } from "@roo-code/types"

import {
	PERMISSIONS_COMMAND_USAGE,
	getPermissionSettings,
	getPermissionsCommandHelp,
	type PermissionMode,
} from "../../../lib/utils/permissions.js"
import { useCLIStore } from "../../store.js"
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
			seenMessageIds: createRef<Set<string>>() as React.MutableRefObject<Set<string>>,
			firstTextMessageSkipped: createRef<boolean>() as React.MutableRefObject<boolean>,
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
