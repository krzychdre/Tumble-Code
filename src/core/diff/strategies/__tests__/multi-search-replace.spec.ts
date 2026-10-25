import { MultiSearchReplaceDiffStrategy } from "../multi-search-replace"

/** Applies `diff` and expects it to succeed with `expected` as the new content. */
async function expectApplied(
	strategy: MultiSearchReplaceDiffStrategy,
	original: string,
	diff: string,
	expected: string,
) {
	const result = await strategy.applyDiff(original, diff)
	expect(result).toMatchObject({ success: true, content: expected })
}

describe("MultiSearchReplaceDiffStrategy", () => {
	// A diff block in parts: SEARCH lines, then REPLACE lines.
	const block = (search: string, replace: string, open = "<<<<<<< SEARCH") =>
		`${open}\n${search}\n=======\n${replace}\n>>>>>>> REPLACE`
	const BAD_REPLACE_MARKER = "Line markers (:start_line: and :end_line:) are only allowed in SEARCH sections"

	describe("validateMarkerSequencing", () => {
		let strategy: MultiSearchReplaceDiffStrategy

		beforeEach(() => {
			strategy = new MultiSearchReplaceDiffStrategy()
		})

		it.each([
			["a plain block", block("some content", "new content")],
			["one stray > after SEARCH", block("some content", "new content", "<<<<<<< SEARCH>")],
			["one stray > and trailing spaces", block("some content", "new content", "<<<<<<< SEARCH>  ")],
			["blocks with and without the stray >", `${block("c1", "n1", "<<<<<<< SEARCH>")}\n\n${block("c2", "n2")}`],
			["line numbers in SEARCH", block(":start_line:10\n-------\ncontent1", "new1", "<<<<<<< SEARCH>")],
			[
				"two blocks with line numbers",
				`${block(":start_line:10\n-------\nc1", "n1")}\n\n${block(":start_line:10\n-------\nc2", "n2")}`,
			],
			[
				"both markers in SEARCH",
				block(":start_line:5\n:end_line:10\n-------\ncontent to find", "replacement content"),
			],
			[
				"escaped markers in REPLACE",
				block("content to find", "replacement\n\\:start_line:5\n\\:end_line:10\nmore"),
			],
		])("accepts %s", (_, diff) => {
			expect(strategy["validateMarkerSequencing"](diff).success).toBe(true)
		})

		it.each([
			["two > after SEARCH", block("c", "n", "<<<<<<< SEARCH>>"), []],
			["a > after spaces", block("c", "n", "<<<<<<< SEARCH  >"), []],
			[
				"a separator before SEARCH",
				"=======\ncontent\n>>>>>>> REPLACE",
				["'=======' found in your diff content", "Diff block is malformed"],
			],
			[
				"a missing separator",
				"<<<<<<< SEARCH\ncontent\n>>>>>>> REPLACE",
				["'>>>>>>> REPLACE' found in your diff content", "Diff block is malformed"],
			],
			[
				"two separators",
				"<<<<<<< SEARCH\ncontent\n=======\n=======\n>>>>>>> REPLACE",
				["more than one '=======' separator (the extra one is at line 4)"],
			],
			[
				"a bare closer (merge conflict)",
				"<<<<<<< SEARCH\ncontent\n>>>>>>>",
				["'>>>>>>>' found in your diff content", "When removing merge conflict markers"],
			],
			[
				"a missing closer",
				"<<<<<<< SEARCH\ncontent\n=======\nnew content",
				["Expected '>>>>>>> REPLACE' was not found"],
			],
			[
				":start_line: in REPLACE",
				block("content to find", ":start_line:5\nreplacement content"),
				[
					"Invalid line marker ':start_line:' found in REPLACE section",
					BAD_REPLACE_MARKER,
					"CORRECT FORMAT:",
					"INCORRECT FORMAT:",
					":start_line:5    <-- Invalid location",
				],
			],
			[
				":end_line: in the middle of REPLACE",
				block("content to find", "some\n:end_line:15\nmore"),
				["Invalid line marker ':end_line:' found in REPLACE section", BAD_REPLACE_MARKER],
			],
			[
				"a marker with spaces in REPLACE",
				block("content to find", "  :start_line:5  \nreplacement"),
				["Invalid line marker ':start_line:'"],
			],
			[
				"a marker in REPLACE of the second block",
				`${block(":start_line:1\ncontent1", "r1")}\n\n${block("content2", ":start_line:5\nr2")}`,
				["Invalid line marker ':start_line:'"],
			],
		])("rejects %s", (_, diff, messages) => {
			const result = strategy["validateMarkerSequencing"](diff)

			expect(result.success).toBe(false)
			for (const message of messages) expect(result.error).toContain(message)
		})

		it("does not give the merge conflict hint for two separators", () => {
			const diff = "<<<<<<< SEARCH\ncontent\n=======\n=======\n>>>>>>> REPLACE"
			expect(strategy["validateMarkerSequencing"](diff).error).not.toContain(
				"When removing merge conflict markers",
			)
		})

		describe("exact matching", () => {
			let strategy: MultiSearchReplaceDiffStrategy

			beforeEach(() => {
				strategy = new MultiSearchReplaceDiffStrategy(1.0, 5) // Default 1.0 threshold for exact matching, 5 line buffer for tests
			})

			it("should replace matching content", async () => {
				const originalContent = 'function hello() {\n    console.log("hello")\n}\n'
				const diffContent = `test.ts
<<<<<<< SEARCH
function hello() {
    console.log("hello")
}
=======
function hello() {
    console.log("hello world")
}
>>>>>>> REPLACE`

				await expectApplied(
					strategy,
					originalContent,
					diffContent,
					'function hello() {\n    console.log("hello world")\n}\n',
				)
			})

			it("should replace matching content in multiple blocks", async () => {
				const originalContent = 'function hello() {\n    console.log("hello")\n}\n'
				const diffContent = `test.ts
<<<<<<< SEARCH
function hello() {
=======
function helloWorld() {
>>>>>>> REPLACE
<<<<<<< SEARCH
    console.log("hello")
=======
    console.log("hello world")
>>>>>>> REPLACE`

				await expectApplied(
					strategy,
					originalContent,
					diffContent,
					'function helloWorld() {\n    console.log("hello world")\n}\n',
				)
			})

			it("should replace matching content in multiple blocks with line numbers", async () => {
				const originalContent = 'function hello() {\n    console.log("hello")\n}\n'
				const diffContent = `test.ts
<<<<<<< SEARCH
:start_line:1
-------
function hello() {
=======
function helloWorld() {
>>>>>>> REPLACE
<<<<<<< SEARCH
:start_line:2
-------
    console.log("hello")
=======
    console.log("hello world")
>>>>>>> REPLACE`

				await expectApplied(
					strategy,
					originalContent,
					diffContent,
					'function helloWorld() {\n    console.log("hello world")\n}\n',
				)
			})

			it("should replace matching content when end_line is passed in", async () => {
				const originalContent = 'function hello() {\n    console.log("hello")\n}\n'
				const diffContent = `test.ts
<<<<<<< SEARCH
:start_line:1
:end_line:1
-------
function hello() {
=======
function helloWorld() {
>>>>>>> REPLACE`

				await expectApplied(
					strategy,
					originalContent,
					diffContent,
					'function helloWorld() {\n    console.log("hello")\n}\n',
				)
			})

			it("should match content with different surrounding whitespace", async () => {
				const originalContent = "\nfunction example() {\n    return 42;\n}\n\n"
				const diffContent = `test.ts
<<<<<<< SEARCH
function example() {
    return 42;
}
=======
function example() {
    return 43;
}
>>>>>>> REPLACE`

				await expectApplied(
					strategy,
					originalContent,
					diffContent,
					"\nfunction example() {\n    return 43;\n}\n\n",
				)
			})

			it("should match content with different indentation in search block", async () => {
				const originalContent = "    function test() {\n        return true;\n    }\n"
				const diffContent = `test.ts
<<<<<<< SEARCH
function test() {
    return true;
}
=======
function test() {
    return false;
}
>>>>>>> REPLACE`

				await expectApplied(
					strategy,
					originalContent,
					diffContent,
					"    function test() {\n        return false;\n    }\n",
				)
			})

			it("should handle tab-based indentation", async () => {
				const originalContent = "function test() {\n\treturn true;\n}\n"
				const diffContent = `test.ts
<<<<<<< SEARCH
function test() {
\treturn true;
}
=======
function test() {
\treturn false;
}
>>>>>>> REPLACE`

				await expectApplied(strategy, originalContent, diffContent, "function test() {\n\treturn false;\n}\n")
			})

			it("should preserve mixed tabs and spaces", async () => {
				const originalContent = "\tclass Example {\n\t    constructor() {\n\t\tthis.value = 0;\n\t    }\n\t}"
				const diffContent = `test.ts
<<<<<<< SEARCH
\tclass Example {
\t    constructor() {
\t\tthis.value = 0;
\t    }
\t}
=======
\tclass Example {
\t    constructor() {
\t\tthis.value = 1;
\t    }
\t}
>>>>>>> REPLACE`

				await expectApplied(
					strategy,
					originalContent,
					diffContent,
					"\tclass Example {\n\t    constructor() {\n\t\tthis.value = 1;\n\t    }\n\t}",
				)
			})

			it("should handle additional indentation with tabs", async () => {
				const originalContent = "\tfunction test() {\n\t\treturn true;\n\t}"
				const diffContent = `test.ts
<<<<<<< SEARCH
function test() {
\treturn true;
}
=======
function test() {
\t// Add comment
\treturn false;
}
>>>>>>> REPLACE`

				await expectApplied(
					strategy,
					originalContent,
					diffContent,
					"\tfunction test() {\n\t\t// Add comment\n\t\treturn false;\n\t}",
				)
			})

			it("should preserve exact indentation characters when adding lines", async () => {
				const originalContent = "\tfunction test() {\n\t\treturn true;\n\t}"
				const diffContent = `test.ts
<<<<<<< SEARCH
\tfunction test() {
\t\treturn true;
\t}
=======
\tfunction test() {
\t\t// First comment
\t\t// Second comment
\t\treturn true;
\t}
>>>>>>> REPLACE`

				await expectApplied(
					strategy,
					originalContent,
					diffContent,
					"\tfunction test() {\n\t\t// First comment\n\t\t// Second comment\n\t\treturn true;\n\t}",
				)
			})

			it("should handle Windows-style CRLF line endings", async () => {
				const originalContent = "function test() {\r\n    return true;\r\n}\r\n"
				const diffContent = `test.ts
<<<<<<< SEARCH
function test() {
    return true;
}
=======
function test() {
    return false;
}
>>>>>>> REPLACE`

				await expectApplied(
					strategy,
					originalContent,
					diffContent,
					"function test() {\r\n    return false;\r\n}\r\n",
				)
			})

			it("should return false if search content does not match", async () => {
				const originalContent = 'function hello() {\n    console.log("hello")\n}\n'
				const diffContent = `test.ts
<<<<<<< SEARCH
function hello() {
    console.log("wrong")
}
=======
function hello() {
    console.log("hello world")
}
>>>>>>> REPLACE`

				const result = await strategy.applyDiff(originalContent, diffContent)
				expect(result.success).toBe(false)
			})

			it("should return false if diff format is invalid", async () => {
				const originalContent = 'function hello() {\n    console.log("hello")\n}\n'
				const diffContent = `test.ts\nInvalid diff format`

				const result = await strategy.applyDiff(originalContent, diffContent)
				expect(result.success).toBe(false)
			})

			it("should handle multiple lines with proper indentation", async () => {
				const originalContent =
					"class Example {\n    constructor() {\n        this.value = 0\n    }\n\n    getValue() {\n        return this.value\n    }\n}\n"
				const diffContent = `test.ts
<<<<<<< SEARCH
    getValue() {
        return this.value
    }
=======
    getValue() {
        // Add logging
        console.log("Getting value")
        return this.value
    }
>>>>>>> REPLACE`

				await expectApplied(
					strategy,
					originalContent,
					diffContent,
					'class Example {\n    constructor() {\n        this.value = 0\n    }\n\n    getValue() {\n        // Add logging\n        console.log("Getting value")\n        return this.value\n    }\n}\n',
				)
			})

			it("should preserve whitespace exactly in the output", async () => {
				const originalContent = "    indented\n        more indented\n    back\n"
				const diffContent = `test.ts
<<<<<<< SEARCH
    indented
        more indented
    back
=======
    modified
        still indented
    end
>>>>>>> REPLACE`

				await expectApplied(
					strategy,
					originalContent,
					diffContent,
					"    modified\n        still indented\n    end\n",
				)
			})

			it("should preserve indentation when adding new lines after existing content", async () => {
				const originalContent = "				onScroll={() => updateHighlights()}"
				const diffContent = `test.ts
<<<<<<< SEARCH
				onScroll={() => updateHighlights()}
=======
				onScroll={() => updateHighlights()}
				onDragOver={(e) => {
					e.preventDefault()
					e.stopPropagation()
				}}
>>>>>>> REPLACE`

				await expectApplied(
					strategy,
					originalContent,
					diffContent,
					"				onScroll={() => updateHighlights()}\n				onDragOver={(e) => {\n					e.preventDefault()\n					e.stopPropagation()\n				}}",
				)
			})

			it("should handle varying indentation levels correctly", async () => {
				const originalContent = `
class Example {
    constructor() {
        this.value = 0;
        if (true) {
            this.init();
        }
    }
}`.trim()

				const diffContent = `test.ts
<<<<<<< SEARCH
    class Example {
        constructor() {
            this.value = 0;
            if (true) {
                this.init();
            }
        }
    }
=======
    class Example {
        constructor() {
            this.value = 1;
            if (true) {
                this.init();
                this.setup();
                this.validate();
            }
        }
    }
>>>>>>> REPLACE`.trim()

				await expectApplied(
					strategy,
					originalContent,
					diffContent,
					`
class Example {
    constructor() {
        this.value = 1;
        if (true) {
            this.init();
            this.setup();
            this.validate();
        }
    }
}`.trim(),
				)
			})

			it("should handle mixed indentation styles in the same file", async () => {
				const originalContent = `class Example {
    constructor() {
        this.value = 0;
        if (true) {
            this.init();
        }
    }
}`.trim()
				const diffContent = `test.ts
<<<<<<< SEARCH
    constructor() {
        this.value = 0;
        if (true) {
        this.init();
        }
    }
=======
    constructor() {
        this.value = 1;
        if (true) {
        this.init();
        this.validate();
        }
    }
>>>>>>> REPLACE`

				await expectApplied(
					strategy,
					originalContent,
					diffContent,
					`class Example {
    constructor() {
        this.value = 1;
        if (true) {
        this.init();
        this.validate();
        }
    }
}`,
				)
			})

			it("should handle Python-style significant whitespace", async () => {
				const originalContent = `def example():
    if condition:
        do_something()
        for item in items:
            process(item)
    return True`.trim()
				const diffContent = `test.ts
<<<<<<< SEARCH
    if condition:
        do_something()
        for item in items:
            process(item)
=======
    if condition:
        do_something()
        while items:
            item = items.pop()
            process(item)
>>>>>>> REPLACE`

				await expectApplied(
					strategy,
					originalContent,
					diffContent,
					`def example():
    if condition:
        do_something()
        while items:
            item = items.pop()
            process(item)
    return True`,
				)
			})

			it("should preserve empty lines with indentation", async () => {
				const originalContent = `function test() {
    const x = 1;
    
    if (x) {
        return true;
    }
}`.trim()
				const diffContent = `test.ts
<<<<<<< SEARCH
    const x = 1;
    
    if (x) {
=======
    const x = 1;
    
    // Check x
    if (x) {
>>>>>>> REPLACE`

				await expectApplied(
					strategy,
					originalContent,
					diffContent,
					`function test() {
    const x = 1;
    
    // Check x
    if (x) {
        return true;
    }
}`,
				)
			})

			it("should handle indentation when replacing entire blocks", async () => {
				const originalContent = `class Test {
    method() {
        if (true) {
            console.log("test");
        }
    }
}`.trim()
				const diffContent = `test.ts
<<<<<<< SEARCH
    method() {
        if (true) {
            console.log("test");
        }
    }
=======
    method() {
        try {
            if (true) {
                console.log("test");
            }
        } catch (e) {
            console.error(e);
        }
    }
>>>>>>> REPLACE`

				await expectApplied(
					strategy,
					originalContent,
					diffContent,
					`class Test {
    method() {
        try {
            if (true) {
                console.log("test");
            }
        } catch (e) {
            console.error(e);
        }
    }
}`,
				)
			})

			it("should handle negative indentation relative to search content", async () => {
				const originalContent = `class Example {
    constructor() {
        if (true) {
            this.init();
            this.setup();
        }
    }
}`.trim()
				const diffContent = `test.ts
<<<<<<< SEARCH
            this.init();
            this.setup();
=======
        this.init();
        this.setup();
>>>>>>> REPLACE`

				await expectApplied(
					strategy,
					originalContent,
					diffContent,
					`class Example {
    constructor() {
        if (true) {
        this.init();
        this.setup();
        }
    }
}`,
				)
			})

			it("should handle extreme negative indentation (no indent)", async () => {
				const originalContent = `class Example {
    constructor() {
        if (true) {
            this.init();
        }
    }
}`.trim()
				const diffContent = `test.ts
<<<<<<< SEARCH
            this.init();
=======
this.init();
>>>>>>> REPLACE`

				await expectApplied(
					strategy,
					originalContent,
					diffContent,
					`class Example {
    constructor() {
        if (true) {
this.init();
        }
    }
}`,
				)
			})

			it("should handle mixed indentation changes in replace block", async () => {
				const originalContent = `class Example {
    constructor() {
        if (true) {
            this.init();
            this.setup();
            this.validate();
        }
    }
}`.trim()
				const diffContent = `test.ts
<<<<<<< SEARCH
            this.init();
            this.setup();
            this.validate();
=======
        this.init();
            this.setup();
    this.validate();
>>>>>>> REPLACE`

				await expectApplied(
					strategy,
					originalContent,
					diffContent,
					`class Example {
    constructor() {
        if (true) {
        this.init();
            this.setup();
    this.validate();
        }
    }
}`,
				)
			})

			it("should find matches from middle out", async () => {
				const originalContent = `
function one() {
    return "target";
}

function two() {
    return "target";
}

function three() {
    return "target";
}

function four() {
    return "target";
}

function five() {
    return "target";
}`.trim()

				const diffContent = `test.ts
<<<<<<< SEARCH
    return "target";
=======
    return "updated";
>>>>>>> REPLACE`

				// Search around the middle (function three)
				// Even though all functions contain the target text,
				// it should match the one closest to line 9 first
				const result = await strategy.applyDiff(originalContent, diffContent, 9)
				expect(result.success).toBe(true)
				if (result.success) {
					expect(result.content).toBe(`function one() {
    return "target";
}

function two() {
    return "target";
}

function three() {
    return "updated";
}

function four() {
    return "target";
}

function five() {
    return "target";
}`)
				}
			})
		})
	})

	describe("fuzzy matching", () => {
		let strategy: MultiSearchReplaceDiffStrategy
		beforeEach(() => {
			strategy = new MultiSearchReplaceDiffStrategy(0.9, 5) // 90% similarity threshold, 5 line buffer for tests
		})

		it("should match content with small differences (>90% similar)", async () => {
			const originalContent =
				"function getData() {\n    const results = fetchData();\n    return results.filter(Boolean);\n}\n"
			const diffContent = `test.ts
<<<<<<< SEARCH
function getData() {
    const result = fetchData();
    return results.filter(Boolean);
}
=======
function getData() {
    const data = fetchData();
    return data.filter(Boolean);
}
>>>>>>> REPLACE`

			strategy = new MultiSearchReplaceDiffStrategy(0.9, 5) // Use 5 line buffer for tests

			await expectApplied(
				strategy,
				originalContent,
				diffContent,
				"function getData() {\n    const data = fetchData();\n    return data.filter(Boolean);\n}\n",
			)
		})

		it("should not match when content is too different (<90% similar)", async () => {
			const originalContent = "function processUsers(data) {\n    return data.map(user => user.name);\n}\n"
			const diffContent = `test.ts
<<<<<<< SEARCH
function handleItems(items) {
    return items.map(item => item.username);
}
=======
function processData(data) {
    return data.map(d => d.value);
}
>>>>>>> REPLACE`

			const result = await strategy.applyDiff(originalContent, diffContent)
			expect(result.success).toBe(false)
		})

		it("should match content with extra whitespace", async () => {
			const originalContent = "function sum(a, b) {\n    return a + b;\n}"
			const diffContent = `test.ts
<<<<<<< SEARCH
function   sum(a,   b)    {
    return    a + b;
}
=======
function sum(a, b) {
    return a + b + 1;
}
>>>>>>> REPLACE`

			await expectApplied(
				strategy,
				originalContent,
				diffContent,
				"function sum(a, b) {\n    return a + b + 1;\n}",
			)
		})

		it("should match content with smart quotes", async () => {
			const originalContent =
				"**Enjoy Roo Code!** Whether you keep it on a short leash or let it roam autonomously, we can't wait to see what you build. If you have questions or feature ideas, drop by our [Reddit community](https://www.reddit.com/r/TumbleCode/) or [Discord](https://discord.gg/tumblecode). Happy coding!"
			const diffContent = `test.ts
<<<<<<< SEARCH
**Enjoy Roo Code!** Whether you keep it on a short leash or let it roam autonomously, we can't wait to see what you build. If you have questions or feature ideas, drop by our [Reddit community](https://www.reddit.com/r/TumbleCode/) or [Discord](https://discord.gg/tumblecode). Happy coding!
=======
**Enjoy Roo Code!** Whether you keep it on a short leash or let it roam autonomously, we can't wait to see what you build. If you have questions or feature ideas, drop by our [Reddit community](https://www.reddit.com/r/TumbleCode/) or [Discord](https://discord.gg/tumblecode). Happy coding!

You're still here?
>>>>>>> REPLACE`

			await expectApplied(
				strategy,
				originalContent,
				diffContent,
				"**Enjoy Roo Code!** Whether you keep it on a short leash or let it roam autonomously, we can't wait to see what you build. If you have questions or feature ideas, drop by our [Reddit community](https://www.reddit.com/r/TumbleCode/) or [Discord](https://discord.gg/tumblecode). Happy coding!\n\nYou're still here?",
			)
		})

		it("should not exact match empty lines", async () => {
			const originalContent = "function sum(a, b) {\n\n    return a + b;\n}"
			const diffContent = `test.ts
<<<<<<< SEARCH
function sum(a, b) {
=======
import { a } from "a";
function sum(a, b) {
>>>>>>> REPLACE`

			await expectApplied(
				strategy,
				originalContent,
				diffContent,
				'import { a } from "a";\nfunction sum(a, b) {\n\n    return a + b;\n}',
			)
		})
	})

	describe("deletion", () => {
		let strategy: MultiSearchReplaceDiffStrategy

		beforeEach(() => {
			strategy = new MultiSearchReplaceDiffStrategy()
		})

		it("should delete code when replace block is empty", async () => {
			const originalContent = `function test() {
    console.log("hello");
    // Comment to remove
    console.log("world");
}`
			const diffContent = `test.ts
<<<<<<< SEARCH
    // Comment to remove
=======
>>>>>>> REPLACE`

			await expectApplied(
				strategy,
				originalContent,
				diffContent,
				`function test() {
    console.log("hello");
    console.log("world");
}`,
			)
		})

		it("should delete multiple lines when replace block is empty", async () => {
			const originalContent = `class Example {
    constructor() {
        // Initialize
        this.value = 0;
        // Set defaults
        this.name = "";
        // End init
    }
}`
			const diffContent = `test.ts
<<<<<<< SEARCH
        // Initialize
        this.value = 0;
        // Set defaults
        this.name = "";
        // End init
=======
>>>>>>> REPLACE`

			await expectApplied(
				strategy,
				originalContent,
				diffContent,
				`class Example {
    constructor() {
    }
}`,
			)
		})

		it("should preserve indentation when deleting nested code", async () => {
			const originalContent = `function outer() {
    if (true) {
        // Remove this
        console.log("test");
        // And this
    }
    return true;
}`
			const diffContent = `test.ts
<<<<<<< SEARCH
        // Remove this
        console.log("test");
        // And this
=======
>>>>>>> REPLACE`

			await expectApplied(
				strategy,
				originalContent,
				diffContent,
				`function outer() {
    if (true) {
    }
    return true;
}`,
			)
		})

		it("should delete a line when search block has line number prefix and replace is empty", async () => {
			const originalContent = "line 1\nline to delete\nline 3"
			const diffContent = `
<<<<<<< SEARCH
:start_line:2
-------
2 | line to delete
=======
>>>>>>> REPLACE`
			await expectApplied(strategy, originalContent, diffContent, "line 1\nline 3")
		})
	})

	describe("repairTruncatedDiff", () => {
		let strategy: MultiSearchReplaceDiffStrategy

		beforeEach(() => {
			strategy = new MultiSearchReplaceDiffStrategy()
		})

		it("should not modify a complete diff", () => {
			const diff = "<<<<<<< SEARCH\n" + "original content\n" + "=======\n" + "new content\n" + ">>>>>>> REPLACE"
			const result = strategy["repairTruncatedDiff"](diff)
			expect(result).toBe(diff)
		})

		it("should not modify a diff with multiple complete blocks", () => {
			const diff =
				"<<<<<<< SEARCH\n" +
				"content1\n" +
				"=======\n" +
				"new1\n" +
				">>>>>>> REPLACE\n\n" +
				"<<<<<<< SEARCH\n" +
				"content2\n" +
				"=======\n" +
				"new2\n" +
				">>>>>>> REPLACE"
			const result = strategy["repairTruncatedDiff"](diff)
			expect(result).toBe(diff)
		})

		it("should repair diff missing ======= and >>>>>>> REPLACE", () => {
			const diff = "<<<<<<< SEARCH\n" + "original content\n" + "new content"
			const result = strategy["repairTruncatedDiff"](diff)
			expect(result).toBe(
				"<<<<<<< SEARCH\n" + "original content\n" + "=======\n" + "new content\n" + ">>>>>>> REPLACE",
			)
		})

		it("should repair diff missing only >>>>>>> REPLACE", () => {
			const diff = "<<<<<<< SEARCH\n" + "original content\n" + "=======\n" + "new content"
			const result = strategy["repairTruncatedDiff"](diff)
			expect(result).toBe(
				"<<<<<<< SEARCH\n" + "original content\n" + "=======\n" + "new content\n" + ">>>>>>> REPLACE",
			)
		})

		it("should repair first truncated block while preserving subsequent complete blocks", () => {
			const diff =
				"<<<<<<< SEARCH\n" +
				"content1\n" +
				"new1\n\n" +
				"<<<<<<< SEARCH\n" +
				"content2\n" +
				"=======\n" +
				"new2\n" +
				">>>>>>> REPLACE"
			const result = strategy["repairTruncatedDiff"](diff)
			expect(result).toBe(
				"<<<<<<< SEARCH\n" +
					"content1\n" +
					"=======\n" +
					"new1\n" +
					">>>>>>> REPLACE\n\n" +
					"<<<<<<< SEARCH\n" +
					"content2\n" +
					"=======\n" +
					"new2\n" +
					">>>>>>> REPLACE",
			)
		})

		it("should handle empty search content with missing replace marker", () => {
			const diff = "<<<<<<< SEARCH\n" + "replacement text"
			const result = strategy["repairTruncatedDiff"](diff)
			expect(result).toBe("<<<<<<< SEARCH\n" + "=======\n" + "replacement text\n" + ">>>>>>> REPLACE")
		})

		it("should not add trailing newline if content already ends with one", () => {
			const diff = "<<<<<<< SEARCH\n" + "original\n" + "=======\n" + "new content\n"
			const result = strategy["repairTruncatedDiff"](diff)
			expect(result).toBe("<<<<<<< SEARCH\n" + "original\n" + "=======\n" + "new content\n" + ">>>>>>> REPLACE")
		})

		it("inserts ======= before an existing closer instead of synthesizing a second one", () => {
			// Has >>>>>>> REPLACE but no ======= separator.
			const diff = "<<<<<<< SEARCH\n" + "old line\n" + ">>>>>>> REPLACE"
			const result = strategy["repairTruncatedDiff"](diff)
			expect(result).toBe("<<<<<<< SEARCH\n" + "old line\n" + "=======\n" + ">>>>>>> REPLACE")
			// Exactly one closer, exactly one separator.
			expect(result.match(/>>>>>>> REPLACE/g)).toHaveLength(1)
			expect(result.match(/^=======$/gm)).toHaveLength(1)
		})

		it("preserves :start_line: / ------- directives instead of treating them as SEARCH content", () => {
			const diff = "<<<<<<< SEARCH\n" + ":start_line:5\n" + "-------\n" + "old line\n" + "new line"
			const result = strategy["repairTruncatedDiff"](diff)
			expect(result).toBe(
				"<<<<<<< SEARCH\n" +
					":start_line:5\n" +
					"-------\n" +
					"old line\n" +
					"=======\n" +
					"new line\n" +
					">>>>>>> REPLACE",
			)
		})

		it("treats a single content line after a directive header as the SEARCH target", () => {
			const diff = "<<<<<<< SEARCH\n" + ":start_line:5\n" + "-------\n" + "old line"
			const result = strategy["repairTruncatedDiff"](diff)
			expect(result).toBe(
				"<<<<<<< SEARCH\n" +
					":start_line:5\n" +
					"-------\n" +
					"old line\n" +
					"=======\n" +
					"\n" +
					">>>>>>> REPLACE",
			)
		})
	})

	// Regression guards for #186: Grok sometimes truncates the streamed diff and drops
	// the closing markers, which previously surfaced as "Unable to apply diff - Expected
	// '=======' was not found". These fixtures exercise the full applyDiff() path end-to-end.
	describe("truncated Grok diff regression (#186)", () => {
		const grokStrategy = new MultiSearchReplaceDiffStrategy(1.0, 5)
		const originalContent = 'function greet() {\n\treturn "hello"\n}\n'
		const expectedContent = 'function greet() {\n\treturn "hi there"\n}\n'

		it("applies a diff whose closing >>>>>>> REPLACE marker was truncated", async () => {
			const diff =
				"src/greet.ts\n" + "<<<<<<< SEARCH\n" + '\treturn "hello"\n' + "=======\n" + '\treturn "hi there"'
			const result = await grokStrategy.applyDiff(originalContent, diff)
			expect(result.success).toBe(true)
			if (result.success) {
				expect(result.content).toBe(expectedContent)
			}
		})

		it("applies a diff truncated before the ======= separator", async () => {
			const diff = "src/greet.ts\n" + "<<<<<<< SEARCH\n" + '\treturn "hello"\n' + '\treturn "hi there"'
			const result = await grokStrategy.applyDiff(originalContent, diff)
			expect(result.success).toBe(true)
			if (result.success) {
				expect(result.content).toBe(expectedContent)
			}
		})

		it("leaves a well-formed multi-block diff unchanged", async () => {
			const multiBlock = "export const a = 1\nexport const b = 2\n"
			const diff =
				"src/consts.ts\n" +
				"<<<<<<< SEARCH\n" +
				"export const a = 1\n" +
				"=======\n" +
				"export const a = 10\n" +
				">>>>>>> REPLACE\n" +
				"<<<<<<< SEARCH\n" +
				"export const b = 2\n" +
				"=======\n" +
				"export const b = 20\n" +
				">>>>>>> REPLACE"
			const result = await grokStrategy.applyDiff(multiBlock, diff)
			expect(result.success).toBe(true)
			if (result.success) {
				expect(result.content).toBe("export const a = 10\nexport const b = 20\n")
			}
		})
	})
	describe("failed block positions", () => {
		it("names each failed block by its place in the diff and its :start_line:", async () => {
			const strategy = new MultiSearchReplaceDiffStrategy()
			const diff =
				"<<<<<<< SEARCH\n:start_line:3\n-------\nc\n=======\nC\n>>>>>>> REPLACE\n\n" +
				"<<<<<<< SEARCH\n:start_line:1\n-------\nnot in file\n=======\nx\n>>>>>>> REPLACE\n\n" +
				"<<<<<<< SEARCH\nalso not in file\n=======\ny\n>>>>>>> REPLACE"

			const result = await strategy.applyDiff("a\nb\nc\nd", diff)

			expect(result.success).toBe(true)
			expect(result.blockCount).toBe(3)
			// Blocks are applied in start-line order, so the fail parts come out sorted that way.
			expect(result.failParts?.map((part) => (part.success ? null : [part.blockIndex, part.startLine]))).toEqual([
				[3, undefined],
				[2, 1],
			])
		})
	})
})
