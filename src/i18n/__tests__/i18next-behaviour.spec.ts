// Characterization of the i18next behaviour the extension relies on, run
// against the real i18n setup (its init options) with the real English and
// Polish locale files added (the setup loads no files under NODE_ENV=test).
// A major bump of i18next must keep every expectation here, or the diff shows
// what users would see differently.

import fs from "fs"
import path from "path"

import i18next from "../setup"
import { changeLanguage, t } from "../index"

const LOCALES = path.join(__dirname, "..", "locales")

describe("i18next behaviour used by the extension", () => {
	beforeAll(() => {
		for (const language of ["en", "pl"]) {
			for (const file of fs.readdirSync(path.join(LOCALES, language))) {
				const namespace = path.basename(file, ".json")
				const content = JSON.parse(fs.readFileSync(path.join(LOCALES, language, file), "utf8"))
				i18next.addResourceBundle(language, namespace, content, true, true)
			}
		}
	})

	afterEach(() => {
		changeLanguage("en")
	})

	it("interpolates double-brace values without HTML escaping", () => {
		expect(t("common:welcome", { name: "<Ann> & 'Bo'", count: 3 })).toBe(
			"Welcome, <Ann> & 'Bo'! You have 3 notifications.",
		)
	})

	it("keeps $ sequences in values and single-brace placeholders literal", () => {
		expect(t("common:errors.could_not_open_file", { errorMessage: "$& $$ $' $`" })).toBe(
			"Could not open file: $& $$ $' $`",
		)
		expect(t("common:confirmation.delete_custom_mode_with_rules", { scope: "project" })).toContain(
			"delete this {scope} mode",
		)
	})

	it("returns nested objects only when asked, and the key path otherwise", () => {
		expect(t("common:items")).toBe("key 'items (en)' returned an object instead of string.")
		expect(t("common:items", { returnObjects: true })).toEqual({
			zero: "No items",
			one: "One item",
			other: "{{count}} items",
		})
		expect(t("common:items.other", { count: 4 })).toBe("4 items")
	})

	it("returns the key without its namespace for a missing key, or the default value", () => {
		expect(t("common:no.such.key")).toBe("no.such.key")
		expect(t("common:no.such.key", { defaultValue: "fallback {{x}}", x: 1 })).toBe("fallback 1")
	})

	it("switches language and falls back to English for keys a locale lacks", async () => {
		i18next.addResource("en", "common", "__probe_en", "english {{v}}")
		changeLanguage("pl")
		// changeLanguage does not await; i18next applies it synchronously once resources exist.
		await Promise.resolve()
		expect(i18next.language).toBe("pl")
		expect(t("common:welcome", { name: "Ala", count: 5 })).toBe("Witaj, Ala! Masz 5 powiadomień.")
		expect(t("common:__probe_en", { v: 1 })).toBe("english 1")

		changeLanguage("xx")
		await Promise.resolve()
		expect(t("common:welcome", { name: "A", count: 1 })).toBe("Welcome, A! You have 1 notifications.")
	})
})
