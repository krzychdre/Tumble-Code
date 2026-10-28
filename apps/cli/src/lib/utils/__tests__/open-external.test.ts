import { EventEmitter } from "events"
import type { spawn } from "child_process"

import { openExternal } from "../open-external.js"

/** Stands in for the system opener: records what would be started. */
function recordingSpawn() {
	const started: { command: string; args: string[] }[] = []
	const spawnProcess = ((command: string, args: string[]) => {
		started.push({ command, args })
		const child = Object.assign(new EventEmitter(), { unref: () => {} })
		queueMicrotask(() => child.emit("spawn"))
		return child
	}) as unknown as typeof spawn
	return { started, spawnProcess }
}

describe("openExternal", () => {
	it.each([
		["linux", "xdg-open", ["https://example.com/a&b"]],
		["darwin", "open", ["https://example.com/a&b"]],
		// No cmd: an & in the URL is part of the URL, not a second command.
		["win32", "rundll32", ["url.dll,FileProtocolHandler", "https://example.com/a&b"]],
	] as const)("opens a web link on %s with %s, the URL as one argument", async (platform, command, args) => {
		const { started, spawnProcess } = recordingSpawn()

		await expect(openExternal("https://example.com/a&b", { platform, spawnProcess })).resolves.toBe(true)

		expect(started).toEqual([{ command, args }])
	})

	it.each(["command:workbench.action.terminal.new", "file:///etc/passwd", "calc.exe", "ms-msdt:/id x"])(
		"refuses %j without starting anything",
		async (url) => {
			const { started, spawnProcess } = recordingSpawn()

			await expect(openExternal(url, { platform: "win32", spawnProcess })).resolves.toBe(false)

			expect(started).toEqual([])
		},
	)
})
