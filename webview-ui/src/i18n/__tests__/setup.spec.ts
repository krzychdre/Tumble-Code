// Loading the i18n setup module must not print to the webview console: it runs
// in every production webview and used to log the list of loaded languages.

describe("i18n setup", () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it("loads the English locale without logging to the console", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {})

		vi.resetModules()
		const { default: i18next } = await import("../setup")

		expect(i18next.hasResourceBundle("en", "common")).toBe(true)
		expect(logSpy).not.toHaveBeenCalled()
	})

	it("loads another locale only when asked, and only once", async () => {
		vi.resetModules()
		const { default: i18next, loadLanguage, isLanguageLoaded } = await import("../setup")

		expect(isLanguageLoaded("fr")).toBe(false)
		expect(i18next.hasResourceBundle("fr", "settings")).toBe(false)

		const first = loadLanguage("fr")
		expect(loadLanguage("fr")).toBe(first)
		await first

		expect(isLanguageLoaded("fr")).toBe(true)
		expect(i18next.hasResourceBundle("fr", "settings")).toBe(true)
		expect(i18next.hasResourceBundle("de", "settings")).toBe(false)
	})

	it("treats an unknown language as loaded, so it falls back to English", async () => {
		vi.resetModules()
		const { loadLanguage, isLanguageLoaded } = await import("../setup")

		await loadLanguage("xx")

		expect(isLanguageLoaded("xx")).toBe(true)
	})
})
