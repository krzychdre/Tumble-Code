/**
 * NO_COLOR / FORCE_COLOR (UI plan §4). Ink draws every colour through chalk,
 * and chalk's colour detection honours FORCE_COLOR but ignores NO_COLOR
 * (chalk 5.6 source/vendor/supports-color). no-color.org asks for a non-empty
 * NO_COLOR to turn colour off, and FORCE_COLOR, when set, to win over it.
 */

import { applyColorEnv } from "../color-env.js"

describe("applyColorEnv", () => {
	it("turns colour off for a non-empty NO_COLOR by setting FORCE_COLOR=0 for chalk", () => {
		const env: NodeJS.ProcessEnv = { NO_COLOR: "1" }

		applyColorEnv(env)

		expect(env.FORCE_COLOR).toBe("0")
	})

	it("treats any non-empty NO_COLOR value as set, even 0 or false", () => {
		for (const value of ["0", "false", "yes"]) {
			const env: NodeJS.ProcessEnv = { NO_COLOR: value }

			applyColorEnv(env)

			expect(env.FORCE_COLOR).toBe("0")
		}
	})

	it("ignores an empty NO_COLOR", () => {
		const env: NodeJS.ProcessEnv = { NO_COLOR: "" }

		applyColorEnv(env)

		expect(env.FORCE_COLOR).toBeUndefined()
	})

	it("lets FORCE_COLOR win over NO_COLOR", () => {
		const env: NodeJS.ProcessEnv = { NO_COLOR: "1", FORCE_COLOR: "3" }

		applyColorEnv(env)

		expect(env.FORCE_COLOR).toBe("3")
	})

	it("keeps an empty FORCE_COLOR as set (chalk reads it as basic colour)", () => {
		const env: NodeJS.ProcessEnv = { NO_COLOR: "1", FORCE_COLOR: "" }

		applyColorEnv(env)

		expect(env.FORCE_COLOR).toBe("")
	})

	it("changes nothing when neither variable is set", () => {
		const env: NodeJS.ProcessEnv = { TERM: "xterm-256color" }

		applyColorEnv(env)

		expect(env).toEqual({ TERM: "xterm-256color" })
	})
})
