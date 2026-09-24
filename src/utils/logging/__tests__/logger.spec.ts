import { configureLogger, createLineLogger, logger } from "../index"
import type { ILogger, LogMeta } from "../types"

type Call = [level: string, message: string | Error, meta: LogMeta | undefined]

function recorder(): { calls: Call[]; target: ILogger } {
	const calls: Call[] = []
	const target: ILogger = {
		debug: (message, meta) => calls.push(["debug", message, meta]),
		info: (message, meta) => calls.push(["info", message, meta]),
		warn: (message, meta) => calls.push(["warn", message, meta]),
		error: (message, meta) => calls.push(["error", message, meta]),
		fatal: (message, meta) => calls.push(["fatal", message, meta]),
		child: () => target,
		close: () => {},
	}
	return { calls, target }
}

describe("logger", () => {
	it("forwards to whatever destination is configured at call time", () => {
		const first = recorder()
		const second = recorder()

		configureLogger(first.target)
		logger.info("one")
		configureLogger(second.target)
		logger.warn("two", { ctx: "bedrock" })

		expect(first.calls).toEqual([["info", "one", undefined]])
		expect(second.calls).toEqual([["warn", "two", { ctx: "bedrock" }]])
	})

	it("lets a child made before configuration follow the later destination", () => {
		const child = logger.child({ ctx: "memory", taskId: "t1" })
		const { calls, target } = recorder()

		configureLogger(target)
		child.error("failed", { attempt: 2 })

		expect(calls).toEqual([["error", "failed", { ctx: "memory", taskId: "t1", attempt: 2 }]])
	})

	it("keeps the parent's context unless the child call sets its own", () => {
		const { calls, target } = recorder()
		configureLogger(target)

		const child = logger.child({ ctx: "memory" })
		child.info("inherited")
		child.info("overridden", { ctx: "dream" })
		child.child({ taskId: "t2" }).info("nested")

		expect(calls.map(([, , meta]) => meta)).toEqual([
			{ ctx: "memory" },
			{ ctx: "dream" },
			{ ctx: "memory", taskId: "t2" },
		])
	})

	it("writes readable lines through createLineLogger, at info and above", () => {
		const lines: string[] = []
		configureLogger(createLineLogger((line) => lines.push(line)))

		logger.debug("hidden")
		logger.info("shown", { ctx: "ContextProxy" })

		expect(lines).toHaveLength(1)
		expect(lines[0]).toMatch(/^\d{4}-\d\d-\d\dT[\d:.]+Z \[info\] \[ContextProxy\] shown$/)
	})
})
