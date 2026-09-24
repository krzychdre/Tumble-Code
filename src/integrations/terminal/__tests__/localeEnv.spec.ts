// npx vitest run integrations/terminal/__tests__/localeEnv.spec.ts

import { getUtf8LocaleEnv } from "../localeEnv"

const FALLBACK = { LANG: "en_US.UTF-8", LC_ALL: "en_US.UTF-8" }

describe("getUtf8LocaleEnv", () => {
	it("keeps a UTF-8 LANG", () => {
		expect(getUtf8LocaleEnv({ LANG: "pl_PL.UTF-8" })).toEqual({})
	})

	it("accepts the utf8 spelling", () => {
		expect(getUtf8LocaleEnv({ LANG: "de_DE.utf8" })).toEqual({})
	})

	it("keeps a UTF-8 LC_CTYPE when LC_ALL is unset", () => {
		expect(getUtf8LocaleEnv({ LC_CTYPE: "C.UTF-8", LANG: "C" })).toEqual({})
	})

	it("falls back when LC_ALL selects a non-UTF-8 locale, even with a UTF-8 LANG", () => {
		// LC_ALL wins over LANG, so the effective locale here is POSIX.
		expect(getUtf8LocaleEnv({ LC_ALL: "POSIX", LANG: "pl_PL.UTF-8" })).toEqual(FALLBACK)
	})

	it("falls back when the effective locale is not UTF-8", () => {
		expect(getUtf8LocaleEnv({ LANG: "C" })).toEqual(FALLBACK)
		expect(getUtf8LocaleEnv({ LANG: "pl_PL.ISO-8859-2" })).toEqual(FALLBACK)
	})

	it("falls back when no locale variable is set", () => {
		expect(getUtf8LocaleEnv({})).toEqual(FALLBACK)
		expect(getUtf8LocaleEnv({ LC_ALL: "", LC_CTYPE: "", LANG: "" })).toEqual(FALLBACK)
	})
})
