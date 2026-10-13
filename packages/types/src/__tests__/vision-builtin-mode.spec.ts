// npx vitest run src/__tests__/vision-builtin-mode.spec.ts
//
// Vision is a built-in mode, so the VS Code extension and the CLI always have
// it (as a user custom mode it was lost from the settings once, and the CLI
// keeps its own settings without custom modes). It reads images and runs
// commands (to download images by URL) and never edits files.

import { DEFAULT_MODES, modeConfigSchema } from "../mode.js"

describe("built-in vision mode", () => {
	const vision = DEFAULT_MODES.find((mode) => mode.slug === "vision")

	it("exists with the read and command groups only", () => {
		expect(vision).toBeDefined()
		expect(vision?.groups).toEqual(["read", "command"])
	})

	it("comes after the older built-in modes, so their cycle order is unchanged", () => {
		expect(DEFAULT_MODES.map((mode) => mode.slug)).toEqual([
			"architect",
			"code",
			"ask",
			"debug",
			"orchestrator",
			"vision",
		])
	})

	it("is a valid mode with a role, a use case and instructions", () => {
		expect(modeConfigSchema.safeParse(vision).success).toBe(true)
		expect(vision?.roleDefinition).toMatch(/^You are Tumble, a visual analysis specialist/)
		expect(vision?.whenToUse).toContain("Delegate with new_task")
		expect(vision?.customInstructions).toContain("PHASE 3 - REPORT with a single attempt_completion")
	})

	it("does not call itself a custom mode", () => {
		const text = [vision?.roleDefinition, vision?.whenToUse, vision?.description, vision?.customInstructions]
		expect(text.join("\n")).not.toMatch(/custom mode/i)
	})
})
