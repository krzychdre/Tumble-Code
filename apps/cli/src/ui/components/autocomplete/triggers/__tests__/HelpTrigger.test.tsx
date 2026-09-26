import { render } from "ink-testing-library"
import type { Key } from "ink"

import { isGlobalInputSequence } from "@/lib/utils/input.js"

import { createHelpTrigger, type HelpShortcutResult } from "../HelpTrigger.js"

function createKey(overrides: Partial<Key> = {}): Key {
	return {
		upArrow: false,
		downArrow: false,
		leftArrow: false,
		rightArrow: false,
		pageDown: false,
		pageUp: false,
		home: false,
		end: false,
		return: false,
		escape: false,
		ctrl: false,
		shift: false,
		tab: false,
		backspace: false,
		delete: false,
		meta: false,
		super: false,
		hyper: false,
		capsLock: false,
		numLock: false,
		...overrides,
	}
}

describe("HelpTrigger", () => {
	describe("createHelpTrigger", () => {
		it("should detect ? trigger at line start", () => {
			const trigger = createHelpTrigger()

			const result = trigger.detectTrigger("?")
			expect(result).toEqual({ query: "", triggerIndex: 0 })
		})

		it("should detect ? trigger with query", () => {
			const trigger = createHelpTrigger()

			const result = trigger.detectTrigger("?slash")
			expect(result).toEqual({ query: "slash", triggerIndex: 0 })
		})

		it("should detect ? trigger after whitespace", () => {
			const trigger = createHelpTrigger()

			const result = trigger.detectTrigger("  ?")
			expect(result).toEqual({ query: "", triggerIndex: 2 })
		})

		it("should not detect ? in middle of text", () => {
			const trigger = createHelpTrigger()

			// The trigger position is "line-start", so it should only match at start
			const result = trigger.detectTrigger("some text ?")
			expect(result).toBeNull()
		})

		it("should not detect ? followed by space", () => {
			const trigger = createHelpTrigger()

			const result = trigger.detectTrigger("? ")
			expect(result).toBeNull()
		})

		it("should return all shortcuts when query is empty", () => {
			const trigger = createHelpTrigger()

			const results = trigger.search("") as HelpShortcutResult[]
			expect(results.length).toBe(12)
			expect(results.map((r) => r.shortcut)).toContain("/")
			expect(results.map((r) => r.shortcut)).toContain("@")
			expect(results.map((r) => r.shortcut)).toContain("!")
			expect(results.map((r) => r.shortcut)).toContain("#")
			expect(results.map((r) => r.shortcut)).toContain("tab")
			expect(results.map((r) => r.shortcut)).toContain("shift + tab")
			expect(results.map((r) => r.shortcut)).toContain("alt + ⏎")
			expect(results.map((r) => r.shortcut)).toContain("↑ / ↓")
			expect(results.map((r) => r.shortcut)).toContain("ctrl + t")
			expect(results.map((r) => r.shortcut)).toContain("ctrl + o")
			expect(results.map((r) => r.shortcut)).toContain("esc")
			expect(results.map((r) => r.shortcut)).toContain("ctrl + c")
		})

		it("should not advertise bindings that no longer exist", () => {
			const trigger = createHelpTrigger()

			const results = trigger.search("") as HelpShortcutResult[]
			const shortcuts = results.map((r) => r.shortcut)
			const descriptions = results.map((r) => r.description)

			// Ctrl+M is byte 0x0d in a terminal, i.e. Enter: it can never cycle modes.
			expect(shortcuts).not.toContain("ctrl + m")
			// The scroll/input focus toggle went away with the ScrollArea component.
			expect(descriptions.join(" ")).not.toContain("focus")
		})

		it("should advertise Shift+Tab with the sequence the app really listens for", () => {
			const trigger = createHelpTrigger()

			const modeEntry = (trigger.search("") as HelpShortcutResult[]).find((r) => r.key === "mode")
			expect(modeEntry?.shortcut).toBe("shift + tab")
			expect(modeEntry?.description).toBe("to cycle modes")

			// The label above is only honest while the global registry matches the
			// event ink produces for Shift+Tab (ESC [ Z -> tab + shift, empty input).
			expect(isGlobalInputSequence("", createKey({ tab: true, shift: true }))?.id).toBe("cycle-mode")
		})

		it("should include ctrl+o shortcut for the verbose transcript", () => {
			const trigger = createHelpTrigger()

			const results = trigger.search("expand") as HelpShortcutResult[]
			expect(results.length).toBe(1)
			expect(results[0]?.key).toBe("verbose")
			expect(results[0]?.shortcut).toBe("ctrl + o")
			expect(results[0]?.description).toContain("thinking")
		})

		it("should clear input for the verbose action shortcut", () => {
			const trigger = createHelpTrigger()

			const verboseItem: HelpShortcutResult = {
				key: "verbose",
				shortcut: "ctrl + o",
				description: "to expand tool output and thinking",
			}
			expect(trigger.getReplacementText(verboseItem, "?expand", 0)).toBe("")
		})

		it("should include ctrl+t shortcut for TODO list", () => {
			const trigger = createHelpTrigger()

			const results = trigger.search("todo") as HelpShortcutResult[]
			expect(results.length).toBe(1)
			expect(results[0]?.shortcut).toBe("ctrl + t")
			expect(results[0]?.description).toContain("TODO")
		})

		it("should clear input for todos action shortcut", () => {
			const trigger = createHelpTrigger()

			const todosItem: HelpShortcutResult = {
				key: "todos",
				shortcut: "ctrl + t",
				description: "to view TODO list",
			}
			const replacement = trigger.getReplacementText(todosItem, "?todo", 0)
			expect(replacement).toBe("")
		})

		it("should filter shortcuts by shortcut character", () => {
			const trigger = createHelpTrigger()

			// "↑ / ↓" also contains a slash, so the command trigger is first, not alone
			const results = trigger.search("/") as HelpShortcutResult[]
			expect(results[0]?.key).toBe("slash")
			expect(results[0]?.shortcut).toBe("/")
		})

		it("should filter shortcuts by description", () => {
			const trigger = createHelpTrigger()

			const results = trigger.search("file") as HelpShortcutResult[]
			expect(results.length).toBe(1)
			expect(results[0]?.shortcut).toBe("@")
			expect(results[0]?.description).toContain("file")
		})

		it("should filter case-insensitively", () => {
			const trigger = createHelpTrigger()

			const results = trigger.search("QUIT") as HelpShortcutResult[]
			expect(results.length).toBe(1)
			expect(results[0]?.shortcut).toBe("ctrl + c")
		})

		it("should return empty array for non-matching query", () => {
			const trigger = createHelpTrigger()

			const results = trigger.search("xyz") as HelpShortcutResult[]
			expect(results.length).toBe(0)
		})

		it("should generate replacement text for trigger shortcuts", () => {
			const trigger = createHelpTrigger()

			const slashItem: HelpShortcutResult = { key: "slash", shortcut: "/", description: "for commands" }
			const replacement = trigger.getReplacementText(slashItem, "?", 0)
			expect(replacement).toBe("/")
		})

		it("should clear input for action shortcuts", () => {
			const trigger = createHelpTrigger()

			const tabItem: HelpShortcutResult = {
				key: "accept",
				shortcut: "tab",
				description: "to accept the highlighted suggestion",
			}
			const replacement = trigger.getReplacementText(tabItem, "?tab", 0)
			expect(replacement).toBe("")
		})

		it("should clear input for every entry that is a key press, not a character", () => {
			const trigger = createHelpTrigger()

			const typeable = new Set(["slash", "at", "bang", "hash"])
			for (const item of trigger.search("") as HelpShortcutResult[]) {
				const replacement = trigger.getReplacementText(item, "?", 0)
				expect(replacement).toBe(typeable.has(item.key) ? item.shortcut : "")
			}
		})

		it("should render shortcut items correctly", () => {
			const trigger = createHelpTrigger()

			const item: HelpShortcutResult = { key: "slash", shortcut: "/", description: "for commands" }
			const { lastFrame } = render(trigger.renderItem(item, false) as React.ReactElement)

			const output = lastFrame()
			expect(output).toContain("/")
			expect(output).toContain("for commands")
		})

		it("should render selected items with different styling", () => {
			const trigger = createHelpTrigger()

			const item: HelpShortcutResult = { key: "slash", shortcut: "/", description: "for commands" }
			const { lastFrame: unselectedFrame } = render(trigger.renderItem(item, false) as React.ReactElement)
			const { lastFrame: selectedFrame } = render(trigger.renderItem(item, true) as React.ReactElement)

			// Both should contain the content
			expect(unselectedFrame()).toContain("/")
			expect(selectedFrame()).toContain("/")
		})

		it("should have correct trigger configuration", () => {
			const trigger = createHelpTrigger()

			expect(trigger.id).toBe("help")
			expect(trigger.triggerChar).toBe("?")
			expect(trigger.position).toBe("line-start")
			expect(trigger.emptyMessage).toBe("No matching shortcuts")
			expect(trigger.debounceMs).toBe(0)
		})

		it("should have consumeTrigger set to true", () => {
			const trigger = createHelpTrigger()

			// The ? character should be consumed (not inserted into input)
			// when the help menu is triggered
			expect(trigger.consumeTrigger).toBe(true)
		})
	})
})
