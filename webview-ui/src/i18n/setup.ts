import i18next from "i18next"
import { initReactI18next } from "react-i18next"

type LocaleModule = { default?: Record<string, unknown> } & Record<string, unknown>

// English is the fallback language, so it ships in the startup bundle. Every other
// locale is a lazy chunk (one per language, see vite.config.ts) fetched by
// loadLanguage() when the extension state asks for it.
const englishFiles = import.meta.glob<LocaleModule>("./locales/en/*.json", { eager: true })
const lazyLocaleFiles = import.meta.glob<LocaleModule>(["./locales/*/*.json", "!./locales/en/*.json"])

// Example path: './locales/en/common.json' -> language: 'en', namespace: 'common'
const parseLocalePath = (path: string) => {
	const match = path.match(/\.\/locales\/([^/]+)\/([^/]+)\.json$/)
	return match ? { language: match[1], namespace: match[2] } : undefined
}

const englishResources: Record<string, Record<string, unknown>> = {}

for (const [path, module] of Object.entries(englishFiles)) {
	const parsed = parseLocalePath(path)

	if (parsed) {
		englishResources[parsed.namespace] = module.default ?? module
	}
}

// Initialize i18next for React. The language is switched to the VS Code language
// by TranslationProvider once that locale is loaded.
i18next.use(initReactI18next).init({
	lng: "en",
	fallbackLng: "en",
	resources: { en: englishResources },
	// Other languages are added later with addResourceBundle.
	partialBundledLanguages: true,
	debug: false,
	interpolation: {
		escapeValue: false, // React already escapes by default
	},
})

const loadedLanguages = new Set<string>(["en"])
const pendingLoads = new Map<string, Promise<void>>()

export function isLanguageLoaded(language: string): boolean {
	return loadedLanguages.has(language)
}

/**
 * Fetches every namespace of `language` and registers it with i18next. Repeated
 * calls share one promise. A language with no locale files (or whose chunk failed
 * to load) counts as loaded, so i18next simply falls back to English for it.
 */
export function loadLanguage(language: string): Promise<void> {
	if (loadedLanguages.has(language)) {
		return Promise.resolve()
	}

	const pending = pendingLoads.get(language)

	if (pending) {
		return pending
	}

	const loaders = Object.entries(lazyLocaleFiles).filter(
		([path]) => parseLocalePath(path)?.language === language,
	)

	const load = Promise.all(
		loaders.map(async ([path, loader]) => {
			const module = await loader()
			const { namespace } = parseLocalePath(path)!
			i18next.addResourceBundle(language, namespace, module.default ?? module, true, true)
		}),
	)
		.catch((error) => {
			// A chunk that failed once will not load on a retry either: settle on
			// the English fallback instead of leaving the first render waiting.
			console.warn(`Could not load ${language} translations:`, error)
		})
		.then(() => {
			loadedLanguages.add(language)
			pendingLoads.delete(language)
		})

	pendingLoads.set(language, load)
	return load
}

export default i18next
