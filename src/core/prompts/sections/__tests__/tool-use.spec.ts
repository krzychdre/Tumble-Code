import { describe, it, expect } from "vitest"

import { getSharedToolUseSection } from "../tool-use"

describe("getSharedToolUseSection", () => {
	it("opens with the section banner", () => {
		const section = getSharedToolUseSection()
		expect(section.startsWith("====\n\nTOOL USE\n\nYou have access")).toBe(true)
	})

	it("keeps the provider-native tool-calling instruction", () => {
		expect(getSharedToolUseSection()).toContain("provider-native tool-calling mechanism")
	})

	// Models told to write non-ASCII as \uXXXX escaped the backslash too, so the
	// user saw "wy\u0142\u0105cznie" and files on disk got the same text.
	it("does not ask the model to escape non-ASCII characters", () => {
		const section = getSharedToolUseSection()
		expect(section).not.toContain("\\uXXXX")
		expect(section).not.toContain("printable ASCII")
	})

	// Prompt-prefix stability: the TOOL USE section renders between the stable
	// opener and the mode sections for every request, so it must itself be a
	// constant. A non-ASCII character here would add multi-byte characters to
	// the very prefix whose byte-length we keep stable.
	it("stays printable-ASCII only", () => {
		expect(getSharedToolUseSection()).toMatch(/^[\x20-\x7E\n\t]*$/)
	})
})
