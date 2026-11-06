import { stripTerminalControls } from "../terminal-text.js"

describe("stripTerminalControls", () => {
	it.each([
		["OSC 52 clipboard write (BEL)", "a\x1b]52;c;cm0gLXJmIH4=\x07b"],
		["OSC 52 clipboard write (ST)", "a\x1b]52;c;cm0gLXJmIH4=\x1b\\b"],
		["OSC 0 window title", "a\x1b]0;pwned\x07b"],
		["OSC string still waiting for its terminator", "ab\x1b]52;c;cm0g"],
		["C1 OSC", "a\x9d52;c;cm0g\x9cb"],
		["CSI erase screen", "a\x1b[2J\x1b[3Jb"],
		["CSI cursor position", "a\x1b[1;1Hb"],
		["C1 CSI", "a\x9b2Jb"],
		["DCS", "a\x1bPq#0;2;0;0;0\x1b\\b"],
		["APC (kitty graphics)", "a\x1b_Ga=d\x1b\\b"],
		["ESC c terminal reset", "a\x1bcb"],
		["ESC 7 save cursor", "a\x1b7b"],
		["BEL, backspace, vertical tab, form feed, carriage return, DEL", "a\x07\x08\x0b\x0c\r\x7fb"],
	])("drops %s", (_name, text) => {
		expect(stripTerminalControls(text)).toBe("ab")
	})

	it("drops the OSC 8 wrapper around a link and keeps its visible text", () => {
		expect(stripTerminalControls("\x1b]8;;https://evil.example\x1b\\docs\x1b]8;;\x1b\\")).toBe("docs")
	})

	it("keeps SGR colours, tabs, line feeds and non-ASCII text", () => {
		const text = "\x1b[1;31mbłąd\x1b[0m\tok\n\x1b[38;2;255;0;0mred\x1b[39m 日本"

		expect(stripTerminalControls(text)).toBe(text)
	})
})
