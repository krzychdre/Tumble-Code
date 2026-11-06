import { highlightFzfMatch } from "../highlight"

// The result goes into dangerouslySetInnerHTML (history TaskItem), so the task text must come back escaped.
describe("highlightFzfMatch", () => {
	it.each([
		["no match positions", [], "&lt;b&gt;a&lt;/b&gt;"],
		["a match position", [3], '&lt;b&gt;<span class="hl">a</span>&lt;/b&gt;'],
	])("escapes the text with %s", (_name, positions, expected) => {
		expect(highlightFzfMatch("<b>a</b>", positions, "hl")).toBe(expected)
	})
})
