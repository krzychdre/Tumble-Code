import { formatLargeNumber, formatTimestamp, formatDateTime, formatDuration } from "../format"

// Mock i18next
vi.mock("i18next", () => ({
	default: {
		t: vi.fn((key: string, options?: any) => {
			// Mock translations for testing
			const translations: Record<string, string> = {
				"common:number_format.billion_suffix": "b",
				"common:number_format.million_suffix": "m",
				"common:number_format.thousand_suffix": "k",
				"common:time_ago.just_now": "just now",
				"common:time_ago.seconds_ago": "{{count}} seconds ago",
				"common:time_ago.minute_ago": "a minute ago",
				"common:time_ago.minutes_ago": "{{count}} minutes ago",
				"common:time_ago.hour_ago": "an hour ago",
				"common:time_ago.hours_ago": "{{count}} hours ago",
				"common:time_ago.day_ago": "a day ago",
				"common:time_ago.days_ago": "{{count}} days ago",
				"common:time_ago.week_ago": "a week ago",
				"common:time_ago.weeks_ago": "{{count}} weeks ago",
				"common:time_ago.month_ago": "a month ago",
				"common:time_ago.months_ago": "{{count}} months ago",
				"common:time_ago.year_ago": "a year ago",
				"common:time_ago.years_ago": "{{count}} years ago",
			}

			let result = translations[key] || key
			if (options?.count !== undefined) {
				result = result.replace("{{count}}", options.count.toString())
			}
			return result
		}),
		language: "en",
	},
}))

describe("formatLargeNumber", () => {
	it("should format billions", () => {
		expect(formatLargeNumber(1500000000)).toBe("1.5b")
		expect(formatLargeNumber(2000000000)).toBe("2.0b")
	})

	it("should format millions", () => {
		expect(formatLargeNumber(1500000)).toBe("1.5m")
		expect(formatLargeNumber(2000000)).toBe("2.0m")
	})

	it("should format thousands", () => {
		expect(formatLargeNumber(1500)).toBe("1.5k")
		expect(formatLargeNumber(2000)).toBe("2.0k")
	})

	it("should return string for small numbers", () => {
		expect(formatLargeNumber(999)).toBe("999")
		expect(formatLargeNumber(100)).toBe("100")
	})
})

describe("formatTimestamp", () => {
	it("should format a timestamp as 24-hour HH:MM clock time", () => {
		const timestamp = new Date("2024-01-15T14:30:00").getTime()
		// 24-hour format: 14:30, never "02:30 PM".
		expect(formatTimestamp(timestamp)).toBe("14:30")
	})

	it("should pad the hour and minute components to two digits", () => {
		const timestamp = new Date("2024-01-15T09:05:00").getTime()
		expect(formatTimestamp(timestamp)).toBe("09:05")
	})
})

describe("formatDateTime", () => {
	it("should format a timestamp as yyyy-mm-dd hh:mm:ss in 24-hour time", () => {
		const timestamp = new Date("2024-01-15T14:30:05").getTime()
		expect(formatDateTime(timestamp)).toBe("2024-01-15 14:30:05")
	})

	it("should zero-pad every date and time component", () => {
		const timestamp = new Date("2024-03-07T09:05:08").getTime()
		expect(formatDateTime(timestamp)).toBe("2024-03-07 09:05:08")
	})
})

describe("formatDuration", () => {
	it("should format sub-minute durations in seconds with one decimal", () => {
		expect(formatDuration(1200)).toBe("1.2s")
		expect(formatDuration(800)).toBe("0.8s")
	})

	it("should format durations of a minute or more as minutes and seconds", () => {
		expect(formatDuration(65000)).toBe("1m 05s")
		expect(formatDuration(184000)).toBe("3m 04s")
	})

	it("should format whole seconds without a trailing decimal artifact", () => {
		expect(formatDuration(2000)).toBe("2.0s")
	})

	it("should clamp negative durations to zero", () => {
		expect(formatDuration(-500)).toBe("0.0s")
	})
})
