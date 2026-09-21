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

	it("instructs the model to escape non-ASCII characters as \\uXXXX in JSON arguments", () => {
		const section = getSharedToolUseSection()
		expect(section).toContain("character outside the printable ASCII range")
		expect(section).toContain("\\uXXXX")
		// The mitigation is an escape, not a strip: the user must still see real characters.
		expect(section).toContain("decodes escapes")
	})

	// Prompt-prefix stability: the TOOL USE section renders between the stable
	// opener and the mode sections for every request, so it must itself be a
	// constant. A non-ASCII character here would defeat the mitigation it
	// describes (this section is part of the KV-cache prefix) and would add
	// multi-byte characters to the very prefix whose byte-length we keep stable.
	it("stays printable-ASCII only", () => {
		expect(getSharedToolUseSection()).toMatch(/^[\x20-\x7E\n\t]*$/)
	})
})
