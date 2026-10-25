import { getCapabilitiesSection, getMcpAvailabilitySection } from "../sections/capabilities"
import { getRulesSection, getCommandChainOperator } from "../sections/rules"
import { McpHub } from "../../../services/mcp/McpHub"
import * as shellUtils from "../../../utils/shell"

describe("getCapabilitiesSection", () => {
	const result = getCapabilitiesSection("/test/path")

	// CAPABILITIES is mode-independent (stable head), so it cannot know whether
	// this mode has execute_command. The orchestrator (`groups: []`) read the old
	// "You can use the execute_command tool" as a promise, called the tool, and
	// looped on empty responses because vLLM dropped the unknown tool call.
	it("does not promise execute_command or any other tool unconditionally", () => {
		expect(result).not.toContain("You can use the execute_command tool")
		expect(result).not.toContain("You have access to tools that let you")
		expect(result).toContain("exactly the tools in the tool list of this request")
		expect(result).toContain("calling it fails and gives you no result")

		// Every sentence that names a concrete tool states the condition first.
		for (const tool of ["execute_command", "list_files"]) {
			const sentences = result.split(/(?<=\.)\s+/).filter((sentence) => sentence.includes(tool))
			expect(sentences.length).toBeGreaterThan(0)
			for (const sentence of sentences) {
				expect(sentence).toMatch(new RegExp(`When your tool list includes ${tool}\\b`))
			}
		}
	})

	// Prefix stability (WS-F): CAPABILITIES belongs to the stable head, so it must
	// not mention MCP at all. Whether MCP is available varies per mode, and that
	// decision now lives in getMcpAvailabilitySection, in the variable tail.
	it("never mentions MCP", () => {
		expect(result).not.toContain("MCP")
	})
})

describe("getMcpAvailabilitySection", () => {
	const hub = (serverNames: string[]) =>
		({ getServers: () => serverNames.map((name) => ({ name })) }) as unknown as McpHub

	it.each([
		["a hub with a server", hub(["test-server"]), undefined, true],
		["no hub", undefined, undefined, false],
		["a hub without servers", hub([]), undefined, false],
		["an allowlist that names a connected server", hub(["allowed", "other"]), ["allowed"], true],
		["an empty allowlist", hub(["test-server"]), [], false],
		["an allowlist that names no connected server", hub(["test-server"]), ["nonexistent"], false],
	])("for %s: %s", (_label, mcpHub, allowed, advertised) => {
		const result = getMcpAvailabilitySection(mcpHub, allowed)

		if (advertised) {
			expect(result).toContain("====\n\nMCP SERVERS")
		} else {
			expect(result).toBe("")
		}
	})
})

describe("command chaining by shell", () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it.each([
		["/bin/zsh", "&&", undefined],
		["C:\\Program Files\\Git\\bin\\bash.exe", "&&", undefined],
		[
			"C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
			";",
			"Note: Using `;` for PowerShell command chaining. For bash/zsh use `&&`, for cmd.exe use `&&`. IMPORTANT: When using PowerShell, avoid Unix-specific utilities",
		],
		["/usr/local/bin/pwsh", ";", "IMPORTANT: When using PowerShell"],
		[
			"C:\\Windows\\System32\\cmd.exe",
			"&&",
			"Note: Using `&&` for cmd.exe command chaining (conditional execution). For bash/zsh use `&&`, for PowerShell use `;`. IMPORTANT: When using cmd.exe, avoid Unix-specific utilities",
		],
	])("%s chains with %s", (shell, operator, note) => {
		vi.spyOn(shellUtils, "getShell").mockReturnValue(shell)

		const rules = getRulesSection("/test/path")

		expect(getCommandChainOperator()).toBe(operator)
		expect(rules).toContain("- The project base directory is: /test/path\n")
		const chainLine = rules.split("\n").find((line) => line.startsWith("- Chain shell commands with"))!
		expect(
			chainLine.startsWith(
				`- Chain shell commands with \`${operator}\`, for example \`cd (path to project) ${operator} (command)\`.`,
			),
		).toBe(true)
		if (note) {
			expect(chainLine).toContain(note)
		} else {
			expect(chainLine).not.toContain("Note:")
		}
	})
})
