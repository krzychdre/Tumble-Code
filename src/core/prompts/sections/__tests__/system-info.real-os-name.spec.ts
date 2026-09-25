// Runs the real `os-name` package (the other prompt specs mock it) to pin the
// "Operating System:" line of the system prompt. Explicit platform and release
// arguments are pure lookups, so they are checked on every CI host. The Linux
// host case reads /etc/os-release (since os-name 7) and only runs where that
// file names the distribution.
import fs from "fs"
import osName from "os-name"

import { getSystemInfoSection, resetOsInfoCacheForTests } from "../system-info"

function linuxPrettyName(): string | undefined {
	if (process.platform !== "linux") {
		return undefined
	}
	try {
		const text = fs.readFileSync("/etc/os-release", "utf8")
		const match = text.match(/^PRETTY_NAME=(?:"(.+?)"|'(.+?)'|(.+))$/m)
		return match?.[1] ?? match?.[2] ?? match?.[3]
	} catch {
		return undefined
	}
}

describe("os-name as used by the system prompt", () => {
	afterEach(() => {
		resetOsInfoCacheForTests()
	})

	it("names explicit platforms and releases the same way", () => {
		expect(osName("linux", "5.15.0-105-generic")).toBe("Linux 5.15")
		expect(osName("darwin", "24.0.0")).toBe("macOS Sequoia")
		expect(osName("win32", "6.1.7601")).toBe("Windows 7")
		expect(osName("freebsd", "14.0")).toBe("freebsd")
	})

	// On Windows the real lookup shells out to wmic or PowerShell (seconds), which
	// system-info.ts memoizes; that path is not worth a slow CI step.
	it.skipIf(process.platform === "win32")("puts a non-empty OS name into the system prompt on this host", () => {
		resetOsInfoCacheForTests()
		const section = getSystemInfoSection(process.cwd())
		const line = section.split("\n").find((l) => l.startsWith("Operating System: "))
		expect(line).toBeDefined()
		expect(line!.length).toBeGreaterThan("Operating System: ".length)
	})

	const prettyName = linuxPrettyName()
	it.runIf(prettyName !== undefined)("names the Linux distribution from /etc/os-release", () => {
		resetOsInfoCacheForTests()
		expect(getSystemInfoSection(process.cwd())).toContain(`Operating System: ${prettyName}`)
	})
})
