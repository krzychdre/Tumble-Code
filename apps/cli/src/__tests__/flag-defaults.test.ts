/**
 * The commander option table in index.ts must not register defaults for
 * options that also live in ~/.roo/cli-settings.json. Commander fills a
 * registered default in even when the user passed no flag, so run() could not
 * tell "not given" from "given" and the settings value was shadowed on every
 * run (`mode: "architect"` in the file still started in code, a persisted
 * `reasoningEffort` was always replaced by medium).
 */

const mockRun = vi.hoisted(() => vi.fn())

vi.mock("@/commands/index.js", () => ({
	run: mockRun,
	login: vi.fn(),
	logout: vi.fn(),
	status: vi.fn(),
	loginToOpenAiCodex: vi.fn(),
	logoutFromOpenAiCodex: vi.fn(),
	getOpenAiCodexAuthStatus: vi.fn(),
	listCommands: vi.fn(),
	listModes: vi.fn(),
	listModels: vi.fn(),
	listSessions: vi.fn(),
	upgrade: vi.fn(),
}))

async function parseArgs(args: string[]): Promise<Record<string, unknown>> {
	const originalArgv = process.argv
	process.argv = ["node", "tumble", ...args]

	try {
		vi.resetModules()
		mockRun.mockClear()
		await import("../index.js")
	} finally {
		process.argv = originalArgv
	}

	expect(mockRun).toHaveBeenCalledTimes(1)
	return mockRun.mock.calls[0]![1] as Record<string, unknown>
}

describe("CLI flag defaults do not shadow settings", () => {
	it("leaves --mode and --reasoning-effort undefined when they are not passed", async () => {
		const options = await parseArgs(["hello"])

		expect(options.mode).toBeUndefined()
		expect(options.reasoningEffort).toBeUndefined()
		expect(options.model).toBeUndefined()
		expect(options.provider).toBeUndefined()
		expect(options.commandExecutionTimeout).toBeUndefined()
	})

	it("passes --command-execution-timeout through unparsed, for run() to validate", async () => {
		const options = await parseArgs(["--command-execution-timeout", "1800", "hello"])

		expect(options.commandExecutionTimeout).toBe("1800")
	})

	it("passes explicit --mode and --reasoning-effort through", async () => {
		const options = await parseArgs(["--mode", "architect", "-r", "max", "hello"])

		expect(options.mode).toBe("architect")
		expect(options.reasoningEffort).toBe("max")
	})
})
