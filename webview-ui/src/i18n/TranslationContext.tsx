import React, { createContext, useContext, ReactNode, useEffect, useCallback, useState, Suspense } from "react"
import { useTranslation } from "react-i18next"
import i18next, { loadLanguage } from "./setup"
import { useExtensionState } from "@/context/ExtensionStateContext"

// Create context for translations
export const TranslationContext = createContext<{
	t: (key: string, options?: Record<string, any>) => string
	i18n: typeof i18next
}>({
	t: (key: string) => key,
	i18n: i18next,
})

// Loads the language's chunk, then switches i18next to it. Concurrent callers (a
// suspended render retried by React, the provider effect) share one promise.
// Only the most recently requested language is applied, so a slow chunk from a
// quick earlier switch cannot win over the language the user picked last.
const pendingSwitches = new Map<string, Promise<unknown>>()
let requestedLanguage: string | undefined

const switchLanguage = (language: string) => {
	requestedLanguage = language
	let pending = pendingSwitches.get(language)

	if (!pending) {
		pending = loadLanguage(language)
			.then(() => (requestedLanguage === language ? i18next.changeLanguage(language) : undefined))
			.finally(() => pendingSwitches.delete(language))
		pendingSwitches.set(language, pending)
	}

	return pending
}

/**
 * Holds back the first render of the hydrated UI until the extension's language is
 * loaded and active, so the panel never paints English (or raw keys) for a frame
 * before switching. Suspending keeps the already mounted tree (it is only hidden),
 * and the chunk is a local file, so the wait is a few milliseconds.
 */
const FirstRenderLanguageGate: React.FC<{ language: string; hold: boolean; children: ReactNode }> = ({
	language,
	hold,
	children,
}) => {
	if (hold && i18next.language !== language) {
		throw switchLanguage(language)
	}

	return <>{children}</>
}

// Translation provider component
export const TranslationProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
	// Subscribes to languageChanged, so the context value refreshes on a switch.
	const { i18n } = useTranslation()
	const extensionState = useExtensionState()
	const language = extensionState.language ?? "en"
	const didHydrateState = extensionState.didHydrateState
	// Latches once the hydrated UI has rendered in its language; after that a
	// switch never holds the tree back again.
	const [hasShownHydratedUi, setHasShownHydratedUi] = useState(false)

	useEffect(() => {
		// Later switches (for example from the settings view) keep showing the
		// current language until the new locale has loaded.
		switchLanguage(language).catch((error) => console.error("Failed to switch language:", error))
	}, [language])

	const hydratedInLanguage = !!didHydrateState && i18n.language === language

	useEffect(() => {
		if (hydratedInLanguage) {
			setHasShownHydratedUi(true)
		}
	}, [hydratedInLanguage])

	// Memoize the translation function to prevent unnecessary re-renders
	const translate = useCallback(
		(key: string, options?: Record<string, any>) => {
			return i18n.t(key, options)
		},
		[i18n],
	)

	return (
		<TranslationContext.Provider
			value={{
				t: translate,
				i18n,
			}}>
			<Suspense fallback={null}>
				<FirstRenderLanguageGate
					language={language}
					hold={!!didHydrateState && !hasShownHydratedUi}>
					{children}
				</FirstRenderLanguageGate>
			</Suspense>
		</TranslationContext.Provider>
	)
}

// Custom hook for easy translations
export const useAppTranslation = () => useContext(TranslationContext)

export default TranslationProvider
