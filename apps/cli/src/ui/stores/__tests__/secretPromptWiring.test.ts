import { setInputBoxHandler, createVSCodeAPI } from "@roo-code/vscode-shim"

import { useSecretPromptStore } from "../secretPromptStore.js"

/**
 * The link between the core and the interface.
 *
 * A command with no terminal asks through `window.showInputBox` in the core
 * (see promptForSecret in the terminal integration). In the CLI that call lands
 * in the vscode shim, and this is what makes it reach a person: App registers a
 * handler that puts the question in the store, the dialog reads it from there,
 * and the answer travels back down the same promise.
 */
describe("showInputBox reaching the CLI prompt", () => {
	const vscode = createVSCodeAPI(process.cwd(), process.cwd())

	beforeEach(() => {
		// Exactly what App.tsx registers on mount.
		setInputBoxHandler(async (options) =>
			useSecretPromptStore.getState().ask({
				title: options.title,
				prompt: options.prompt ?? "",
				masked: options.password !== false,
			}),
		)
	})

	afterEach(() => {
		setInputBoxHandler(undefined)
		useSecretPromptStore.getState().cancelAll()
	})

	it("turns a core-side input box into a masked prompt and returns the answer", async () => {
		const asked = vscode.window.showInputBox({
			title: "The command needs an answer: git clone https://github.com/x/y.git",
			prompt: "Password for 'https://github.com':",
			password: true,
		})

		// Give the handler a turn to reach the store.
		await Promise.resolve()

		const current = useSecretPromptStore.getState().current
		expect(current?.prompt).toBe("Password for 'https://github.com':")
		expect(current?.masked).toBe(true)

		useSecretPromptStore.getState().answer("hunter2")

		await expect(asked).resolves.toBe("hunter2")
	})

	it("passes a refusal back as undefined so the command stops waiting", async () => {
		const asked = vscode.window.showInputBox({ prompt: "Password:", password: true })
		await Promise.resolve()

		useSecretPromptStore.getState().cancel()

		await expect(asked).resolves.toBeUndefined()
	})

	it("keeps a non-secret question unmasked", async () => {
		const asked = vscode.window.showInputBox({
			prompt: "Are you sure you want to continue connecting (yes/no)?",
			password: false,
		})
		await Promise.resolve()

		expect(useSecretPromptStore.getState().current?.masked).toBe(false)

		useSecretPromptStore.getState().answer("yes")
		await expect(asked).resolves.toBe("yes")
	})

	it("answers nothing when no interface is listening, which is what a headless run needs", async () => {
		setInputBoxHandler(undefined)

		// The shim's own default: a command that asks for a password in a
		// headless run fails instead of waiting for someone who is not there.
		await expect(vscode.window.showInputBox({ prompt: "Password:" })).resolves.toBe("")
		expect(useSecretPromptStore.getState().current).toBeNull()
	})
})
