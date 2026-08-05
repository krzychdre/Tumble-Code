import fs from "fs/promises"
import path from "path"

import type { CliSettings } from "@/types/index.js"

import { getConfigDir } from "./index.js"

export function getSettingsPath(): string {
	return path.join(getConfigDir(), "cli-settings.json")
}

export async function loadSettings(): Promise<CliSettings> {
	try {
		const settingsPath = getSettingsPath()
		const data = await fs.readFile(settingsPath, "utf-8")
		return JSON.parse(data) as CliSettings
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return {}
		}

		throw error
	}
}

export async function saveSettings(settings: Partial<CliSettings>): Promise<void> {
	const configDir = getConfigDir()
	await fs.mkdir(configDir, { recursive: true })

	const settingsPath = getSettingsPath()
	const existing = await loadSettings()
	const merged = { ...existing, ...settings }

	// An explicit `null` clears the persisted value; `undefined` (or absent)
	// keeps the existing value so a partial save merges instead of wiping.
	for (const key of ["provider", "model", "baseUrl"] as const) {
		if (merged[key] === null) {
			delete merged[key]
		}
	}

	const content = JSON.stringify(merged, null, 2)

	// Skip the write when nothing actually changed (e.g. a run that reused the
	// already-persisted provider/model/baseUrl) so the file/mtime stay untouched.
	let current: string | undefined
	try {
		current = await fs.readFile(settingsPath, "utf-8")
	} catch {
		current = undefined
	}
	if (current === content) {
		return
	}

	await fs.writeFile(settingsPath, content, {
		mode: 0o600,
	})
}

export async function resetOnboarding(): Promise<void> {
	await saveSettings({ onboardingProviderChoice: undefined })
}
