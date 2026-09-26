import fs from "fs"
import path from "path"

// i18next picks a plural form with Intl.PluralRules: for t("x", { count }) it looks
// up "x_" + new Intl.PluralRules(language).select(count). English only has one and
// other, but Polish and Russian also ask for few and many (2 and 5 results), and
// the Romance languages ask for many (a million). When the locale lacks the asked
// form, i18next falls back to the bare key of that locale (if any) and then to the
// English text, so a Polish user saw "Found 2 results". This spec checks, for every
// plural key of the English files, that every locale has every form it can be
// asked for. The bare key counts only as the "one" form (English uses it that way).

const TREES = {
	webview: path.join(__dirname, "..", "locales"),
	extension: path.join(__dirname, "..", "..", "..", "..", "src", "i18n", "locales"),
}

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/

// Forms that are knowingly missing, as "tree/locale/file:key_category". Keep empty
// unless a translator is needed; every entry is a TODO to fill the form in.
const KNOWN_MISSING = new Set<string>([])

type Flat = Record<string, unknown>

function flatten(value: unknown, prefix = "", out: Flat = {}): Flat {
	if (value && typeof value === "object" && !Array.isArray(value)) {
		for (const [key, child] of Object.entries(value)) {
			flatten(child, prefix ? `${prefix}.${key}` : key, out)
		}
	} else {
		out[prefix] = value
	}
	return out
}

function readJson(file: string): Flat {
	const text = fs.readFileSync(file, "utf8")
	return text.trim() ? flatten(JSON.parse(text)) : {}
}

const directories = (dir: string) =>
	fs.readdirSync(dir).filter((name) => fs.statSync(path.join(dir, name)).isDirectory())

type Case = { tree: string; locale: string; file: string; base: string; localized: Flat }

const cases: Case[] = []

for (const [tree, root] of Object.entries(TREES)) {
	for (const file of fs.readdirSync(path.join(root, "en")).filter((name) => name.endsWith(".json"))) {
		const english = readJson(path.join(root, "en", file))
		const bases = [
			...new Set(
				Object.keys(english)
					.filter((key) => PLURAL_SUFFIX.test(key))
					.map((key) => key.replace(PLURAL_SUFFIX, "")),
			),
		]

		for (const locale of directories(root)) {
			const localized = readJson(path.join(root, locale, file))

			for (const base of bases) {
				cases.push({ tree, locale, file, base, localized })
			}
		}
	}
}

describe("plural forms in every locale", () => {
	it("finds the plural keys of the English files", () => {
		expect(cases.map((c) => `${c.tree}/${c.locale}/${c.file}:${c.base}`)).toContain(
			"webview/pl/chat.json:codebaseSearch.didSearch",
		)
	})

	it.each(cases)(
		"$tree/$locale/$file: $base has every form Intl.PluralRules($locale) can select",
		({ tree, locale, file, base, localized }) => {
			const categories = new Intl.PluralRules(locale).resolvedOptions().pluralCategories
			const missing = categories.filter((category) => {
				if (KNOWN_MISSING.has(`${tree}/${locale}/${file}:${base}_${category}`)) {
					return false
				}
				if (typeof localized[`${base}_${category}`] === "string") {
					return false
				}
				return !(category === "one" && typeof localized[base] === "string")
			})

			expect(missing).toEqual([])
		},
	)

	// In some languages the "one" form also covers other numbers: 0 in French,
	// Portuguese and Hindi, 21 and 101 in Russian. A "_one" text with a literal "1"
	// then shows "1 result" for 0 or 21 results.
	it.each(cases)(
		"$tree/$locale/$file: the one form of $base interpolates the count when one covers more than 1",
		({ locale, base, localized }) => {
			const rules = new Intl.PluralRules(locale)
			const others = [0, 21, 101].filter((count) => rules.select(count) === "one")
			const one = localized[`${base}_one`] ?? localized[base]

			if (others.length === 0 || typeof one !== "string") {
				return
			}
			// A _zero form wins over _one for 0, so it is enough when 0 is the only other number.
			if (others.every((count) => count === 0) && typeof localized[`${base}_zero`] === "string") {
				return
			}

			expect(one).toContain("{{count}}")
		},
	)
})
