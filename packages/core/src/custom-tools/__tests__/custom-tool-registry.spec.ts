// pnpm --filter @tumble-code/core test src/custom-tools/__tests__/custom-tool-registry.spec.ts

import path from "path"
import { fileURLToPath } from "url"

import { CustomToolRegistry, privateCacheDirectory } from "../custom-tool-registry.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const TEST_FIXTURES_DIR = path.join(__dirname, "fixtures")
const TEST_FIXTURES_OVERRIDE_DIR = path.join(__dirname, "fixtures-override")

describe("CustomToolRegistry", () => {
	let registry: CustomToolRegistry

	beforeEach(() => {
		registry = new CustomToolRegistry()
	})

	describe("get", () => {
		it("should return a loaded tool", async () => {
			await registry.loadFromDirectory(TEST_FIXTURES_DIR)

			const tool = registry.get("simple")

			expect(tool).toBeDefined()
			expect(tool?.name).toBe("simple")
			expect(tool?.description).toBe("Simple tool")
		}, 120_000)

		it("should return undefined for non-existent tool", () => {
			expect(registry.get("nonexistent")).toBeUndefined()
		})
	})

	describe("loadFromDirectory", { concurrent: false }, () => {
		it("should load tools from TypeScript files", async () => {
			const result = await registry.loadFromDirectory(TEST_FIXTURES_DIR)

			expect(result.loaded).toContain("simple")
			expect(registry.has("simple")).toBe(true)
		}, 120_000)

		it("should handle named exports", async () => {
			const result = await registry.loadFromDirectory(TEST_FIXTURES_DIR)

			expect(result.loaded).toContain("multi_toolA")
			expect(result.loaded).toContain("multi_toolB")
		}, 30000)

		it("should report validation failures", async () => {
			const result = await registry.loadFromDirectory(TEST_FIXTURES_DIR)

			const invalidFailure = result.failed.find((f) => f.file === "invalid.ts")
			expect(invalidFailure).toBeDefined()
			expect(invalidFailure?.error).toContain("Invalid tool definition")
		}, 30000)

		it("should return empty results for non-existent directory", async () => {
			const result = await registry.loadFromDirectory("/nonexistent/path")

			expect(result.loaded).toHaveLength(0)
			expect(result.failed).toHaveLength(0)
		})

		it("should skip non-tool exports silently", async () => {
			const result = await registry.loadFromDirectory(TEST_FIXTURES_DIR)

			expect(result.loaded).toContain("mixed_validTool")
			// The non-tool exports should not appear in loaded or failed.
			expect(result.loaded).not.toContain("mixed_someString")
			expect(result.loaded).not.toContain("mixed_someNumber")
			expect(result.loaded).not.toContain("mixed_someObject")
		}, 30000)

		it("should support args as alias for parameters", async () => {
			const result = await registry.loadFromDirectory(TEST_FIXTURES_DIR)

			expect(result.loaded).toContain("legacy")

			const tool = registry.get("legacy")
			expect(tool?.parameters).toBeDefined()
		}, 30000)
	})

	describe("transpiled tool cache directory", () => {
		const posix = process.platform !== "win32"
		let base: string

		beforeEach(async () => {
			const fs = await import("fs")
			const os = await import("os")
			base = fs.mkdtempSync(path.join(os.tmpdir(), "tool-cache-spec-"))
		})

		afterEach(async () => {
			const fs = await import("fs")
			fs.rmSync(base, { recursive: true, force: true })
		})

		it("creates the per-user directory private and keeps using it", async () => {
			const fs = await import("fs")
			const preferred = path.join(base, "tumble-tools-1000")

			expect(privateCacheDirectory(preferred)).toBe(preferred)
			expect(privateCacheDirectory(preferred)).toBe(preferred)
			if (posix) {
				expect(fs.statSync(preferred).mode & 0o777).toBe(0o700)
			}
		})

		it.skipIf(!posix)("does not use a directory of that name others may enter, nor a link", async () => {
			const fs = await import("fs")
			const open = path.join(base, "open")
			fs.mkdirSync(open, { mode: 0o777 })
			fs.chmodSync(open, 0o777)
			const elsewhere = path.join(base, "elsewhere")
			fs.mkdirSync(elsewhere, { mode: 0o700 })
			const link = path.join(base, "link")
			fs.symlinkSync(elsewhere, link)

			for (const preferred of [open, link]) {
				const chosen = privateCacheDirectory(preferred)
				expect(chosen).not.toBe(preferred)
				expect(path.dirname(chosen)).toBe(base)
				expect(path.basename(chosen)).toMatch(/^tumble-tools-.{6}$/)
				expect(fs.statSync(chosen).mode & 0o777).toBe(0o700)
			}
		})
	})

	describe("loadFromDirectories", { concurrent: false }, () => {
		it("should load tools from multiple directories", async () => {
			const result = await registry.loadFromDirectories([TEST_FIXTURES_DIR, TEST_FIXTURES_OVERRIDE_DIR])

			// Should load tools from both directories.
			expect(result.loaded).toContain("simple") // From both directories (override wins).
			expect(result.loaded).toContain("unique_override") // Only in override directory.
			expect(result.loaded).toContain("multi_toolA") // Only in fixtures directory.
		}, 60000)

		it("should allow later directories to override earlier ones", async () => {
			await registry.loadFromDirectories([TEST_FIXTURES_DIR, TEST_FIXTURES_OVERRIDE_DIR])

			// The simple tool should have the overridden description.
			const simpleTool = registry.get("simple")
			expect(simpleTool).toBeDefined()
			expect(simpleTool?.description).toBe("Simple tool - OVERRIDDEN")
		}, 60000)

		it("should preserve order: first directory loaded first, second overrides", async () => {
			// Load in reverse order: override first, then fixtures.
			await registry.loadFromDirectories([TEST_FIXTURES_OVERRIDE_DIR, TEST_FIXTURES_DIR])

			// Now the original fixtures directory should win.
			const simpleTool = registry.get("simple")
			expect(simpleTool).toBeDefined()
			expect(simpleTool?.description).toBe("Simple tool") // Original wins when loaded second.
		}, 60000)

		it("should handle non-existent directories in the array", async () => {
			const result = await registry.loadFromDirectories([
				"/nonexistent/path",
				TEST_FIXTURES_DIR,
				"/another/nonexistent",
			])

			// Should still load from the existing directory.
			expect(result.loaded).toContain("simple")
			expect(result.failed).toHaveLength(1) // Only the invalid.ts from fixtures.
		}, 60000)

		it("should handle empty array", async () => {
			const result = await registry.loadFromDirectories([])

			expect(result.loaded).toHaveLength(0)
			expect(result.failed).toHaveLength(0)
		})

		it("should combine results from all directories", async () => {
			const result = await registry.loadFromDirectories([TEST_FIXTURES_DIR, TEST_FIXTURES_OVERRIDE_DIR])

			// Loaded should include tools from both (with duplicates since simple is loaded twice).
			// The "simple" tool is loaded from both directories.
			const simpleCount = result.loaded.filter((name) => name === "simple").length
			expect(simpleCount).toBe(2) // Listed twice in loaded results.
		}, 60000)
	})

	describe("loadFromDirectoriesIfStale", { concurrent: false }, () => {
		it("should load tools from multiple directories when stale", async () => {
			const result = await registry.loadFromDirectoriesIfStale([TEST_FIXTURES_DIR, TEST_FIXTURES_OVERRIDE_DIR])

			expect(result.loaded).toContain("simple")
			expect(result.loaded).toContain("unique_override")
		}, 60000)

		it("should not reload if directories are not stale", async () => {
			// First load.
			await registry.loadFromDirectoriesIfStale([TEST_FIXTURES_DIR])

			// A reload imports every tool file again; the not-stale path stays silent.
			const importing = vi.spyOn(console, "log").mockImplementation(() => {})
			try {
				// Second load - should return the cached tool names without reloading.
				const result = await registry.loadFromDirectoriesIfStale([TEST_FIXTURES_DIR])

				expect(result.loaded).toContain("simple")
				expect(importing).not.toHaveBeenCalled()
			} finally {
				importing.mockRestore()
			}
		}, 30000)

		it("should handle mixed stale and non-stale directories", async () => {
			// Load from fixtures first.
			await registry.loadFromDirectoriesIfStale([TEST_FIXTURES_DIR])

			// Load from both - fixtures is not stale, override is new (stale).
			const result = await registry.loadFromDirectoriesIfStale([TEST_FIXTURES_DIR, TEST_FIXTURES_OVERRIDE_DIR])

			// Override directory tools should be loaded (it's stale/new).
			expect(result.loaded).toContain("simple") // From override (stale).
			expect(result.loaded).toContain("unique_override") // From override (stale).
		}, 60000)
	})
})
