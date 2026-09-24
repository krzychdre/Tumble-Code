import { sanitizeCommandList } from "../sanitizeCommandList"

describe("sanitizeCommandList", () => {
	it.each([
		{ name: "undefined", input: undefined, expected: [] },
		{ name: "null", input: null, expected: [] },
		{ name: "a string instead of an array", input: "npm test", expected: [] },
		{ name: "an object instead of an array", input: { 0: "npm test" }, expected: [] },
		{ name: "an empty array", input: [], expected: [] },
		{ name: "valid commands, order kept", input: ["npm test", "git log"], expected: ["npm test", "git log"] },
		{
			name: "non-strings, empty and blank entries are dropped",
			input: ["npm test", 42, null, undefined, "", "   ", { cmd: "x" }, "git status"],
			expected: ["npm test", "git status"],
		},
		{
			name: "surrounding whitespace is kept (only blank entries are dropped)",
			input: ["  npm test  "],
			expected: ["  npm test  "],
		},
		{ name: "duplicates are kept (merging dedupes separately)", input: ["ls", "ls"], expected: ["ls", "ls"] },
	])("$name", ({ input, expected }) => {
		expect(sanitizeCommandList(input)).toEqual(expected)
	})
})
