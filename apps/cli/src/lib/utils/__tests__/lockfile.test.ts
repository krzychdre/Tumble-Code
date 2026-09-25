import fs from "fs"

import { lockedVersions } from "./lockfile.js"

describe("lockedVersions", () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	// git on Windows (core.autocrlf, the default on the CI runners) checks
	// pnpm-lock.yaml out with CRLF line endings.
	it("reads the same versions from a lockfile with CRLF line endings", () => {
		const expected = lockedVersions()
		expect(expected.ink).toMatch(/^\d+\.\d+\.\d+/)

		const readFileSync = fs.readFileSync
		vi.spyOn(fs, "readFileSync").mockImplementation(((...args: Parameters<typeof fs.readFileSync>) =>
			String(readFileSync(...args))
				.replace(/\r\n/g, "\n")
				.replace(/\n/g, "\r\n")) as typeof fs.readFileSync)

		expect(lockedVersions()).toEqual(expected)
	})
})
