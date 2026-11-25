// npx vitest run core/prompts/__tests__/modeDetails.spec.ts

import type { ModeConfig } from "@tumble-code/types"

vi.mock("../sections/custom-instructions", () => ({
	addCustomInstructions: vi.fn().mockResolvedValue("Combined instructions"),
}))

import { modes } from "../../../shared/modes"
import { addCustomInstructions } from "../sections/custom-instructions"
import { getAllModesWithPrompts, getFullModeDetails } from "../modeDetails"

describe("getFullModeDetails", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(addCustomInstructions).mockResolvedValue("Combined instructions")
	})

	it("returns base mode when no overrides exist", async () => {
		const result = await getFullModeDetails("debug")
		expect(result).toMatchObject({
			slug: "debug",
			name: "🪲 Debug",
			roleDefinition:
				"You are Tumble, an expert software debugger specializing in systematic problem diagnosis and resolution.",
		})
	})

	it("applies custom mode overrides", async () => {
		const customModes: ModeConfig[] = [
			{
				slug: "debug",
				name: "Custom Debug",
				roleDefinition: "Custom debug role",
				groups: ["read"],
			},
		]

		const result = await getFullModeDetails("debug", customModes)
		expect(result).toMatchObject({
			slug: "debug",
			name: "Custom Debug",
			roleDefinition: "Custom debug role",
			groups: ["read"],
		})
	})

	it("applies prompt component overrides", async () => {
		const customModePrompts = {
			debug: {
				roleDefinition: "Overridden role",
				customInstructions: "Overridden instructions",
			},
		}

		const result = await getFullModeDetails("debug", undefined, customModePrompts)
		expect(result.roleDefinition).toBe("Overridden role")
		expect(result.customInstructions).toBe("Overridden instructions")
	})

	it("combines custom instructions when cwd provided", async () => {
		const options = {
			cwd: "/test/path",
			globalCustomInstructions: "Global instructions",
			language: "en",
		}

		const result = await getFullModeDetails("debug", undefined, undefined, options)

		expect(addCustomInstructions).toHaveBeenCalledWith(
			expect.any(String),
			"Global instructions",
			"/test/path",
			"debug",
			{ language: "en" },
		)
		expect(result.customInstructions).toBe("Combined instructions")
	})

	it("does not load custom instructions without a cwd", async () => {
		await getFullModeDetails("debug")

		expect(addCustomInstructions).not.toHaveBeenCalled()
	})

	it("falls back to first mode for non-existent mode", async () => {
		const result = await getFullModeDetails("non-existent")
		expect(result).toMatchObject({
			...modes[0],
		})
	})
})

describe("getAllModesWithPrompts", () => {
	it("returns the built-in modes when there are no custom modes", () => {
		const result = getAllModesWithPrompts(undefined, undefined)

		expect(result.map((mode) => mode.slug)).toEqual(modes.map((mode) => mode.slug))
	})

	it("applies prompt overrides and appends custom modes", () => {
		const custom: ModeConfig = { slug: "reviewer-x", name: "Reviewer X", roleDefinition: "Reviews", groups: [] }
		const result = getAllModesWithPrompts([custom], {
			debug: { roleDefinition: "Stored role", whenToUse: "Stored when", description: "ignored" },
		})

		const debug = result.find((mode) => mode.slug === "debug")!
		expect(debug.roleDefinition).toBe("Stored role")
		expect(debug.whenToUse).toBe("Stored when")
		// description is not overridable through customModePrompts
		expect(debug.description).toBe(modes.find((mode) => mode.slug === "debug")!.description)
		expect(result.find((mode) => mode.slug === "reviewer-x")).toMatchObject({ roleDefinition: "Reviews" })
	})
})
