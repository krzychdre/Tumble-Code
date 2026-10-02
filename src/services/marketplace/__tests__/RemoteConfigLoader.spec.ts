// npx vitest services/marketplace/__tests__/RemoteConfigLoader.spec.ts

import axios from "axios"
import { RemoteConfigLoader } from "../RemoteConfigLoader"
import type { MarketplaceItemType } from "@tumble-code/types"
import { logger } from "../../../utils/logging"

// Mock axios
vi.mock("axios")
const mockedAxios = axios as any

const MODES_LISTING_URL = "https://api.github.com/repos/krzychdre/Tumble-Code/contents/marketplace/modes?ref=main"
const MCPS_LISTING_URL = "https://api.github.com/repos/krzychdre/Tumble-Code/contents/marketplace/mcps?ref=main"
const RAW_BASE = "https://raw.githubusercontent.com/krzychdre/Tumble-Code/main/marketplace"

const modeYaml = (id: string) => `id: "${id}"
name: "Mode ${id}"
description: "A test mode"
content: "slug: ${id}\\nname: Test"`

const mcpYaml = (id: string) => `id: "${id}"
name: "MCP ${id}"
description: "A test MCP"
url: "https://github.com/test/${id}"
content: '{"command": "test"}'`

function listingEntry(folder: string, name: string, type = "file") {
	return {
		name,
		path: `marketplace/${folder}/${name}`,
		type,
		download_url: type === "file" ? `${RAW_BASE}/${folder}/${name}` : null,
	}
}

function notFoundError() {
	return Object.assign(new Error("Request failed with status code 404"), { response: { status: 404 } })
}

/**
 * Serves a fake repo: `files` maps "modes/x.yaml" to its YAML text. A folder
 * with no files answers the listing with a 404, like GitHub does for a path
 * that does not exist.
 */
function serveRepo(files: Record<string, string>, extraListing: Record<string, object[]> = {}) {
	mockedAxios.get.mockImplementation((url: string) => {
		for (const folder of ["modes", "mcps"]) {
			const listingUrl = folder === "modes" ? MODES_LISTING_URL : MCPS_LISTING_URL
			if (url === listingUrl) {
				const names = Object.keys(files)
					.filter((key) => key.startsWith(`${folder}/`))
					.map((key) => key.slice(folder.length + 1))
				const entries = [...names.map((name) => listingEntry(folder, name)), ...(extraListing[folder] ?? [])]
				if (entries.length === 0) {
					return Promise.reject(notFoundError())
				}
				return Promise.resolve({ data: entries })
			}
		}
		if (url.startsWith(`${RAW_BASE}/`)) {
			const key = url.slice(RAW_BASE.length + 1)
			if (key in files) {
				return Promise.resolve({ data: files[key] })
			}
			return Promise.reject(notFoundError())
		}
		return Promise.reject(new Error(`Unknown URL ${url}`))
	})
}

function listingCalls(): number {
	return mockedAxios.get.mock.calls.filter(([url]: [string]) => url.startsWith("https://api.github.com/")).length
}

