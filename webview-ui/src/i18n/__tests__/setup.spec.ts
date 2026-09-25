// Loading the i18n setup module must not print to the webview console: it runs
// in every production webview and used to log the list of loaded languages.

describe("i18n setup", () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it("loads the locale files without logging to the console", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {})

		vi.resetModules()
		const { default: i18next, loadTranslations } = await import("../setup")
		loadTranslations()

		expect(i18next.hasResourceBundle("en", "common")).toBe(true)
		expect(logSpy).not.toHaveBeenCalled()
	})
})
