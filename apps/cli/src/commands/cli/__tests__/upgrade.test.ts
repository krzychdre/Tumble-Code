import { compareVersions, getLatestCliVersion, upgrade } from "../upgrade.js"

function createFetchResponse(body: unknown, init: { ok?: boolean; status?: number } = {}): Response {
	const { ok = true, status = 200 } = init
	return {
		ok,
		status,
		json: async () => body,
	} as Response
}

describe("compareVersions", () => {
	it("returns 1 when first version is newer", () => {
		expect(compareVersions("0.2.0", "0.1.9")).toBe(1)
	})

	it("returns -1 when first version is older", () => {
		expect(compareVersions("0.1.4", "0.1.5")).toBe(-1)
	})

	it("returns 0 when versions are equivalent", () => {
		expect(compareVersions("v1.2.0", "1.2")).toBe(0)
	})

	it("ignores prerelease metadata", () => {
		expect(compareVersions("1.2.3-beta.1", "1.2.3")).toBe(0)
	})

	it("compares multi-digit patch versions numerically", () => {
		expect(compareVersions("0.1.10", "0.1.9")).toBe(1)
	})
})

describe("getLatestCliVersion", () => {
	it("returns the version of the fork's latest release", async () => {
		const fetchImpl = vi.fn<typeof fetch>(async () => createFetchResponse({ tag_name: "v1.1.1" }))

		await expect(getLatestCliVersion(fetchImpl)).resolves.toBe("1.1.1")
		expect(fetchImpl.mock.calls[0]?.[0]).toBe("https://api.github.com/repos/krzychdre/tumble-code/releases/latest")
	})

	it("throws when release check fails", async () => {
		const fetchImpl = (async () => createFetchResponse({}, { ok: false, status: 503 })) as typeof fetch

		await expect(getLatestCliVersion(fetchImpl)).rejects.toThrow("Failed to check latest version")
	})
})

describe("upgrade", () => {
	let logSpy: ReturnType<typeof vi.spyOn>

	beforeEach(() => {
		logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined)
	})

	afterEach(() => {
		logSpy.mockRestore()
	})

	it("does not run installer when already up to date", async () => {
		const runInstaller = vi.fn(async () => undefined)
		const fetchImpl = (async () => createFetchResponse({ tag_name: "v0.1.4" })) as typeof fetch

		await upgrade({
			currentVersion: "0.1.4",
			fetchImpl,
			runInstaller,
		})

		expect(runInstaller).not.toHaveBeenCalled()
		expect(logSpy).toHaveBeenCalledWith("Tumble CLI is already up to date.")
	})

	it("runs installer when a newer version is available", async () => {
		const runInstaller = vi.fn(async () => undefined)
		const fetchImpl = (async () => createFetchResponse({ tag_name: "v0.2.0" })) as typeof fetch

		await upgrade({
			currentVersion: "0.1.4",
			fetchImpl,
			runInstaller,
		})

		expect(runInstaller).toHaveBeenCalledTimes(1)
		expect(logSpy).toHaveBeenCalledWith("✓ Upgrade completed.")
	})
})
