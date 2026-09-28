import { describe, expect, it } from "vitest"

import { getCurrentProfileId } from "../currentProfileId"

describe("getCurrentProfileId", () => {
	it("returns the id of the profile matching currentApiConfigName", () => {
		const state = {
			currentApiConfigName: "work",
			listApiConfigMeta: [
				{ id: "profile-1", name: "default" },
				{ id: "profile-2", name: "work" },
			],
		}
		expect(getCurrentProfileId(state)).toBe("profile-2")
	})

	it('falls back to "default" when no profile matches', () => {
		const state = {
			currentApiConfigName: "missing",
			listApiConfigMeta: [{ id: "profile-1", name: "default" }],
		}
		expect(getCurrentProfileId(state)).toBe("default")
	})

	it('falls back to "default" for undefined state', () => {
		expect(getCurrentProfileId(undefined)).toBe("default")
	})

	it('falls back to "default" when listApiConfigMeta is missing', () => {
		expect(getCurrentProfileId({ currentApiConfigName: "work" })).toBe("default")
	})
})
