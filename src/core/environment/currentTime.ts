// The "# Current Time" section of environment_details. The model gets the local
// wall-clock time and the UTC bounds of the local day ready-made: asked to add an
// offset to a UTC stamp itself, a model takes the UTC date as "today" (e.g. counts
// a 00:30 Warsaw event as yesterday). See
// ai_plans/2026-10-05_10-18_local-timezone-presentation.md (D5).

interface WallClock {
	year: number
	month: number
	day: number
	hour: number
	minute: number
	second: number
	weekday: string
}

const pad = (n: number) => n.toString().padStart(2, "0")

function wallClock(instant: number, timeZone: string): WallClock {
	const parts = new Intl.DateTimeFormat("en-US", {
		timeZone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		weekday: "long",
		hourCycle: "h23",
	}).formatToParts(instant)
	const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? ""
	return {
		year: Number(get("year")),
		month: Number(get("month")),
		day: Number(get("day")),
		hour: Number(get("hour")),
		minute: Number(get("minute")),
		second: Number(get("second")),
		weekday: get("weekday"),
	}
}

/** Offset of `timeZone` from UTC at `instant`, in minutes (Warsaw in summer: +120). */
function offsetMinutes(instant: number, timeZone: string): number {
	const w = wallClock(instant, timeZone)
	const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second)
	return Math.round((asUtc - Math.floor(instant / 1000) * 1000) / 60_000)
}

/** The UTC instant of local midnight starting the given calendar day. */
function localMidnight(year: number, month: number, day: number, timeZone: string): number {
	const naive = Date.UTC(year, month - 1, day)
	// Two passes settle the offset when midnight sits near a DST switch.
	let instant = naive - offsetMinutes(naive, timeZone) * 60_000
	instant = naive - offsetMinutes(instant, timeZone) * 60_000
	return instant
}

function formatOffset(minutes: number): string {
	const sign = minutes >= 0 ? "+" : "-"
	const abs = Math.abs(minutes)
	return `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
}

const isoUtc = (instant: number) => new Date(instant).toISOString().replace(/\.\d{3}Z$/, "Z")

export function formatCurrentTime(
	now: Date,
	timeZone: string = Intl.DateTimeFormat().resolvedOptions().timeZone,
): string {
	const instant = now.getTime()
	const w = wallClock(instant, timeZone)
	const dayStart = localMidnight(w.year, w.month, w.day, timeZone)
	// Date.UTC rolls day + 1 over month and year ends.
	const next = new Date(Date.UTC(w.year, w.month - 1, w.day + 1))
	const dayEnd = localMidnight(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), timeZone)

	const local = `${w.year}-${pad(w.month)}-${pad(w.day)} ${pad(w.hour)}:${pad(w.minute)}:${pad(w.second)}`
	return [
		"# Current Time",
		`Local time: ${local} (${w.weekday}), time zone ${timeZone} (UTC${formatOffset(offsetMinutes(instant, timeZone))})`,
		`Same moment in UTC: ${isoUtc(instant)}`,
		`Today in local time runs from ${isoUtc(dayStart)} to ${isoUtc(dayEnd)} (UTC).`,
		`Logs and databases usually store UTC: convert before reporting, and use the local day above for "today".`,
	].join("\n")
}
