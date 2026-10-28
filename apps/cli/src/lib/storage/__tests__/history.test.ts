import * as fs from "fs"
import * as os from "os"
import * as path from "path"

// The config directory is read from the home directory when the module loads,
// so the home directory is a temporary one before the module is imported.
const home = fs.mkdtempSync(path.join(os.tmpdir(), "cli-history-test-"))
vi.stubEnv("HOME", home)
vi.stubEnv("USERPROFILE", home)

const { getHistoryFilePath, loadHistory, saveHistory, addToHistory, MAX_HISTORY_ENTRIES } =
	await import("../history.js")

const configDir = path.join(home, ".roo")
const historyFile = path.join(configDir, "cli-history.json")

const writeHistory = (data: unknown) => {
	fs.mkdirSync(configDir, { recursive: true })
	fs.writeFileSync(historyFile, typeof data === "string" ? data : JSON.stringify(data))
}

const readHistory = () => JSON.parse(fs.readFileSync(historyFile, "utf-8"))

describe("historyStorage", () => {
	beforeEach(() => {
		fs.rmSync(configDir, { recursive: true, force: true })
	})

	afterAll(() => {
		vi.unstubAllEnvs()
		fs.rmSync(home, { recursive: true, force: true })
	})

	describe("getHistoryFilePath", () => {
		it("should return the correct path to cli-history.json", () => {
			expect(getHistoryFilePath()).toBe(historyFile)
		})
	})

	describe("loadHistory", () => {
		it("should return empty array when file does not exist", async () => {
			expect(await loadHistory()).toEqual([])
		})

		it("should return entries from valid JSON file", async () => {
			writeHistory({ version: 1, entries: ["first command", "second command", "third command"] })

			expect(await loadHistory()).toEqual(["first command", "second command", "third command"])
		})

		it("should return empty array for invalid JSON", async () => {
			writeHistory("not valid json")
			const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})

			expect(await loadHistory()).toEqual([])
			consoleSpy.mockRestore()
		})

		it("should filter out non-string entries", async () => {
			writeHistory({ version: 1, entries: ["valid", 123, "also valid", null, ""] })

			expect(await loadHistory()).toEqual(["valid", "also valid"])
		})

		it("should return empty array when entries is not an array", async () => {
			writeHistory({ version: 1, entries: "not an array" })

			expect(await loadHistory()).toEqual([])
		})
	})

	describe("saveHistory", () => {
		it("should create directory and save history", async () => {
			await saveHistory(["command1", "command2"])

			expect(readHistory()).toEqual({ version: 1, entries: ["command1", "command2"] })
		})

		it.skipIf(process.platform === "win32")(
			"keeps the history and its directory readable by the user only",
			async () => {
				await saveHistory(["export TOKEN=secret"])
				expect(fs.statSync(configDir).mode & 0o777).toBe(0o700)
				expect(fs.statSync(historyFile).mode & 0o777).toBe(0o600)

				// A file an older version wrote readable by everyone.
				fs.chmodSync(historyFile, 0o644)
				await saveHistory(["export TOKEN=secret", "ls"])
				expect(fs.statSync(historyFile).mode & 0o777).toBe(0o600)
			},
		)

		it("should trim entries to MAX_HISTORY_ENTRIES", async () => {
			const manyEntries = Array.from({ length: MAX_HISTORY_ENTRIES + 100 }, (_, i) => `command${i}`)

			await saveHistory(manyEntries)

			const { entries } = readHistory()
			expect(entries.length).toBe(MAX_HISTORY_ENTRIES)
			// Should keep the most recent entries (last 500)
			expect(entries[0]).toBe(`command100`)
			expect(entries[MAX_HISTORY_ENTRIES - 1]).toBe(`command${MAX_HISTORY_ENTRIES + 99}`)
		})

		it("should save into a directory that already exists", async () => {
			fs.mkdirSync(configDir, { recursive: true })

			await saveHistory(["command"])

			expect(readHistory().entries).toEqual(["command"])
		})

		it("should log warning on write error but not throw", async () => {
			// A directory where the file should be: the write cannot replace it.
			fs.mkdirSync(path.join(historyFile, "inside"), { recursive: true })
			const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})

			await expect(saveHistory(["command"])).resolves.toBeUndefined()
			expect(consoleSpy).toHaveBeenCalledWith(
				expect.stringContaining("Could not save CLI history"),
				expect.any(String),
			)

			consoleSpy.mockRestore()
		})
	})

	describe("addToHistory", () => {
		it("should add new entry to history", async () => {
			writeHistory({ version: 1, entries: ["existing command"] })

			expect(await addToHistory("new command")).toEqual(["existing command", "new command"])
			expect(readHistory().entries).toEqual(["existing command", "new command"])
		})

		it.each([
			["empty strings", ""],
			["whitespace-only strings", "   "],
		])("should not add %s", async (_label, entry) => {
			writeHistory({ version: 1, entries: ["existing command"] })
			const before = fs.statSync(historyFile).mtimeMs

			expect(await addToHistory(entry)).toEqual(["existing command"])
			expect(fs.statSync(historyFile).mtimeMs).toBe(before)
		})

		it("should not add consecutive duplicates", async () => {
			writeHistory({ version: 1, entries: ["first", "second"] })

			expect(await addToHistory("second")).toEqual(["first", "second"])
			expect(readHistory().entries).toEqual(["first", "second"])
		})

		it("should add non-consecutive duplicates", async () => {
			writeHistory({ version: 1, entries: ["first", "second"] })

			expect(await addToHistory("first")).toEqual(["first", "second", "first"])
		})

		it("should trim whitespace from entry before adding", async () => {
			writeHistory({ version: 1, entries: ["existing"] })

			expect(await addToHistory("  new command  ")).toEqual(["existing", "new command"])
		})
	})

	describe("MAX_HISTORY_ENTRIES", () => {
		it("should be 500", () => {
			expect(MAX_HISTORY_ENTRIES).toBe(500)
		})
	})
})
