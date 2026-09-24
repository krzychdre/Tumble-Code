import { DEFAULT_MODES } from "../mode.js"

/**
 * The architect mode tells the model where to save plan files. Written as "the /plans
 * directory", models (weak ones especially) take it as an absolute filesystem path and
 * fail with "EROFS: read-only file system, mkdir '/plans'". The directory must be
 * named as a path relative to the workspace root.
 */
describe("architect plans directory", () => {
	const architect = DEFAULT_MODES.find((mode) => mode.slug === "architect")
	const customInstructions = architect?.customInstructions ?? ""

	it("should name the plans directory relative to the workspace root", () => {
		expect(customInstructions).toContain("the ./plans directory, relative to the workspace root")
	})

	it("should never present /plans as the place to save a plan", () => {
		expect(customInstructions).not.toContain("the /plans directory")
	})
})
