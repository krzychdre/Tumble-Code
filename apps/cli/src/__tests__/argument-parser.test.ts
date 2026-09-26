/**
 * Characterization of the commander argument parser as main.ts configures it:
 * the help text of every command, the parsed value of every option, and what
 * happens on --version, unknown options, excess arguments and unknown
 * commands. It runs the real parser (only the command handlers are mocked), so
 * a commander upgrade shows here exactly which user-visible behavior changed.
 */

const mocks = vi.hoisted(() => ({
	run: vi.fn(),
	login: vi.fn(async () => ({ success: true })),
	logout: vi.fn(async () => ({ success: true })),
	status: vi.fn(async () => ({ authenticated: true })),
	loginToOpenAiCodex: vi.fn(async () => ({ success: true })),
	logoutFromOpenAiCodex: vi.fn(async () => ({ success: true })),
	getOpenAiCodexAuthStatus: vi.fn(async () => ({ authenticated: true })),
	listCommands: vi.fn(async () => {}),
	listModes: vi.fn(async () => {}),
	listModels: vi.fn(async () => {}),
	listSessions: vi.fn(async () => {}),
	upgrade: vi.fn(async () => {}),
}))

vi.mock("@/commands/index.js", () => mocks)

// The version comes from package.json; pin it so the snapshots do not change
// with every release.
vi.mock("@/lib/utils/version.js", () => ({ VERSION: "9.9.9-test" }))

class ExitCalled extends Error {
	constructor(readonly code: number | undefined) {
		super(`process.exit(${code})`)
	}
}

interface ParseResult {
	stdout: string
	stderr: string
	exitCode: number | undefined
	/** The arguments commander passed to run(), without the Command instance. */
	runArgs?: unknown[]
}

async function parse(args: string[]): Promise<ParseResult> {
	const originalArgv = process.argv
	let stdout = ""
	let stderr = ""
	let exitCode: number | undefined

	const outSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
		stdout += String(chunk)
		return true
	})
	const errSpy = vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
		stderr += String(chunk)
		return true
	})
	// Commander itself exits (help, version, parse errors) and must be stopped
	// there, like the real process.exit would. The command actions exit from an
	// async callback after the parse; throwing there would only produce an
	// unhandled rejection, so those calls are just recorded.
	const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
		if (new Error().stack?.includes("/commander/")) {
			throw new ExitCalled(code)
		}
	}) as typeof process.exit)

	process.argv = ["node", "tumble", ...args]

	try {
		vi.resetModules()
		Object.values(mocks).forEach((mock) => mock.mockClear())
		await import("../main.js")
		// Subcommand actions are async and end in process.exit; let them settle.
		await new Promise((resolve) => setTimeout(resolve, 0))
	} catch (error) {
		if (!(error instanceof ExitCalled)) {
			throw error
		}

		exitCode = error.code
	} finally {
		process.argv = originalArgv
		outSpy.mockRestore()
		errSpy.mockRestore()
	}

	// An async action calls process.exit after the import resolved.
	const lateExit = exitSpy.mock.calls.at(-1)

	if (exitCode === undefined && lateExit) {
		exitCode = lateExit[0] as number | undefined
	}

	exitSpy.mockRestore()

	const runCall = mocks.run.mock.calls[0] as unknown[] | undefined

	return { stdout, stderr, exitCode, runArgs: runCall?.slice(0, 2) }
}

