// npx vitest run core/webview/__tests__/refreshCustomTools.spec.ts

import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"

import { customToolRegistry } from "@tumble-code/core"

import { commandsAndSkillsHandlers } from "../messageHandlers/commandsAndSkills"

describe("refreshCustomTools", () => {
	let cwd: string
	let posted: unknown[]

	beforeEach(async () => {
		cwd = await fs.mkdtemp(path.join(os.tmpdir(), "refresh-tools-"))
		await fs.mkdir(path.join(cwd, ".roo", "tools"), { recursive: true })
		// Loading this file would run it: the marker shows whether it ran.
		await fs.writeFile(
			path.join(cwd, ".roo", "tools", "probe.js"),
			`require("fs").writeFileSync(${JSON.stringify(path.join(cwd, "ran"))}, "yes"); module.exports = {}`,
		)
		posted = []
		customToolRegistry.clear()
	})

	afterEach(async () => {
		await fs.rm(cwd, { recursive: true, force: true })
	})

	it("loads no tool code while the custom tools experiment is off", async () => {
		const provider = {
			getState: async () => ({ experiments: { customTools: false } }),
			postMessageToWebview: async (message: unknown) => void posted.push(message),
		}

		await commandsAndSkillsHandlers.refreshCustomTools!(
			{ provider, getCurrentCwd: () => cwd } as never,
			{ type: "refreshCustomTools" } as never,
		)

		expect(posted).toEqual([{ type: "customToolsResult", tools: [] }])
		await expect(fs.access(path.join(cwd, "ran"))).rejects.toThrow()
	})
})
