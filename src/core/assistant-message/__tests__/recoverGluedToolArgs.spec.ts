import { NativeToolCallParser } from "../NativeToolCallParser"
import { recoverGluedToolArgs } from "../recoverGluedToolArgs"

const DIFF = "<<<<<<< SEARCH\n:start_line:1\n-------\nold\n=======\nnew\n>>>>>>> REPLACE"

function parse(name: string, args: Record<string, unknown>) {
	return NativeToolCallParser.parseToolCall({ id: "call_1", name: name as never, arguments: JSON.stringify(args) })
}

describe("recoverGluedToolArgs (GLM template argument glued onto the previous one)", () => {
	describe("real shapes from GLM-5.3 task histories", () => {
		it.each([
			["newline, no <arg_key> opener", `${DIFF}\npath</arg_key><arg_value>src/main.js`],
			["no newline, with opener", `${DIFF}<arg_key>path</arg_key><arg_value>zdrowie/dziennik-kawy.md`],
			["newline and opener", `${DIFF}\n<arg_key>path</arg_key><arg_value>src/main.js`],
			["closing </arg_value> kept", `${DIFF}\n<arg_key>path</arg_key><arg_value>src/main.js</arg_value>`],
		])("apply_diff: %s", (_label, diff) => {
			const toolUse = parse("apply_diff", { diff })

			const expectedPath = diff.includes("dziennik") ? "zdrowie/dziennik-kawy.md" : "src/main.js"
			expect(toolUse).not.toBeNull()
			expect(toolUse?.type === "tool_use" && toolUse.nativeArgs).toEqual({ path: expectedPath, diff: DIFF })
			expect(toolUse?.type === "tool_use" && toolUse.params).toEqual({ path: expectedPath, diff: DIFF })
		})

		it("keeps the content's own trailing newline, strips only the template's one", () => {
			const toolUse = parse("apply_diff", { diff: `${DIFF}\n\npath</arg_key><arg_value>src/main.js` })

			expect(toolUse?.type === "tool_use" && toolUse.nativeArgs).toEqual({
				path: "src/main.js",
				diff: `${DIFF}\n`,
			})
		})

		it("recovers a glued argument of other tools", () => {
			expect(
				recoverGluedToolArgs("write_to_file", {
					content: "line 1\nline 2\n<arg_key>path</arg_key><arg_value>notes.md",
				}),
			).toEqual({ content: "line 1\nline 2", path: "notes.md" })

			expect(
				recoverGluedToolArgs("execute_command", {
					command: "npm test\ncwd</arg_key><arg_value>src</arg_value>",
					cwd: null,
				}),
			).toEqual({ command: "npm test", cwd: "src" })
		})

		it("peels more than one string argument off the end", () => {
			expect(
				recoverGluedToolArgs("search_files", {
					regex: "foo\\(\npath</arg_key><arg_value>src</arg_value>\n<arg_key>file_pattern</arg_key><arg_value>*.ts",
				}),
			).toEqual({ regex: "foo\\(", path: "src", file_pattern: "*.ts" })
		})

		it("treats an empty argument as missing", () => {
			expect(
				recoverGluedToolArgs("apply_diff", { path: "", diff: `${DIFF}\npath</arg_key><arg_value>a.js` }),
			).toEqual({
				path: "a.js",
				diff: DIFF,
			})
		})
	})

	describe("leaves the arguments verbatim", () => {
		it("when the parameter is already present", () => {
			const args = { path: "src/main.js", diff: `${DIFF}\npath</arg_key><arg_value>other.js` }

			expect(recoverGluedToolArgs("apply_diff", args)).toBe(args)
			const toolUse = parse("apply_diff", args)
			expect(toolUse?.type === "tool_use" && toolUse.nativeArgs).toEqual(args)
		})

		it("when NAME is not a parameter of this tool", () => {
			const args = { diff: `${DIFF}\nfile</arg_key><arg_value>src/main.js` }

			expect(recoverGluedToolArgs("apply_diff", args)).toBe(args)
			expect(parse("apply_diff", args)).toBeNull()
		})

		it("when the markup sits in the middle of the content", () => {
			const args = {
				content: "docs:\n<arg_key>path</arg_key><arg_value>example.md</arg_value>\nmore text after it\n",
			}

			expect(recoverGluedToolArgs("write_to_file", args)).toBe(args)
		})

		it("when the markup is only part of a longer word or lacks <arg_value>", () => {
			const glued = { diff: `${DIFF}\nmypath</arg_key><arg_value>src/main.js` }
			const noValue = { diff: `${DIFF}\n<arg_key>path</arg_key> src/main.js` }

			expect(recoverGluedToolArgs("apply_diff", glued)).toBe(glued)
			expect(recoverGluedToolArgs("apply_diff", noValue)).toBe(noValue)
		})

		it("when the glued parameter is not a string (and then nothing before it either)", () => {
			const args = {
				command:
					"npm test\n<arg_key>cwd</arg_key><arg_value>src</arg_value>\n<arg_key>timeout</arg_key><arg_value>60",
			}

			expect(recoverGluedToolArgs("execute_command", args)).toBe(args)
		})

		it("for a tool without a schema and for non-object arguments", () => {
			const args = { path: `x\npath</arg_key><arg_value>y` }

			expect(recoverGluedToolArgs("no_such_tool", args)).toBe(args)
			expect(recoverGluedToolArgs("apply_diff", ["a"])).toEqual(["a"])
		})
	})

	describe("streaming", () => {
		it("the partial preview shows the raw value; the finished call is repaired", () => {
			const parser = new NativeToolCallParser()
			parser.startStreamingToolCall("call_1", "apply_diff")
			const json = JSON.stringify({ diff: `${DIFF}\npath</arg_key><arg_value>src/main.js` })

			const partial = parser.processStreamingChunk("call_1", json)
			expect(partial?.partial).toBe(true)
			expect(partial?.params.diff).toBe(`${DIFF}\npath</arg_key><arg_value>src/main.js`)

			const final = parser.finalizeStreamingToolCall("call_1")
			expect(final?.type === "tool_use" && final.nativeArgs).toEqual({ path: "src/main.js", diff: DIFF })
		})
	})
})
