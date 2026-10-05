import { formatCurrentTime } from "../currentTime"

const at = (iso: string, timeZone: string) => formatCurrentTime(new Date(iso), timeZone)

describe("formatCurrentTime", () => {
	it("gives the local day, not the UTC one, just after local midnight", () => {
		// 00:30 in Warsaw is still 4 October in UTC: the case a model got wrong.
		expect(at("2026-10-04T22:30:00.000Z", "Europe/Warsaw")).toBe(
			[
				"# Current Time",
				"Local time: 2026-10-05 00:30:00 (Monday), time zone Europe/Warsaw (UTC+02:00)",
				"Same moment in UTC: 2026-10-04T22:30:00Z",
				"Today in local time runs from 2026-10-04T22:00:00Z to 2026-10-05T22:00:00Z (UTC).",
				'Logs and databases usually store UTC: convert before reporting, and use the local day above for "today".',
			].join("\n"),
		)
	})

	it("handles a zone behind UTC", () => {
		const text = at("2026-10-05T03:00:00.000Z", "America/Los_Angeles")
		expect(text).toContain("Local time: 2026-10-04 20:00:00 (Sunday), time zone America/Los_Angeles (UTC-07:00)")
		expect(text).toContain("runs from 2026-10-04T07:00:00Z to 2026-10-05T07:00:00Z (UTC)")
	})

	it("handles a half-hour offset", () => {
		const text = at("2026-10-05T20:00:00.000Z", "Asia/Kolkata")
		expect(text).toContain("Local time: 2026-10-06 01:30:00 (Tuesday), time zone Asia/Kolkata (UTC+05:30)")
		expect(text).toContain("runs from 2026-10-05T18:30:00Z to 2026-10-06T18:30:00Z (UTC)")
	})

	it("gives a 25-hour day when summer time ends", () => {
		const text = at("2026-10-25T10:00:00.000Z", "Europe/Warsaw")
		expect(text).toContain("Local time: 2026-10-25 11:00:00 (Sunday), time zone Europe/Warsaw (UTC+01:00)")
		expect(text).toContain("runs from 2026-10-24T22:00:00Z to 2026-10-25T23:00:00Z (UTC)")
	})

	it("gives a 23-hour day when summer time starts", () => {
		expect(at("2026-03-29T12:00:00.000Z", "Europe/Warsaw")).toContain(
			"runs from 2026-03-28T23:00:00Z to 2026-03-29T22:00:00Z (UTC)",
		)
	})

	it("rolls the day end over a year boundary", () => {
		const text = at("2026-12-31T12:00:00.000Z", "UTC")
		expect(text).toContain("Local time: 2026-12-31 12:00:00 (Thursday), time zone UTC (UTC+00:00)")
		expect(text).toContain("runs from 2026-12-31T00:00:00Z to 2027-01-01T00:00:00Z (UTC)")
	})
})
