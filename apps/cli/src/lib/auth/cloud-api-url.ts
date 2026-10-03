/**
 * Which Tumble Code Cloud the CLI signs in to and sends telemetry to.
 *
 * `cloudApiUrl` in ~/.roo/cli-settings.json is handed to the extension as the
 * `tumble-code.cloudApiUrl` setting before it activates (the extension reads it
 * once, early in `activate()`). Without it the extension falls back to the
 * `TUMBLE_CODE_API_URL` (or older `ROO_CODE_API_URL`) environment variable.
 * Every path normalizes the setting the same way, because the extension keys
 * the stored credentials by this URL: a sign-in under one spelling would not be
 * found under another.
 */

import type { CliSettings } from "@/types/index.js"

import { getSettingsPath } from "@/lib/storage/settings.js"

/** Trims and drops trailing slashes; `undefined` for an empty or non-http(s) value. */
export function normalizeCloudApiUrl(value: string | undefined): string | undefined {
	const trimmed = value?.trim()

	if (!trimmed) {
		return undefined
	}

	try {
		const { protocol } = new URL(trimmed)

		if (protocol !== "http:" && protocol !== "https:") {
			return undefined
		}
	} catch {
		return undefined
	}

	return trimmed.replace(/\/+$/, "")
}

export type CloudApiUrlResolution =
	| { ok: true; url: string; source: "settings" | "environment" }
	| { ok: false; message: string }

/** The cloud the extension will use, or why there is none. */
export function resolveCloudApiUrl(
	settings: Pick<CliSettings, "cloudApiUrl">,
	env: NodeJS.ProcessEnv = process.env,
): CloudApiUrlResolution {
	if (settings.cloudApiUrl !== undefined && settings.cloudApiUrl.trim() !== "") {
		const url = normalizeCloudApiUrl(settings.cloudApiUrl)

		return url
			? { ok: true, url, source: "settings" }
			: {
					ok: false,
					message: `"cloudApiUrl" in ${getSettingsPath()} is not an http(s) URL: ${JSON.stringify(settings.cloudApiUrl)}`,
				}
	}

	const fromEnv = env.TUMBLE_CODE_API_URL?.trim() || env.ROO_CODE_API_URL?.trim()

	if (fromEnv) {
		return { ok: true, url: fromEnv, source: "environment" }
	}

	return {
		ok: false,
		message: [
			"No Tumble Code Cloud is configured.",
			`Add "cloudApiUrl" to ${getSettingsPath()}, for example:`,
			'  { "cloudApiUrl": "https://cloud.example.com" }',
			"or set TUMBLE_CODE_API_URL in the environment.",
		].join("\n"),
	}
}

/**
 * The `cloudApiUrl` setting to hand the extension, normalized; `undefined` when
 * it is unset or invalid (an invalid value is reported through `warn`, and the
 * environment variable then applies).
 */
export function cloudApiUrlSetting(
	settings: Pick<CliSettings, "cloudApiUrl">,
	warn: (message: string) => void,
): string | undefined {
	if (settings.cloudApiUrl === undefined || settings.cloudApiUrl.trim() === "") {
		return undefined
	}

	const resolution = resolveCloudApiUrl(settings, {})

	if (resolution.ok) {
		return resolution.url
	}

	warn(resolution.message)
	return undefined
}

/**
 * Puts the cloud's port back on a URL the extension opened on it. The shim's
 * `Uri.parse` keeps only the hostname (packages/vscode-shim
 * src/classes/Uri.ts), so `vscode.env.openExternal` hands the CLI
 * `http://127.0.0.1/extension/sign-in?...` for a cloud on
 * `http://127.0.0.1:8000`. A URL on another host, or one that kept its port,
 * comes back unchanged.
 */
export function restoreCloudPort(url: string, cloudApiUrl: string): string {
	try {
		const opened = new URL(url)
		const cloud = new URL(cloudApiUrl)

		if (opened.port !== "" || opened.protocol !== cloud.protocol || opened.hostname !== cloud.hostname) {
			return url
		}

		opened.port = cloud.port
		return opened.toString()
	} catch {
		return url
	}
}
