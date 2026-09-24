/**
 * Locale variables for commands run by the execa terminal.
 *
 * Commands used to get a hardcoded `LANG`/`LC_ALL` of `en_US.UTF-8` so that tools
 * such as Ruby and CocoaPods always emit UTF-8. Forcing it unconditionally replaced a
 * host locale that already was UTF-8 (for example pl_PL.UTF-8): commands then sorted,
 * formatted dates and numbers as US English, and on hosts where en_US.UTF-8 is not
 * generated every command printed `setlocale: LC_ALL: cannot change locale`.
 */

/** Used only when the host does not already select a UTF-8 locale. */
const FALLBACK_UTF8_LOCALE = "en_US.UTF-8"

/**
 * The locale that decides the character encoding: POSIX takes the first non-empty
 * value of `LC_ALL`, `LC_CTYPE` and `LANG`.
 */
function getEffectiveCtypeLocale(env: NodeJS.ProcessEnv): string {
	return env.LC_ALL || env.LC_CTYPE || env.LANG || ""
}

/** Matches both the `UTF-8` and the `utf8` spelling. */
function isUtf8Locale(locale: string): boolean {
	return /utf-?8/i.test(locale)
}

/**
 * Locale overrides to merge into a spawned command's environment: none when the host
 * locale already is UTF-8, otherwise `LANG` and `LC_ALL` set to en_US.UTF-8.
 */
export function getUtf8LocaleEnv(env: NodeJS.ProcessEnv = process.env): { LANG?: string; LC_ALL?: string } {
	if (isUtf8Locale(getEffectiveCtypeLocale(env))) {
		return {}
	}
	return { LANG: FALLBACK_UTF8_LOCALE, LC_ALL: FALLBACK_UTF8_LOCALE }
}
