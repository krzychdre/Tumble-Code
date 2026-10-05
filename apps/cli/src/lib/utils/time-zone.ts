/**
 * Local time in the CLI.
 *
 * Node takes its zone from TZ, else /etc/localtime. A container or sandbox
 * without either silently runs in UTC, and the extension core (which runs in
 * this process) then tells the model the user is in UTC. `timeZone` in
 * ~/.roo/cli-settings.json fixes that: it is written to process.env.TZ, which
 * Node applies at once to Date and Intl, and child processes inherit it. Like
 * `cloudApiUrl`, the settings file wins over the environment.
 */

import type { CliSettings } from "@/types/index.js"

export function isValidTimeZone(name: string): boolean {
	try {
		new Intl.DateTimeFormat("en-US", { timeZone: name })
		return true
	} catch {
		return false
	}
}

export function applyTimeZoneSetting(
	settings: Pick<CliSettings, "timeZone">,
	warn: (message: string) => void,
	env: NodeJS.ProcessEnv = process.env,
): void {
	const name = settings.timeZone?.trim()

	if (!name) {
		return
	}

	if (!isValidTimeZone(name)) {
		warn(`"timeZone" ${JSON.stringify(settings.timeZone)}: not an IANA time zone such as "Europe/Warsaw"`)
		return
	}

	env.TZ = name
}

/** ISO 8601 in local time with the offset, e.g. 2026-10-05T10:18:07+02:00. */
export function formatLocalIso(date: Date): string {
	const pad = (value: number) => String(value).padStart(2, "0")
	const offset = -date.getTimezoneOffset()
	const abs = Math.abs(offset)
	const zone = `${offset >= 0 ? "+" : "-"}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
	return (
		`${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
		`T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${zone}`
	)
}
