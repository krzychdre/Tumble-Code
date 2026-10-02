import { NativeToolCallParser } from "../../assistant-message/NativeToolCallParser"
import { TOOL_DESCRIPTORS, type DispatchableToolName } from "../toolDescriptors"

/**
 * CORE-R4 c: argument parsing is a `parseArgs(raw, { partial })` function on each
 * descriptor row, and NativeToolCallParser reaches it through the table. The per-tool
 * behavior itself is pinned by NativeToolCallParser.args-snapshot.spec.ts.
 */

const names = Object.keys(TOOL_DESCRIPTORS) as DispatchableToolName[]

describe("parseArgs on the tool descriptors", () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it.each(names)("%s has a parseArgs function", (name) => {
		expect(typeof TOOL_DESCRIPTORS[name].parseArgs).toBe("function")
	})

	it("aliases share the parser of their canonical tool", () => {
		expect(TOOL_DESCRIPTORS.search_and_replace.parseArgs).toBe(TOOL_DESCRIPTORS.edit.parseArgs)
		expect(TOOL_DESCRIPTORS.read_command_output.parseArgs).toBe(TOOL_DESCRIPTORS.read_artifact.parseArgs)
	})

	it("read_file coerces weak-model input the same way while streaming and when complete", () => {
		const raw = {
			path: "a.ts",
			offset: "10",
			limit: "5",
			indentation: { anchor_line: "3", include_siblings: "TRUE", include_header: " false " },
		}
		const expected = {
			nativeArgs: {
				path: "a.ts",
				mode: undefined,
				offset: 10,
				limit: 5,
				indentation: {
					anchor_line: 3,
					max_levels: undefined,
					max_lines: undefined,
					include_siblings: true,
					include_header: false,
				},
			},
		}
		expect(TOOL_DESCRIPTORS.read_file.parseArgs(raw, { partial: true })).toEqual(expected)
		expect(TOOL_DESCRIPTORS.read_file.parseArgs(raw, { partial: false })).toEqual(expected)
	})

	it.each([
		["24576", 24576],
		["24KB", 24576],
		["24kb", 24576],
		["24 Kb", 24576],
		[" 24KiB ", 24576],
		["24k", 24576],
		["1.5MB", 1572864],
		["2mib", 2097152],
		["300 bytes", 300],
		["300B", 300],
		[100.7, 100],
	])("read_artifact reads the byte count %j as %d", (input, expected) => {
		const parsed = TOOL_DESCRIPTORS.read_artifact.parseArgs(
			{ artifact_id: "cmd-1.txt", offset: input, limit: input },
			{ partial: false },
		)
		expect(parsed?.nativeArgs).toMatchObject({ offset: expected, limit: expected })
	})

	it.each(["abc", "24 GB", "-5", "24KB of text", ""])(
		"read_artifact leaves the unreadable byte count %j for the tool to reject",
		(input) => {
			const parsed = TOOL_DESCRIPTORS.read_artifact.parseArgs(
				{ artifact_id: "cmd-1.txt", limit: input },
				{ partial: false },
			)
			expect(parsed?.nativeArgs).toMatchObject({ limit: input })
		},
	)

	it("read_file reports the legacy files shape for telemetry", () => {
		const parsed = TOOL_DESCRIPTORS.read_file.parseArgs({ files: '[{"path":"a.ts"}]' }, { partial: false })
		expect(parsed).toEqual({
			nativeArgs: { files: [{ path: "a.ts" }], _legacyFormat: true },
			usedLegacyFormat: true,
		})
	})

	it("parseToolCall and processStreamingChunk delegate to the row's parseArgs", () => {
		const spy = vi.spyOn(TOOL_DESCRIPTORS.web_fetch, "parseArgs")

		NativeToolCallParser.parseToolCall({ id: "c1", name: "web_fetch", arguments: '{"url":"https://a.b"}' })
		expect(spy).toHaveBeenLastCalledWith({ url: "https://a.b" }, { partial: false })

		const parser = new NativeToolCallParser()
		parser.startStreamingToolCall("c2", "web_fetch")
		parser.processStreamingChunk("c2", '{"url":"https://a')
		expect(spy).toHaveBeenLastCalledWith({ url: "https://a" }, { partial: true })
	})
})
