// npx vitest run core/tools/helpers/__tests__/imageHelpers.spec.ts

import { describe, it, expect } from "vitest"

import { validateImageForProcessing } from "../imageHelpers"

describe("validateImageForProcessing", () => {
	describe("when the model does not support images", () => {
		// A nonexistent path proves the unsupported-model check runs before any
		// filesystem access: fs.stat would reject if it were reached.
		const NONEXISTENT_PATH = "/nonexistent/screenshot.png"

		it("rejects the image without touching the filesystem", async () => {
			const result = await validateImageForProcessing(NONEXISTENT_PATH, false, 5, 20, 0)

			expect(result.isValid).toBe(false)
			expect(result.reason).toBe("unsupported_model")
		})

		it("names the image-capable mode and its model, so the model need not guess", async () => {
			const result = await validateImageForProcessing(NONEXISTENT_PATH, false, 5, 20, 0, [
				{ slug: "vision", modelId: "qwen3.6-35b" },
			])

			expect(result.notice).toContain("Delegate it with the new_task tool to mode `vision` (runs on qwen3.6-35b)")
			expect(result.notice).toContain("Include the image path and your question")
			expect(result.notice).toContain("Do not delegate the image to any other mode")
			expect(result.notice).not.toContain("Do NOT delegate")
		})

		it("lists every image-capable mode when there are several", async () => {
			const result = await validateImageForProcessing(NONEXISTENT_PATH, false, 5, 20, 0, [
				{ slug: "vision", modelId: "qwen3.6-35b" },
				{ slug: "designer", modelId: "" },
			])

			expect(result.notice).toContain(
				"to one of these modes: `vision` (runs on qwen3.6-35b), `designer`. Include the image path",
			)
		})

		it.each([
			["no list is passed", undefined],
			["the list is empty", []],
		])("forbids delegation when no other mode can see images (%s)", async (_label, modes) => {
			const result = await validateImageForProcessing(NONEXISTENT_PATH, false, 5, 20, 0, modes)

			// The incident: "If a vision-capable mode is available, delegate" made a
			// text-only model delegate to Ask, which delegated again, ~90 times.
			expect(result.notice).toContain("No other mode in this setup runs on a model that can see images")
			expect(result.notice).toContain("Do NOT delegate this image with the new_task tool")
			expect(result.notice).toContain('do not ask anyone to "use vision capabilities"')
			expect(result.notice).toContain("tell the user that the image could not be viewed")
			expect(result.notice).toContain("pinning a vision-capable API profile to a mode")
			expect(result.notice).not.toContain("Delegate it with")
		})
	})
})
