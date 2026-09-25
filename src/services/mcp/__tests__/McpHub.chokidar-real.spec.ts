// Runs the real `chokidar` (McpHub.spec mocks it) with the options
// McpHub.setupFileWatcher uses (none), on a real temp directory, to pin what the
// "restart the MCP server when its files change" feature relies on:
// - watching a file path emits "change" with that same path when the file is written;
// - watching a directory (a `watchPaths` entry) emits "change" with the path of the
//   changed file inside it;
// - after close() no more events arrive.
import fs from "fs"
import os from "os"
import path from "path"

import chokidar, { type FSWatcher } from "chokidar"

const WAIT_MS = 5000

function waitFor(watcher: FSWatcher, event: "change" | "ready", timeoutMs = WAIT_MS): Promise<string | undefined> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(`no "${event}" event within ${timeoutMs} ms`)), timeoutMs)
		watcher.once(event, (changedPath?: string) => {
			clearTimeout(timer)
			resolve(changedPath)
		})
	})
}

// Some platforms deliver the first write before the watcher's baseline is
// settled; write until the event arrives instead of relying on one write.
async function writeUntilChange(watcher: FSWatcher, file: string): Promise<string | undefined> {
	const changed = waitFor(watcher, "change")
	let n = 0
	const writer = setInterval(() => fs.writeFileSync(file, `v${++n}`), 150)
	try {
		return await changed
	} finally {
		clearInterval(writer)
	}
}

describe("chokidar as used by McpHub file watchers", () => {
	let dir: string
	let watcher: FSWatcher | undefined

	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcphub-chokidar-"))
	})

	afterEach(async () => {
		await watcher?.close()
		watcher = undefined
		fs.rmSync(dir, { recursive: true, force: true })
	})

	it("reports a change of a watched file with the watched path", async () => {
		const file = path.join(dir, "build", "index.js")
		fs.mkdirSync(path.dirname(file))
		fs.writeFileSync(file, "v0")

		watcher = chokidar.watch(file, {})
		await waitFor(watcher, "ready")

		expect(await writeUntilChange(watcher, file)).toBe(file)
	})

	it("reports a change of a file inside a watched directory", async () => {
		const file = path.join(dir, "server.js")
		fs.writeFileSync(file, "v0")

		watcher = chokidar.watch([dir], {})
		await waitFor(watcher, "ready")

		expect(await writeUntilChange(watcher, file)).toBe(file)
	})

	it("stops reporting after close()", async () => {
		const file = path.join(dir, "index.js")
		fs.writeFileSync(file, "v0")

		watcher = chokidar.watch(file, {})
		await waitFor(watcher, "ready")
		const onChange = vi.fn()
		watcher.on("change", onChange)
		await watcher.close()
		watcher = undefined

		fs.writeFileSync(file, "v1")
		await new Promise((resolve) => setTimeout(resolve, 500))
		expect(onChange).not.toHaveBeenCalled()
	})
})
