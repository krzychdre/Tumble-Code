import { createHighlighter, type Highlighter, type BundledLanguage, bundledLanguages } from "shiki"

// Extend BundledLanguage to include 'txt' because Shiki supports this but it is
// not listed in the bundled languages
export type ExtendedLanguage = BundledLanguage | "txt"

// The only Shiki themes the webview ever requests (CodeBlock picks one from
// the VS Code body class, highlightDiff from its light/dark prop). They are
// loaded on demand instead of registering every bundled theme at startup.
export type ShikiThemeName = "github-light" | "github-dark"

// Map common language aliases to their Shiki BundledLanguage equivalent
const languageAliases: Record<string, ExtendedLanguage> = {
	// Plain text variants
	text: "txt",
	plaintext: "txt",
	plain: "txt",

	// Shell/Bash variants
	sh: "shell",
	bash: "shell",
	zsh: "shell",
	shellscript: "shell",
	"shell-script": "shell",
	console: "shell",
	terminal: "shell",

	// JavaScript variants
	js: "javascript",
	node: "javascript",
	nodejs: "javascript",

	// TypeScript variants
	ts: "typescript",

	// Python variants
	py: "python",
	python3: "python",
	py3: "python",

	// Ruby variants
	rb: "ruby",

	// Markdown variants
	md: "markdown",

	// C++ variants
	cpp: "c++",
	cc: "c++",

	// C# variants
	cs: "c#",
	csharp: "c#",

	// HTML variants
	htm: "html",

	// YAML variants
	yml: "yaml",

	// Docker variants
	dockerfile: "docker",

	// CSS variants
	styles: "css",
	style: "css",

	// JSON variants
	jsonc: "json",
	json5: "json",

	// XML variants
	xaml: "xml",
	xhtml: "xml",
	svg: "xml",

	// SQL variants
	mysql: "sql",
	postgresql: "sql",
	postgres: "sql",
	pgsql: "sql",
	plsql: "sql",
	oracle: "sql",
}

// Track which languages we've warned about to avoid duplicate warnings
const warnedLanguages = new Set<string>()

// Normalize language to a valid Shiki language
export function normalizeLanguage(language: string | undefined): ExtendedLanguage {
	if (language === undefined) {
		return "txt"
	}

	// Convert to lowercase for consistent matching
	const normalizedInput = language.toLowerCase()

	// If it's already a valid bundled language, return it
	if (normalizedInput in bundledLanguages) {
		return normalizedInput as BundledLanguage
	}

	// Check if it's an alias
	if (normalizedInput in languageAliases) {
		return languageAliases[normalizedInput]
	}

	// Warn about unrecognized language and default to txt (only once per language)
	if (language !== "txt" && !warnedLanguages.has(language)) {
		console.warn(`[Shiki] Unrecognized language '${language}', defaulting to txt.`)
		warnedLanguages.add(language)
	}

	return "txt"
}

// Export function to check if a language is loaded
export const isLanguageLoaded = (language: string): boolean => {
	return state.loadedLanguages.has(normalizeLanguage(language))
}

// Export function to check if a theme is loaded
export const isThemeLoaded = (theme: ShikiThemeName): boolean => {
	return state.loadedThemes.has(theme)
}

// Common languages for first-stage initialization
const initialLanguages: BundledLanguage[] = ["shell", "log"]

// Singleton state
const state: {
	instance: Highlighter | null
	instanceInitPromise: Promise<Highlighter> | null
	loadedLanguages: Set<ExtendedLanguage>
	pendingLanguageLoads: Map<ExtendedLanguage, Promise<void>>
	loadedThemes: Set<ShikiThemeName>
	pendingThemeLoads: Map<ShikiThemeName, Promise<void>>
} = {
	instance: null,
	instanceInitPromise: null,
	loadedLanguages: new Set<ExtendedLanguage>(["txt"]),
	pendingLanguageLoads: new Map(),
	loadedThemes: new Set<ShikiThemeName>(),
	pendingThemeLoads: new Map(),
}

// Load a language on the highlighter instance if it's not loaded yet.
// Concurrent requests for the same language share one pending promise.
const ensureLanguage = async (instance: Highlighter, shikilang: ExtendedLanguage): Promise<void> => {
	// txt is already in loadedLanguages
	if (state.loadedLanguages.has(shikilang)) {
		return
	}

	// Check for existing pending load
	let loadingPromise = state.pendingLanguageLoads.get(shikilang)

	if (!loadingPromise) {
		loadingPromise = (async () => {
			try {
				await instance.loadLanguage(shikilang as BundledLanguage)
				state.loadedLanguages.add(shikilang)
			} catch (error) {
				console.error(`[Shiki] Failed to load language ${shikilang}:`, error)
				throw error
			} finally {
				// Clean up pending promise after completion
				state.pendingLanguageLoads.delete(shikilang)
			}
		})()

		// Store the promise
		state.pendingLanguageLoads.set(shikilang, loadingPromise)
	}

	await loadingPromise
}

// Load a theme on the highlighter instance if it's not loaded yet.
// Concurrent requests for the same theme share one pending promise, and a
// failed load is cleared so a later render can retry it.
const ensureTheme = async (instance: Highlighter, theme: ShikiThemeName): Promise<void> => {
	if (state.loadedThemes.has(theme)) {
		return
	}

	// Check for existing pending load
	let loadingPromise = state.pendingThemeLoads.get(theme)

	if (!loadingPromise) {
		loadingPromise = (async () => {
			try {
				await instance.loadTheme(theme)
				state.loadedThemes.add(theme)
			} catch (error) {
				console.error(`[Shiki] Failed to load theme ${theme}:`, error)
				throw error
			} finally {
				// Clean up pending promise after completion (including failures,
				// so a later render can retry the load)
				state.pendingThemeLoads.delete(theme)
			}
		})()

		// Store the promise
		state.pendingThemeLoads.set(theme, loadingPromise)
	}

	await loadingPromise
}

export const getHighlighter = async (language?: string, theme?: ShikiThemeName): Promise<Highlighter> => {
	try {
		const shikilang = normalizeLanguage(language)

		// Initialize highlighter if needed. No themes are registered upfront:
		// the highlighter is created theme-less and each theme is loaded on
		// demand (only github-light/github-dark are ever requested).
		if (!state.instanceInitPromise) {
			state.instanceInitPromise = (async () => {
				const instance = await createHighlighter({
					themes: [],
					langs: initialLanguages,
				})

				state.instance = instance

				// Track initially loaded languages
				initialLanguages.forEach((lang) => state.loadedLanguages.add(lang))

				return instance
			})()
		}

		// Wait for initialization to complete
		const instance = await state.instanceInitPromise

		// Load requested language if needed
		await ensureLanguage(instance, shikilang)

		// Load requested theme if needed
		if (theme) {
			await ensureTheme(instance, theme)
		}

		return instance
	} catch (error) {
		console.error("[Shiki] Error in getHighlighter:", error)
		throw error
	}
}
