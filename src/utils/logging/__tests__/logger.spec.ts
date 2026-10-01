import { configureLogger, logger, resetLoggerForTests, setDebugLogging } from "../index"

const LINE_HEAD = /^\d{4}-\d\d-\d\dT[\d:.]+Z /

function channel() {
	const lines: string[] = []
	return { lines, appendLine: (line: string) => lines.push(line) }
}

/** The lines without their timestamp, which changes from run to run. */
function bodies(lines: string[]): string[] {
	return lines.map((line) => {
		expect(line).toMatch(LINE_HEAD)
		return line.replace(LINE_HEAD, "")
	})
}

describe("logger", () => {
	afterEach(() => {
		resetLoggerForTests()
		vi.restoreAllMocks()
	})

	it("is silent until configured", () => {
		const consoleSpies = (["debug", "info", "warn", "error"] as const).map((level) => vi.spyOn(console, level))

		logger.info("nobody listens")
		logger.error("still nobody")

		for (const spy of consoleSpies) {
			expect(spy).not.toHaveBeenCalled()
		}
	})

	it("routes every level to the output channel with the level in the line", () => {
		const out = channel()
		configureLogger({ appendLine: out.appendLine, debug: true })

		logger.debug("trace")
		logger.info("ready")
		logger.warn("slow")
		logger.error("failed")

		expect(bodies(out.lines)).toEqual(["[debug] trace", "[info] ready", "[warn] slow", "[error] failed"])
	})

	it("drops debug entries unless debug logging is on, and follows later changes", () => {
		const out = channel()
		configureLogger({ appendLine: out.appendLine })

		logger.debug("hidden")
		setDebugLogging(true)
		logger.debug("shown")
		setDebugLogging(false)
		logger.debug("hidden again")

		expect(bodies(out.lines)).toEqual(["[debug] shown"])
	})

	it("formats extra arguments like console.log and keeps a lone string verbatim", () => {
		const out = channel()
		configureLogger({ appendLine: out.appendLine })

		logger.info("Server info:", { name: "fs", tools: 3 })
		logger.info("100%% done")

		expect(bodies(out.lines)).toEqual(["[info] Server info: { name: 'fs', tools: 3 }", "[info] 100%% done"])
	})

	it("writes an error's stack after the message", () => {
		const out = channel()
		configureLogger({ appendLine: out.appendLine })
		const error = new Error("boom")

		logger.error("Request failed:", error)

		expect(out.lines).toHaveLength(1)
		expect(out.lines[0]).toContain("[error] Request failed: Error: boom\n")
		expect(out.lines[0]).toContain(error.stack!.split("\n")[1].trim())
	})

	it("puts the scope, and a trailing { ctx } argument, in brackets after the level", () => {
		const out = channel()
		configureLogger({ appendLine: out.appendLine })

		logger.scope("McpHub").warn("server exited")
		logger.scope("code-index").scope("qdrant").info("collection created")
		logger.error("Invalid ARN format", { ctx: "bedrock", arn: "x" })
		logger.info("only context", { ctx: "ContextProxy" })

		expect(bodies(out.lines)).toEqual([
			"[warn] [McpHub] server exited",
			"[info] [code-index] [qdrant] collection created",
			"[error] [bedrock] Invalid ARN format { arn: 'x' }",
			"[info] [ContextProxy] only context",
		])
	})

	it("writes to the console only from the configured level up", () => {
		const out = channel()
		const info = vi.spyOn(console, "info").mockImplementation(() => {})
		const error = vi.spyOn(console, "error").mockImplementation(() => {})
		configureLogger({ appendLine: out.appendLine, consoleLevel: "error" })

		logger.info("channel only")
		logger.scope("cli").error("both", 42)

		expect(info).not.toHaveBeenCalled()
		expect(error).toHaveBeenCalledWith("[cli]", "both", 42)
		expect(out.lines).toHaveLength(2)
	})

	it("lets a scoped logger made before configuration follow the later destination", () => {
		const scoped = logger.scope("memory")
		const out = channel()
		configureLogger({ appendLine: out.appendLine })

		scoped.info("saved")

		expect(bodies(out.lines)).toEqual(["[info] [memory] saved"])
	})

	it("survives a channel that throws", () => {
		configureLogger({
			appendLine: () => {
				throw new Error("Channel has been closed")
			},
		})

		expect(() => logger.error("after dispose")).not.toThrow()
	})
})
