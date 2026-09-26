// Unit tests for the lazy Shiki highlighter: theme loading is on demand
// (only the theme the caller passes is ever loaded) while languages keep the
// existing pending-load deduplication behavior.
//
// The highlighter is a module-level singleton, so each test re-imports the
// module fresh (vi.resetModules) to start from a clean state.

const { createHighlighterMock, instanceMock } = vi.hoisted(() => {
	const instance = {
		loadLanguage: vi.fn(async (lang: string) => {
			if (lang === "boom") throw new Error("lang load failed")
		}),
		loadTheme: vi.fn(async (theme: string) => {
			if (theme === "bad") throw new Error("theme load failed")
		}),
		codeToHast: vi.fn(),
	}

	const createHighlighter = vi.fn(async (_options: { themes: unknown[]; langs: unknown[] }) => instance)

	return { createHighlighterMock: createHighlighter, instanceMock: instance }
})

vi.mock("shiki", () => ({
	createHighlighter: createHighlighterMock,
	bundledLanguages: {
		shell: {},
		log: {},
		typescript: {},
		javascript: {},
		txt: {},
	},
}))

type HighlighterModule = typeof import("../highlighter")

const freshImport = async (): Promise<HighlighterModule> => {
	vi.resetModules()
	return await import("../highlighter")
}

describe("highlighter (lazy themes)", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("creates the highlighter with no themes registered upfront", async () => {
		const { getHighlighter } = await freshImport()

		await getHighlighter("typescript", "github-dark")

		expect(createHighlighterMock).toHaveBeenCalledTimes(1)
		expect(createHighlighterMock).toHaveBeenCalledWith({ themes: [], langs: ["shell", "log"] })
	})

	it("loads the requested theme on demand and only once", async () => {
		const { getHighlighter, isThemeLoaded } = await freshImport()

		const instance = await getHighlighter("typescript", "github-light")

		expect(instance.loadTheme).toHaveBeenCalledTimes(1)
		expect(instance.loadTheme).toHaveBeenCalledWith("github-light")
		expect(isThemeLoaded("github-light")).toBe(true)
		expect(isThemeLoaded("github-dark")).toBe(false)

		// Second call with the same theme must not load again.
		await getHighlighter("javascript", "github-light")
		expect(instance.loadTheme).toHaveBeenCalledTimes(1)
	})

	it("loads the other theme on demand when the theme switches", async () => {
		const { getHighlighter, isThemeLoaded } = await freshImport()

		const instance = await getHighlighter("typescript", "github-light")
		expect(instance.loadTheme).toHaveBeenCalledWith("github-light")

		await getHighlighter("typescript", "github-dark")
		expect(instance.loadTheme).toHaveBeenCalledWith("github-dark")
		expect(isThemeLoaded("github-dark")).toBe(true)
	})

	it("deduplicates concurrent loads of the same theme", async () => {
		const { getHighlighter } = await freshImport()

		const [a, b, c] = await Promise.all([
			getHighlighter("typescript"),
			getHighlighter("typescript", "github-dark"),
			getHighlighter("typescript", "github-dark"),
		])

		expect(a).toBe(b)
		expect(b).toBe(c)
		expect(instanceMock.loadTheme).toHaveBeenCalledTimes(1)
	})

	it("reuses the singleton highlighter across calls", async () => {
		const { getHighlighter } = await freshImport()

		const a = await getHighlighter("typescript", "github-light")
		const b = await getHighlighter("javascript")

		expect(a).toBe(b)
		expect(createHighlighterMock).toHaveBeenCalledTimes(1)
	})

	it("does not load any theme when none is requested", async () => {
		const { getHighlighter } = await freshImport()

		const instance = await getHighlighter("typescript")
		expect(instance.loadTheme).not.toHaveBeenCalled()
	})

	it("lets a failed theme load be retried on the next call", async () => {
		const { getHighlighter, isThemeLoaded } = await freshImport()

		// The "bad" theme fails to load: getHighlighter rejects.
		await expect(getHighlighter("typescript", "bad" as never)).rejects.toThrow("theme load failed")
		expect(isThemeLoaded("bad" as never)).toBe(false)

		// The pending load was cleared, so a later render can retry and a
		// different theme still loads normally.
		const instance = await getHighlighter("typescript", "github-dark")
		expect(instance.loadTheme).toHaveBeenCalledWith("github-dark")
		expect(isThemeLoaded("github-dark")).toBe(true)
	})

	it("keeps language loading lazy and deduplicated", async () => {
		const { getHighlighter, isLanguageLoaded } = await freshImport()

		const instance = await getHighlighter("typescript")
		expect(instance.loadLanguage).toHaveBeenCalledWith("typescript")
		// Initial languages are pre-loaded, txt is implicit.
		expect(isLanguageLoaded("shell")).toBe(true)
		expect(isLanguageLoaded("txt")).toBe(true)

		await getHighlighter("typescript")
		expect(instance.loadLanguage).toHaveBeenCalledTimes(1)
	})

	it("normalizes aliases and unknown languages", async () => {
		const { normalizeLanguage } = await freshImport()
		expect(normalizeLanguage("boom")).toBe("txt")
		expect(normalizeLanguage("ts")).toBe("typescript")
		expect(normalizeLanguage(undefined)).toBe("txt")
	})
})