describe("RemoteConfigLoader", () => {
	let loader: RemoteConfigLoader

	beforeEach(() => {
		loader = new RemoteConfigLoader()
		vi.clearAllMocks()
		// Clear any existing cache
		loader.clearCache()
	})

	afterEach(() => {
		vi.useRealTimers()
		vi.restoreAllMocks()
	})

	describe("loadAllItems", () => {
		it("lists both folders on GitHub and fetches every item file", async () => {
			serveRepo({
				"modes/test-mode.yaml": modeYaml("test-mode"),
				"mcps/test-mcp.yml": mcpYaml("test-mcp"),
			})

			const items = await loader.loadAllItems()

			expect(mockedAxios.get).toHaveBeenCalledWith(
				MODES_LISTING_URL,
				expect.objectContaining({
					timeout: 10000,
					headers: { Accept: "application/vnd.github+json" },
				}),
			)
			expect(mockedAxios.get).toHaveBeenCalledWith(
				MCPS_LISTING_URL,
				expect.objectContaining({
					timeout: 10000,
					headers: { Accept: "application/vnd.github+json" },
				}),
			)
			expect(mockedAxios.get).toHaveBeenCalledWith(
				`${RAW_BASE}/modes/test-mode.yaml`,
				expect.objectContaining({ timeout: 10000, responseType: "text" }),
			)
			expect(mockedAxios.get).toHaveBeenCalledTimes(4)

			expect(items).toEqual([
				{
					type: "mode",
					id: "test-mode",
					name: "Mode test-mode",
					description: "A test mode",
					content: "slug: test-mode\nname: Test",
				},
				{
					type: "mcp",
					id: "test-mcp",
					name: "MCP test-mcp",
					description: "A test MCP",
					url: "https://github.com/test/test-mcp",
					content: '{"command": "test"}',
				},
			])
		})

		it("ignores directories and non-YAML files in the listing", async () => {
			serveRepo(
				{ "modes/a.yaml": modeYaml("a") },
				{ modes: [listingEntry("modes", "README.md"), listingEntry("modes", "drafts", "dir")] },
			)

			const items = await loader.loadAllItems()

			expect(items.map((item) => item.id)).toEqual(["a"])
			const fetched = mockedAxios.get.mock.calls.map(([url]: [string]) => url)
			expect(fetched).not.toContain(`${RAW_BASE}/modes/README.md`)
		})

		it("skips an invalid file with a warning and keeps the valid ones", async () => {
			const warn = vi.spyOn(logger, "warn").mockImplementation(() => {})
			serveRepo({
				"modes/good.yaml": modeYaml("good"),
				// Missing name, description and content.
				"modes/broken.yaml": `id: "broken"`,
				"modes/not-yaml.yaml": "id: [unclosed",
			})

			const items = await loader.loadAllItems()

			expect(items.map((item) => item.id)).toEqual(["good"])
			expect(warn).toHaveBeenCalledWith(expect.stringContaining("broken.yaml"))
			expect(warn).toHaveBeenCalledWith(expect.stringContaining("not-yaml.yaml"), expect.anything())
		})

		it("treats a missing folder (404) as an empty list without retrying", async () => {
			serveRepo({ "modes/test-mode.yaml": modeYaml("test-mode") })

			const items = await loader.loadAllItems()

			expect(items).toHaveLength(1)
			expect(items[0].type).toBe("mode")
			// The 404 on the MCP listing is not retried.
			const mcpListingCalls = mockedAxios.get.mock.calls.filter(([url]: [string]) => url === MCPS_LISTING_URL)
			expect(mcpListingCalls).toHaveLength(1)
		})

		it("does not fetch MCPs when hideMarketplaceMcps is set", async () => {
			serveRepo({
				"modes/test-mode.yaml": modeYaml("test-mode"),
				"mcps/test-mcp.yaml": mcpYaml("test-mcp"),
			})

			const items = await loader.loadAllItems(true)

			expect(items.map((item) => item.type)).toEqual(["mode"])
			const fetched = mockedAxios.get.mock.calls.map(([url]: [string]) => url)
			expect(fetched).not.toContain(MCPS_LISTING_URL)
			expect(fetched).not.toContain(`${RAW_BASE}/mcps/test-mcp.yaml`)
		})

		it("uses the cache on subsequent calls", async () => {
			serveRepo({
				"modes/test-mode.yaml": modeYaml("test-mode"),
				"mcps/test-mcp.yaml": mcpYaml("test-mcp"),
			})

			const items1 = await loader.loadAllItems()
			expect(mockedAxios.get).toHaveBeenCalledTimes(4)

			const items2 = await loader.loadAllItems()
			expect(mockedAxios.get).toHaveBeenCalledTimes(4)

			expect(items1).toEqual(items2)
		})

		it("retries the listing on network failures", async () => {
			vi.useFakeTimers()
			let modesListingCalls = 0
			serveRepo({ "modes/test-mode.yaml": modeYaml("test-mode") })
			const serve = mockedAxios.get.getMockImplementation()
			mockedAxios.get.mockImplementation((url: string, config: object) => {
				if (url === MODES_LISTING_URL) {
					modesListingCalls++
					if (modesListingCalls <= 2) {
						return Promise.reject(new Error("Network error"))
					}
				}
				return serve(url, config)
			})

			const promise = loader.loadAllItems()
			await vi.runAllTimersAsync()
			const items = await promise

			expect(modesListingCalls).toBe(3)
			expect(items).toHaveLength(1)
			expect(items[0].type).toBe("mode")
		})

		it("throws after max retries when the listing keeps failing", async () => {
			vi.useFakeTimers()
			mockedAxios.get.mockRejectedValue(new Error("Persistent network error"))

			const promise = loader.loadAllItems()
			const assertion = expect(promise).rejects.toThrow("Persistent network error")
			await vi.runAllTimersAsync()
			await assertion

			const modesListingCalls = mockedAxios.get.mock.calls.filter(([url]: [string]) => url === MODES_LISTING_URL)
			expect(modesListingCalls).toHaveLength(3)
		})

		it("does not cache a result with a file that failed to download", async () => {
			vi.useFakeTimers()
			const warn = vi.spyOn(logger, "warn").mockImplementation(() => {})
			serveRepo({ "modes/a.yaml": modeYaml("a"), "modes/b.yaml": modeYaml("b") })
			const serve = mockedAxios.get.getMockImplementation()
			let failB = true
			mockedAxios.get.mockImplementation((url: string, config: object) => {
				if (failB && url === `${RAW_BASE}/modes/b.yaml`) {
					return Promise.reject(new Error("Network error"))
				}
				return serve(url, config)
			})

			const first = loader.loadAllItems()
			await vi.runAllTimersAsync()
			expect((await first).map((item) => item.id)).toEqual(["a"])
			expect(warn).toHaveBeenCalledWith(expect.stringContaining("b.yaml"), expect.anything())

			failB = false
			const second = await loader.loadAllItems()
			expect(second.map((item) => item.id)).toEqual(["a", "b"])
		})
	})

	describe("getItem", () => {
		it("should find specific item by id and type", async () => {
			serveRepo({
				"modes/target-mode.yaml": modeYaml("target-mode"),
				"mcps/target-mcp.yaml": mcpYaml("target-mcp"),
			})

			const modeItem = await loader.getItem("target-mode", "mode" as MarketplaceItemType)
			const mcpItem = await loader.getItem("target-mcp", "mcp" as MarketplaceItemType)
			const notFound = await loader.getItem("nonexistent", "mode" as MarketplaceItemType)

			expect(modeItem).toEqual({
				type: "mode",
				id: "target-mode",
				name: "Mode target-mode",
				description: "A test mode",
				content: "slug: target-mode\nname: Test",
			})

			expect(mcpItem).toEqual({
				type: "mcp",
				id: "target-mcp",
				name: "MCP target-mcp",
				description: "A test MCP",
				url: "https://github.com/test/target-mcp",
				content: '{"command": "test"}',
			})

			expect(notFound).toBeNull()
		})
	})

	describe("clearCache", () => {
		it("should clear cache and force fresh API calls", async () => {
			serveRepo({ "modes/test-mode.yaml": modeYaml("test-mode") })

			await loader.loadAllItems()
			expect(listingCalls()).toBe(2)

			await loader.loadAllItems()
			expect(listingCalls()).toBe(2)

			loader.clearCache()

			await loader.loadAllItems()
			expect(listingCalls()).toBe(4)
		})
	})

	describe("cache expiration", () => {
		it("should expire cache after 5 minutes", async () => {
			serveRepo({ "modes/test-mode.yaml": modeYaml("test-mode") })

			let currentTime = 1000000
			vi.spyOn(Date, "now").mockImplementation(() => currentTime)

			await loader.loadAllItems()
			expect(listingCalls()).toBe(2)

			await loader.loadAllItems()
			expect(listingCalls()).toBe(2)

			// Advance time by 6 minutes
			currentTime += 6 * 60 * 1000

			await loader.loadAllItems()
			expect(listingCalls()).toBe(4)
		})
	})
})
