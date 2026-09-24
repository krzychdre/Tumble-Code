import { getBuiltInCommands, getBuiltInCommand, getBuiltInCommandNames } from "../built-in-commands"

describe("Built-in Commands", () => {
	describe("getBuiltInCommands", () => {
		it("should return all built-in commands", async () => {
			const commands = await getBuiltInCommands()

			expect(commands).toHaveLength(1)
			expect(commands.map((cmd) => cmd.name)).toEqual(expect.arrayContaining(["init"]))

			// Verify all commands have required properties
			commands.forEach((command) => {
				expect(command.name).toBeDefined()
				expect(typeof command.name).toBe("string")
				expect(command.content).toBeDefined()
				expect(typeof command.content).toBe("string")
				expect(command.source).toBe("built-in")
				expect(command.filePath).toMatch(/^<built-in:.+>$/)
				expect(command.description).toBeDefined()
				expect(typeof command.description).toBe("string")
			})
		})

		it("should return commands with proper content", async () => {
			const commands = await getBuiltInCommands()

			const initCommand = commands.find((cmd) => cmd.name === "init")
			expect(initCommand).toBeDefined()
			expect(initCommand!.content).toContain("AGENTS.md")
			expect(initCommand!.content).toContain(".roo/rules-")
			expect(initCommand!.description).toBe(
				"Analyze codebase and create concise AGENTS.md files for AI assistants",
			)
		})
	})

	describe("getBuiltInCommand", () => {
		it("should return specific built-in command by name", async () => {
			const initCommand = await getBuiltInCommand("init")

			expect(initCommand).toBeDefined()
			expect(initCommand!.name).toBe("init")
			expect(initCommand!.source).toBe("built-in")
			expect(initCommand!.filePath).toBe("<built-in:init>")
			expect(initCommand!.content).toContain("AGENTS.md")
			expect(initCommand!.description).toBe(
				"Analyze codebase and create concise AGENTS.md files for AI assistants",
			)
		})

		it("should return undefined for non-existent command", async () => {
			const nonExistentCommand = await getBuiltInCommand("non-existent")
			expect(nonExistentCommand).toBeUndefined()
		})

		it("should handle empty string command name", async () => {
			const emptyCommand = await getBuiltInCommand("")
			expect(emptyCommand).toBeUndefined()
		})
	})

	describe("getBuiltInCommandNames", () => {
		it("should return all built-in command names", async () => {
			const names = await getBuiltInCommandNames()

			expect(names).toHaveLength(1)
			expect(names).toEqual(expect.arrayContaining(["init"]))
			// Order doesn't matter since it's based on filesystem order
			expect(names.sort()).toEqual(["init"])
		})

		it("should return array of strings", async () => {
			const names = await getBuiltInCommandNames()

			names.forEach((name) => {
				expect(typeof name).toBe("string")
				expect(name.length).toBeGreaterThan(0)
			})
		})
	})

	describe("Command Content Validation", () => {
		it("init command should have comprehensive content", async () => {
			const command = await getBuiltInCommand("init")
			const content = command!.content

			// Should contain key sections
			expect(content).toContain("Please analyze this codebase")
			expect(content).toContain("Build/lint/test commands")
			expect(content).toContain("Code style guidelines")
			expect(content).toContain("non-obvious")
			expect(content).toContain("discovered by reading files")

			// Should mention important concepts
			expect(content).toContain("AGENTS.md")
			expect(content).toContain(".roo/rules-")
			expect(content).toContain("rules-code")
			expect(content).toContain("rules-debug")
			expect(content).toContain("rules-ask")
			expect(content).toContain("rules-architect")
		})

		// The example rules used to describe this repository itself (packages that were
		// deleted in #252, our own helpers and folders). Weak models copy concrete examples
		// verbatim into the user's AGENTS.md, so the examples must be placeholders only.
		it("init examples do not describe this repository or deleted packages", async () => {
			const content = (await getBuiltInCommand("init"))!.content

			for (const stale of [
				"packages/evals",
				"packages/ipc",
				"packages/types",
				"safeWriteJson",
				"src/api/providers",
				"webview-ui",
				"VSCode extension",
				"Extension Host",
			]) {
				expect(content).not.toContain(stale)
			}
			expect(content).not.toMatch(/Roo Code|roo-cline|RooCode/i)
		})

		it("init examples are marked as placeholders the model must not copy", async () => {
			const content = (await getBuiltInCommand("init"))!.content

			expect(content).toContain("<package-name>")
			expect(content).toContain("placeholders, not facts about this repository")
			expect(content).toContain("Never copy an example line")
			// Each of the four mode example blocks is still present, with its heading.
			for (const heading of [
				"# Project Coding Rules (Non-Obvious Only)",
				"# Project Debug Rules (Non-Obvious Only)",
				"# Project Documentation Rules (Non-Obvious Only)",
				"# Project Architecture Rules (Non-Obvious Only)",
			]) {
				expect(content).toContain(heading)
			}
		})
	})
})
