// npx vitest run src/debug-log/__tests__/debugLog.spec.ts

import * as fs from "fs"
import * as os from "os"
import * as path from "path"

describe("debug log file", () => {
	let home: string
	let logPath: string

	/** A fresh module, so the log path follows the temporary HOME. */
	async function loadDebugLog() {
		vi.resetModules()
		return import("../index.js")
	}

	const modeOf = (file: string) => fs.statSync(file).mode & 0o777

	beforeEach(() => {
		home = fs.mkdtempSync(path.join(os.tmpdir(), "debug-log-"))
		// os.homedir() reads HOME on POSIX and USERPROFILE on Windows.
		vi.stubEnv("HOME", home)
		vi.stubEnv("USERPROFILE", home)
		logPath = path.join(home, ".roo", "cli-debug.log")
	})

	afterEach(() => {
		vi.unstubAllEnvs()
		fs.rmSync(home, { recursive: true, force: true })
	})

	it.skipIf(process.platform === "win32")(
		"creates the directory and the log readable by their owner only",
		async () => {
			const { setDebugLogEnabled, debugLog } = await loadDebugLog()

			setDebugLogEnabled(true)
			debugLog("hello", { prompt: "secret" })

			expect(fs.readFileSync(logPath, "utf8")).toContain('"prompt": "secret"')
			expect(modeOf(path.dirname(logPath))).toBe(0o700)
			expect(modeOf(logPath)).toBe(0o600)
		},
	)

	it.skipIf(process.platform === "win32")(
		"makes a log left readable by an older version private when logging starts",
		async () => {
			fs.mkdirSync(path.dirname(logPath))
			fs.writeFileSync(logPath, "old\n", { mode: 0o644 })
			const { setDebugLogEnabled } = await loadDebugLog()

			setDebugLogEnabled(true)

			expect(modeOf(logPath)).toBe(0o600)
		},
	)

	it("moves a log over 10 MB aside when logging starts", async () => {
		fs.mkdirSync(path.dirname(logPath))
		fs.writeFileSync(logPath, Buffer.alloc(10 * 1024 * 1024 + 1))
		const { setDebugLogEnabled, debugLog } = await loadDebugLog()

		setDebugLogEnabled(true)
		debugLog("fresh")

		expect(fs.statSync(`${logPath}.1`).size).toBe(10 * 1024 * 1024 + 1)
		expect(fs.readFileSync(logPath, "utf8")).toContain("] fresh\n")
		expect(fs.statSync(logPath).size).toBeLessThan(100)
	})
})
