import { applyTimeZoneSetting, formatLocalIso, isValidTimeZone } from "../time-zone.js"

function withTz(name: string) {
	const saved = process.env.TZ
	process.env.TZ = name
	onTestFinished(() => {
		if (saved === undefined) delete process.env.TZ
		else process.env.TZ = saved
	})
}

describe("isValidTimeZone", () => {
	it("accepts IANA names and rejects anything else", () => {
		expect(isValidTimeZone("Europe/Warsaw")).toBe(true)
		expect(isValidTimeZone("UTC")).toBe(true)
		expect(isValidTimeZone("Mars/Olympus")).toBe(false)
		expect(isValidTimeZone("")).toBe(false)
	})
})

describe("applyTimeZoneSetting", () => {
	it("writes a valid zone to TZ, trimmed", () => {
		const env: NodeJS.ProcessEnv = { TZ: "UTC" }
		const warn = vi.fn()
		applyTimeZoneSetting({ timeZone: " Europe/Warsaw " }, warn, env)
		expect(env.TZ).toBe("Europe/Warsaw")
		expect(warn).not.toHaveBeenCalled()
	})

	it("warns about an invalid zone and leaves TZ alone", () => {
		const env: NodeJS.ProcessEnv = { TZ: "UTC" }
		const warn = vi.fn()
		applyTimeZoneSetting({ timeZone: "Warsaw" }, warn, env)
		expect(env.TZ).toBe("UTC")
		expect(warn).toHaveBeenCalledWith(expect.stringContaining('"Warsaw"'))
	})

	it("does nothing without the setting", () => {
		const env: NodeJS.ProcessEnv = {}
		applyTimeZoneSetting({}, vi.fn(), env)
		expect(env.TZ).toBeUndefined()
	})

	it("changes the zone Date and Intl use at once", () => {
		withTz("UTC")
		applyTimeZoneSetting({ timeZone: "Europe/Warsaw" }, vi.fn())
		expect(new Date("2026-10-04T22:30:00Z").getHours()).toBe(0)
		expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe("Europe/Warsaw")
	})
})

describe("formatLocalIso", () => {
	it("prints local time with the offset", () => {
		withTz("Europe/Warsaw")
		expect(formatLocalIso(new Date("2026-10-04T22:30:05Z"))).toBe("2026-10-05T00:30:05+02:00")
		expect(formatLocalIso(new Date("2026-01-15T12:00:00Z"))).toBe("2026-01-15T13:00:00+01:00")
	})

	it("handles negative and half-hour offsets", () => {
		withTz("America/Los_Angeles")
		expect(formatLocalIso(new Date("2026-10-05T03:00:00Z"))).toBe("2026-10-04T20:00:00-07:00")
		process.env.TZ = "Asia/Kolkata"
		expect(formatLocalIso(new Date("2026-10-05T20:00:00Z"))).toBe("2026-10-06T01:30:00+05:30")
	})
})
