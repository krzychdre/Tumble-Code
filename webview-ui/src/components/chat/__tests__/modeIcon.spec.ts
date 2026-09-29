import { modeLabel } from "../modeIcon"

describe("modeLabel", () => {
	it.each([
		["🏗️ Architect", "Architect"],
		["💻 Code", "Code"],
		["❓ Ask", "Ask"],
		["🪲 Debug", "Debug"],
		["🪃 Orchestrator", "Orchestrator"],
		["🌐 Translate", "Translate"],
		["👩🏽‍💻 Pair", "Pair"],
		["Plain name", "Plain name"],
		["Code 💻", "Code 💻"],
		["💻", "💻"],
	])("%s -> %s", (name, expected) => {
		expect(modeLabel(name)).toBe(expected)
	})
})