describe("CLI argument parser (commander characterization)", () => {
	describe("help output", () => {
		it.each([
			[["--help"]],
			[["list", "--help"]],
			[["list", "commands", "--help"]],
			[["list", "sessions", "--help"]],
			[["upgrade", "--help"]],
			[["auth", "--help"]],
			[["auth", "login", "--help"]],
			[["auth", "codex", "--help"]],
			[["auth", "codex", "status", "--help"]],
		])("%j", async (args) => {
			const result = await parse(args)

			expect(result.exitCode).toBe(0)
			expect(result.stderr).toBe("")
			expect(result.stdout).toMatchSnapshot()
		})
	})

	it("--version prints the version and exits 0", async () => {
		const result = await parse(["--version"])

		expect(result).toMatchObject({ stdout: "9.9.9-test\n", stderr: "", exitCode: 0 })
		expect(mocks.run).not.toHaveBeenCalled()
	})

	it("-V is the short form of --version", async () => {
		const result = await parse(["-V"])

		expect(result).toMatchObject({ stdout: "9.9.9-test\n", exitCode: 0 })
	})

	it("passes no prompt and the documented defaults when nothing is given", async () => {
		const result = await parse([])

		expect(result.exitCode).toBeUndefined()
		expect(result.runArgs).toEqual([
			undefined,
			{
				continue: false,
				print: false,
				stdinPromptStream: false,
				signalOnlyExit: false,
				debug: false,
				requireApproval: false,
				exitOnError: false,
				ephemeral: false,
				oneshot: false,
				outputFormat: "text",
			},
		])
	})

	it("parses every root option to the value run() receives", async () => {
		const result = await parse([
			"--prompt-file",
			"p.md",
			"--create-with-session-id",
			"11111111-1111-4111-8111-111111111111",
			"--session-id",
			"22222222-2222-4222-8222-222222222222",
			"-c",
			"-w",
			"/ws",
			"-p",
			"--stdin-prompt-stream",
			"--signal-only-exit",
			"-e",
			"/ext",
			"-d",
			"-a",
			"-k",
			"sk-1",
			"--provider",
			"openai",
			"-m",
			"gpt-x",
			"--base-url",
			"http://localhost:1/v1",
			"--mode",
			"ask",
			"--terminal-shell",
			"/bin/zsh",
			"-r",
			"high",
			"--consecutive-mistake-limit",
			"7",
			"--command-execution-timeout",
			"90",
			"--exit-on-error",
			"--ephemeral",
			"--oneshot",
			"--output-format",
			"stream-json",
			"do it",
		])

		expect(result.exitCode).toBeUndefined()
		expect(result.runArgs).toEqual([
			"do it",
			{
				promptFile: "p.md",
				createWithSessionId: "11111111-1111-4111-8111-111111111111",
				sessionId: "22222222-2222-4222-8222-222222222222",
				continue: true,
				workspace: "/ws",
				print: true,
				stdinPromptStream: true,
				signalOnlyExit: true,
				extension: "/ext",
				debug: true,
				requireApproval: true,
				apiKey: "sk-1",
				provider: "openai",
				model: "gpt-x",
				baseUrl: "http://localhost:1/v1",
				mode: "ask",
				terminalShell: "/bin/zsh",
				reasoningEffort: "high",
				consecutiveMistakeLimit: 7,
				commandExecutionTimeout: "90",
				exitOnError: true,
				ephemeral: true,
				oneshot: true,
				outputFormat: "stream-json",
			},
		])
	})

	it("accepts --option=value and combined short flags", async () => {
		const result = await parse(["--mode=debug", "-pd", "hi"])

		expect(result.runArgs?.[0]).toBe("hi")
		expect(result.runArgs?.[1]).toMatchObject({ mode: "debug", print: true, debug: true })
	})

	it("takes an option-argument that starts with a dash", async () => {
		const result = await parse(["--consecutive-mistake-limit", "-1", "hi"])

		expect(result.runArgs?.[1]).toMatchObject({ consecutiveMistakeLimit: -1 })
	})

	it("passes options that follow the prompt through as arguments (passThroughOptions)", async () => {
		const result = await parse(["hello", "-p"])

		expect({ exitCode: result.exitCode, stderr: result.stderr, runArgs: result.runArgs }).toMatchSnapshot()
	})

	it("treats a second positional argument as excess", async () => {
		const result = await parse(["hello", "world"])

		expect({ exitCode: result.exitCode, stderr: result.stderr, runArgs: result.runArgs }).toMatchSnapshot()
	})

	it("reads a prompt that starts with a dash and a digit", async () => {
		const result = await parse(["-5 degrees outside"])

		expect({ exitCode: result.exitCode, stderr: result.stderr, runArgs: result.runArgs }).toMatchSnapshot()
	})

	it("reads a prompt that is a negative number", async () => {
		const result = await parse(["-5"])

		expect({ exitCode: result.exitCode, stderr: result.stderr, prompt: result.runArgs?.[0] }).toMatchSnapshot()
	})

	it("rejects an unknown option with exit code 1", async () => {
		const result = await parse(["--no-such-flag"])

		expect(result.exitCode).toBe(1)
		expect(result.stderr).toMatchInlineSnapshot(`
			"error: unknown option '--no-such-flag'
			"
		`)
		expect(mocks.run).not.toHaveBeenCalled()
	})

	it("suggests the closest option for a typo", async () => {
		const result = await parse(["--oneshto"])

		expect(result.exitCode).toBe(1)
		expect(result.stderr).toMatchInlineSnapshot(`
			"error: unknown option '--oneshto'
			(Did you mean --oneshot?)
			"
		`)
	})

	it("rejects an option that is missing its argument", async () => {
		const result = await parse(["--mode"])

		expect(result.exitCode).toBe(1)
		expect(result.stderr).toMatchInlineSnapshot(`
			"error: option '--mode <mode>' argument missing
			"
		`)
	})

	it("routes list subcommands with their own options", async () => {
		const result = await parse(["list", "modes", "--format", "text", "-w", "/ws", "-d"])

		expect(result.exitCode).toBe(0)
		expect(mocks.listModes).toHaveBeenCalledWith({ format: "text", workspace: "/ws", debug: true })
	})

	it("defaults the list format to json", async () => {
		await parse(["list", "sessions"])

		expect(mocks.listSessions).toHaveBeenCalledWith({ format: "json", debug: false })
	})

	it("routes auth and nested codex subcommands", async () => {
		expect((await parse(["auth", "login", "-v"])).exitCode).toBe(0)
		expect(mocks.login).toHaveBeenCalledWith({ verbose: true })

		expect((await parse(["auth", "codex", "status"])).exitCode).toBe(0)
		expect(mocks.getOpenAiCodexAuthStatus).toHaveBeenCalledTimes(1)

		expect((await parse(["upgrade"])).exitCode).toBe(0)
		expect(mocks.upgrade).toHaveBeenCalledTimes(1)
	})

	it("handles an unknown list subcommand", async () => {
		const result = await parse(["list", "nope"])

		expect({ exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr }).toMatchSnapshot()
	})

	it("handles excess arguments to a subcommand", async () => {
		const result = await parse(["upgrade", "now"])

		expect({
			exitCode: result.exitCode,
			stderr: result.stderr,
			upgraded: mocks.upgrade.mock.calls.length,
		}).toMatchSnapshot()
	})

	it("handles excess arguments to a list subcommand", async () => {
		const result = await parse(["list", "modes", "extra"])

		expect({
			exitCode: result.exitCode,
			stderr: result.stderr,
			listed: mocks.listModes.mock.calls.length,
		}).toMatchSnapshot()
	})
})
