import i18next from "i18next"

export function formatLargeNumber(num: number): string {
	if (num >= 1e9) {
		return (num / 1e9).toFixed(1) + i18next.t("common:number_format.billion_suffix")
	}
	if (num >= 1e6) {
		return (num / 1e6).toFixed(1) + i18next.t("common:number_format.million_suffix")
	}
	if (num >= 1e3) {
		return (num / 1e3).toFixed(1) + i18next.t("common:number_format.thousand_suffix")
	}
	return num.toString()
}

/**
 * Formats an epoch-ms timestamp as a short 24-hour clock time (HH:MM).
 * Used for the non-intrusive start time shown beside status block headers.
 */
export const formatTimestamp = (timestamp: number) => {
	const date = new Date(timestamp)
	const locale = i18next.language || "en"

	return date.toLocaleTimeString(locale, {
		hour: "2-digit",
		minute: "2-digit",
		hourCycle: "h23",
	})
}

/**
 * Formats an epoch-ms timestamp as a full local date-time string in
 * `yyyy-mm-dd hh:mm:ss` (24-hour) form, e.g. `2026-05-22 17:50:33`.
 */
export const formatDateTime = (timestamp: number) => {
	const date = new Date(timestamp)
	const pad = (n: number) => String(n).padStart(2, "0")

	const datePart = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
	const timePart = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`

	return `${datePart} ${timePart}`
}

/**
 * Formats a duration in milliseconds into a compact, human-readable string.
 * Sub-minute durations render as seconds with one decimal (e.g. "1.2s");
 * longer durations render as minutes and zero-padded seconds (e.g. "3m 04s").
 */
export const formatDuration = (durationMs: number) => {
	const safeMs = Math.max(0, durationMs)
	const totalSeconds = safeMs / 1000

	if (totalSeconds < 60) {
		return `${totalSeconds.toFixed(1)}s`
	}

	const minutes = Math.floor(totalSeconds / 60)
	const seconds = Math.floor(totalSeconds % 60)
	return `${minutes}m ${seconds.toString().padStart(2, "0")}s`
}
