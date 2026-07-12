import { memoryAgeDays, memoryAge, memoryFreshnessText, memoryFreshnessNote } from "../memoryAge"

describe("memoryAge", () => {
	const NOW = 1_700_000_000_000 // fixed epoch ms

	afterEach(() => {
		vi.useRealTimers()
	})

	it("memoryAgeDays is 0 for today, 1 for yesterday, N for N days", () => {
		vi.setSystemTime(NOW)
		expect(memoryAgeDays(NOW)).toBe(0)
		expect(memoryAgeDays(NOW - 86_400_000)).toBe(1)
		expect(memoryAgeDays(NOW - 5 * 86_400_000)).toBe(5)
	})

	it("memoryAgeDays is clamped at 0 (future mtime)", () => {
		vi.setSystemTime(NOW)
		expect(memoryAgeDays(NOW + 86_400_000)).toBe(0)
	})

	it("memoryAge returns today/yesterday/N days ago", () => {
		vi.setSystemTime(NOW)
		expect(memoryAge(NOW)).toBe("today")
		expect(memoryAge(NOW - 86_400_000)).toBe("yesterday")
		expect(memoryAge(NOW - 3 * 86_400_000)).toBe("3 days ago")
	})

	it("memoryFreshnessText is empty for memories ≤1 day old", () => {
		vi.setSystemTime(NOW)
		expect(memoryFreshnessText(NOW)).toBe("")
		expect(memoryFreshnessText(NOW - 86_400_000)).toBe("")
	})

	it("memoryFreshnessText is populated for memories >1 day old", () => {
		vi.setSystemTime(NOW)
		const text = memoryFreshnessText(NOW - 7 * 86_400_000)
		expect(text).toContain("7 days old")
		expect(text).toContain("point-in-time observations")
	})

	it("memoryFreshnessNote wraps the caveat in <system-reminder> (or empty)", () => {
		vi.setSystemTime(NOW)
		expect(memoryFreshnessNote(NOW)).toBe("")
		const note = memoryFreshnessNote(NOW - 2 * 86_400_000)
		expect(note.startsWith("<system-reminder>")).toBe(true)
		expect(note.endsWith("</system-reminder>\n")).toBe(true)
	})
})
