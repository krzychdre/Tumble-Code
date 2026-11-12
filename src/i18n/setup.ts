import i18next from "i18next"

import { logger } from "../utils/logging"

// Build translations object
const translations: Record<string, Record<string, any>> = {}

// Determine if running in test environment
const isTestEnv = process.env.NODE_ENV === "test"

// Load translations based on environment
if (!isTestEnv) {
	// Deferred CJS requires so a bundler never pulls Node builtins into a
	// browser-facing bundle graph.
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	const fs = require("fs") as typeof import("fs")
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	const path = require("path") as typeof import("path")

	const localesDir = path.join(__dirname, "i18n", "locales")

	for (const languageDir of fs.readdirSync(localesDir, { withFileTypes: true })) {
		if (!languageDir.isDirectory() || languageDir.name.startsWith(".")) {
			continue
		}
		const language = languageDir.name
		translations[language] = {}

		for (const file of fs.readdirSync(path.join(localesDir, language), { withFileTypes: true })) {
			if (!file.isFile() || !file.name.endsWith(".json") || file.name.startsWith(".")) {
				continue
			}
			const namespace = path.basename(file.name, ".json")
			const filePath = path.join(localesDir, language, file.name)
			try {
				translations[language][namespace] = JSON.parse(fs.readFileSync(filePath, "utf8"))
			} catch (error) {
				logger.error(`Error loading translation file ${filePath}:`, error)
			}
		}
	}

	logger.info(`Loaded translations for languages: ${Object.keys(translations).join(", ")}`)
}

// Initialize i18next with configuration
i18next.init({
	lng: "en",
	fallbackLng: "en",
	debug: false,
	resources: translations,
	interpolation: {
		escapeValue: false,
	},
})

export default i18next
