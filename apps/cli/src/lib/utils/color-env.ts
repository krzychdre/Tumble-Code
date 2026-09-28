/**
 * NO_COLOR and FORCE_COLOR (no-color.org, UI plan §4).
 *
 * Every colour the TUI draws goes through ink, and ink goes through chalk.
 * Chalk's colour detection (chalk 5.6, source/vendor/supports-color) honours
 * FORCE_COLOR but never looks at NO_COLOR, so `NO_COLOR=1 tumble` still drew
 * colour. The fix speaks chalk's own language: a non-empty NO_COLOR becomes
 * FORCE_COLOR=0, unless FORCE_COLOR is already set, because a set FORCE_COLOR
 * wins over NO_COLOR.
 *
 * Chalk reads the environment once, when it is first imported, so this has
 * to run before anything loads ink (index.ts calls it first). Child processes
 * inherit the result, which matches what the user asked for: they already
 * inherit NO_COLOR itself.
 */
export function applyColorEnv(env: NodeJS.ProcessEnv): void {
	if (env.FORCE_COLOR !== undefined) {
		return
	}

	if (env.NO_COLOR) {
		env.FORCE_COLOR = "0"
	}
}
