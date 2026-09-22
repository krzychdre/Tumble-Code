import fs from "fs/promises"
import path from "path"

import type { CliSettings } from "@/types/index.js"
import { safeWriteJson } from "@roo-code/core"

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

export type CliSettingsUpdate = Omit<Partial<CliSettings>, "provider" | "model" | "baseUrl"> & {
	provider?: CliSettings["provider"] | null
	model?: string | null
	baseUrl?: string | null
}

export async function saveSettings(settings: CliSettingsUpdate): Promise<void> {
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

	if (JSON.stringify(existing) !== JSON.stringify(merged)) {
		await safeWriteJson(settingsPath, merged, { prettyPrint: true })
	}
}

export async function resetOnboarding(): Promise<void> {
	await saveSettings({ onboardingProviderChoice: undefined })
}
