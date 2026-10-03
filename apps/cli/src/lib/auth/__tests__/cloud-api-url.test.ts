import { cloudApiUrlSetting, normalizeCloudApiUrl, resolveCloudApiUrl, restoreCloudPort } from "../cloud-api-url.js"

describe("normalizeCloudApiUrl", () => {
	it("trims and drops trailing slashes, so every path keys the sign-in the same way", () => {
		expect(normalizeCloudApiUrl("  https://cloud.example.com//  ")).toBe("https://cloud.example.com")
		expect(normalizeCloudApiUrl("http://192.168.1.10:8000")).toBe("http://192.168.1.10:8000")
	})

	it.each([undefined, "", "   ", "cloud.example.com", "ftp://cloud.example.com"])("rejects %j", (value) => {
		expect(normalizeCloudApiUrl(value)).toBeUndefined()
	})
})

describe("resolveCloudApiUrl", () => {
	it("prefers the settings value over the environment", () => {
		expect(
			resolveCloudApiUrl({ cloudApiUrl: "https://a.example/" }, { TUMBLE_CODE_API_URL: "https://b.example" }),
		).toEqual({ ok: true, url: "https://a.example", source: "settings" })
	})

	it("falls back to TUMBLE_CODE_API_URL, then ROO_CODE_API_URL", () => {
		expect(resolveCloudApiUrl({}, { TUMBLE_CODE_API_URL: "https://b.example" })).toEqual({
			ok: true,
			url: "https://b.example",
			source: "environment",
		})
		expect(resolveCloudApiUrl({}, { ROO_CODE_API_URL: "https://c.example" })).toMatchObject({
			url: "https://c.example",
		})
	})

	it("explains how to configure a cloud when there is none", () => {
		const resolution = resolveCloudApiUrl({}, {})

		expect(resolution.ok).toBe(false)
		expect(!resolution.ok && resolution.message).toContain('Add "cloudApiUrl" to')
		expect(!resolution.ok && resolution.message).toContain("TUMBLE_CODE_API_URL")
	})

	it("names an invalid settings value instead of silently using the environment", () => {
		const resolution = resolveCloudApiUrl({ cloudApiUrl: "cloud.example" }, { TUMBLE_CODE_API_URL: "https://b" })

		expect(resolution.ok).toBe(false)
		expect(!resolution.ok && resolution.message).toContain('is not an http(s) URL: "cloud.example"')
	})
})

describe("cloudApiUrlSetting", () => {
	it("hands the extension only a valid settings value", () => {
		const warn = vi.fn()

		expect(cloudApiUrlSetting({ cloudApiUrl: "https://a.example/" }, warn)).toBe("https://a.example")
		expect(cloudApiUrlSetting({}, warn)).toBeUndefined()
		expect(warn).not.toHaveBeenCalled()

		expect(cloudApiUrlSetting({ cloudApiUrl: "nope" }, warn)).toBeUndefined()
		expect(warn).toHaveBeenCalledWith(expect.stringContaining("is not an http(s) URL"))
	})
})

describe("restoreCloudPort", () => {
	const signIn = "http://127.0.0.1/extension/sign-in?state=s&auth_redirect=http%3A%2F%2F127.0.0.1%3A53682"

	it("puts back the cloud's port the shim's Uri.parse dropped", () => {
		expect(restoreCloudPort(signIn, "http://127.0.0.1:8000")).toBe(
			"http://127.0.0.1:8000/extension/sign-in?state=s&auth_redirect=http%3A%2F%2F127.0.0.1%3A53682",
		)
	})

	it.each([
		[signIn, "http://127.0.0.1"],
		["http://127.0.0.1:9000/extension/sign-in", "http://127.0.0.1:8000"],
		["https://other.example/x", "https://cloud.example:8443"],
		["https://cloud.example/x", "http://cloud.example:8000"],
		["not a url", "http://127.0.0.1:8000"],
	])("leaves %s alone for the cloud %s", (url, cloud) => {
		expect(restoreCloudPort(url, cloud)).toBe(url)
	})
})
