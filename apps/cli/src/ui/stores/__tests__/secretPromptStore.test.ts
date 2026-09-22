import { useSecretPromptStore } from "../secretPromptStore.js"

describe("secretPromptStore", () => {
	afterEach(() => {
		useSecretPromptStore.getState().cancelAll()
	})

	it("shows the question and resolves the waiting command with the answer", async () => {
		const asked = useSecretPromptStore.getState().ask({ prompt: "Password:", masked: true })

		expect(useSecretPromptStore.getState().current?.prompt).toBe("Password:")

		useSecretPromptStore.getState().answer("hunter2")

		await expect(asked).resolves.toBe("hunter2")
		// Nothing left waiting, so the interface goes back to normal.
		expect(useSecretPromptStore.getState().current).toBeNull()
	})

	it("resolves with undefined when the user refuses, which fails the command", async () => {
		const asked = useSecretPromptStore.getState().ask({ prompt: "Password:", masked: true })

		useSecretPromptStore.getState().cancel()

		await expect(asked).resolves.toBeUndefined()
	})

	it("queues a second question instead of replacing the one on screen", async () => {
		const store = useSecretPromptStore.getState()
		// This is git: the username first, then the password for that username.
		const username = store.ask({ prompt: "Username:", masked: false })
		const password = store.ask({ prompt: "Password:", masked: true })

		expect(useSecretPromptStore.getState().current?.prompt).toBe("Username:")

		useSecretPromptStore.getState().answer("krzych")
		await expect(username).resolves.toBe("krzych")

		expect(useSecretPromptStore.getState().current?.prompt).toBe("Password:")
		expect(useSecretPromptStore.getState().current?.masked).toBe(true)

		useSecretPromptStore.getState().answer("hunter2")
		await expect(password).resolves.toBe("hunter2")
	})

	it("releases everything outstanding when the interface goes away", async () => {
		const store = useSecretPromptStore.getState()
		const first = store.ask({ prompt: "Username:", masked: false })
		const second = store.ask({ prompt: "Password:", masked: true })

		useSecretPromptStore.getState().cancelAll()

		// Both commands stop waiting rather than hanging on a prompt nobody can
		// answer any more.
		await expect(first).resolves.toBeUndefined()
		await expect(second).resolves.toBeUndefined()
		expect(useSecretPromptStore.getState().current).toBeNull()
	})
})
