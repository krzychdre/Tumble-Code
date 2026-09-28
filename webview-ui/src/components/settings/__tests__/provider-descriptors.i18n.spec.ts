// Every translation key a PROVIDER_DESCRIPTORS row names (labels, notes, link texts, option
// texts) must exist in every locale's settings.json. The generic descriptor form passes these
// keys to `t()` at runtime, so a typo or a key missing in one locale would otherwise only show up
// as the raw key in that language's settings view.

import fs from "node:fs"
import path from "node:path"

import { PROVIDER_DESCRIPTORS } from "@roo-code/types"

const localesDir = path.resolve(__dirname, "../../../i18n/locales")
const locales = fs.readdirSync(localesDir).filter((name) => !name.startsWith("__"))

/** Every string in the table that starts with the settings namespace, with where it was found. */
const collectKeys = (value: unknown, where: string, out: [string, string][]) => {
	if (typeof value === "string") {
		if (value.startsWith("settings:")) {
			out.push([where, value])
		}
	} else if (Array.isArray(value)) {
		value.forEach((item, index) => collectKeys(item, `${where}[${index}]`, out))
	} else if (value && typeof value === "object") {
		for (const [name, item] of Object.entries(value)) {
			collectKeys(item, `${where}.${name}`, out)
		}
	}
	return out
}

const keys = collectKeys(PROVIDER_DESCRIPTORS, "PROVIDER_DESCRIPTORS", [])

const lookup = (messages: unknown, key: string): unknown =>
	key
		.slice("settings:".length)
		.split(".")
		.reduce<unknown>(
			(node, part) => (node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined),
			messages,
		)

describe("PROVIDER_DESCRIPTORS translation keys", () => {
	it("names some keys (the walk found the table's fields)", () => {
		expect(keys.length).toBeGreaterThan(20)
		expect(keys.map(([, key]) => key)).toContain("settings:serviceTier.label")
	})

	it.each(locales)("exist as text in %s/settings.json", (locale) => {
		const messages = JSON.parse(fs.readFileSync(path.join(localesDir, locale, "settings.json"), "utf8"))
		const missing = keys.filter(([, key]) => typeof lookup(messages, key) !== "string")
		expect(missing).toEqual([])
	})
})
