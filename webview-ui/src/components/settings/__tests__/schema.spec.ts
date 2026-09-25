import { SETTINGS_DEFAULTS } from "@roo-code/types"

import {
	IMMEDIATE_ONLY_SETTINGS,
	SAVED_SETTINGS_KEYS,
	SETTINGS_SCHEMA,
	buildUpdatedSettings,
	isSettingChange,
	pickCachedSettings,
} from "../schema"

describe("settings schema (WEB-3)", () => {
	it("takes every static fallback from the host default table", () => {
		const drift = Object.entries(SETTINGS_SCHEMA).filter(
			([key, row]) =>
				"default" in row &&
				key in SETTINGS_DEFAULTS &&
				row.default !== SETTINGS_DEFAULTS[key as keyof typeof SETTINGS_DEFAULTS],
		)

		expect(drift).toEqual([])
	})

	it("never saves a setting whose control writes the live state at once", () => {
		for (const key of IMMEDIATE_ONLY_SETTINGS) {
			expect(SAVED_SETTINGS_KEYS).not.toContain(key)
		}
	})

	it("builds a payload with exactly the saved keys", () => {
		expect(Object.keys(buildUpdatedSettings({} as never))).toEqual([...SAVED_SETTINGS_KEYS])
	})

	it("gives every call its own empty command list", () => {
		const first = buildUpdatedSettings({} as never)
		const second = buildUpdatedSettings({} as never)

		expect(first.allowedCommands).toEqual([])
		expect(first.allowedCommands).not.toBe(second.allowedCommands)
	})

	it("keeps chat messages, task history and setters out of the Save buffer", () => {
		const picked = pickCachedSettings({
			soundEnabled: true,
			telemetrySetting: "enabled",
			debug: false,
			apiConfiguration: { apiProvider: "anthropic" },
			clineMessages: [{ ts: 1, type: "say", say: "text" }],
			taskHistory: [],
			setSoundEnabled: () => {},
		} as never)

		expect(picked).toEqual({
			soundEnabled: true,
			telemetrySetting: "enabled",
			debug: false,
			apiConfiguration: { apiProvider: "anthropic" },
		})
	})

	it("leaves a key absent from the state absent, so a merge keeps the buffered value", () => {
		const picked = pickCachedSettings({ soundVolume: 0.3 } as never)

		expect(Object.keys(picked)).toEqual(["soundVolume"])
		expect({ ...{ soundEnabled: true }, ...picked }).toEqual({ soundEnabled: true, soundVolume: 0.3 })
	})

	it("compares support prompts by content and everything else by identity", () => {
		expect(isSettingChange("customSupportPrompts", { ENHANCE: "a" }, { ENHANCE: "a" })).toBe(false)
		expect(isSettingChange("customSupportPrompts", { ENHANCE: "a" }, { ENHANCE: "b" })).toBe(true)
		expect(isSettingChange("allowedCommands", ["ls"], ["ls"])).toBe(true)
		expect(isSettingChange("soundVolume", 0.5, 0.5)).toBe(false)
	})
})
