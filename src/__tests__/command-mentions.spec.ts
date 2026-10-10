import { parseMentions } from "../core/mentions"
import { getBuiltInCommand } from "../services/command/built-in-commands"
import { buildSkillResult } from "../services/skills/skillInvocation"

// Mock the dependencies
vi.mock("../services/command/built-in-commands")

const mockGetCommand = vi.mocked(getBuiltInCommand)

describe("Command Mentions", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	// Helper function to call parseMentions with required parameters
	const callParseMentions = async (text: string) => {
		return parseMentions(
			text,
			"/test/cwd", // cwd
			undefined, // fileContextTracker
			undefined, // rooIgnoreController
			false, // showRooIgnoredFiles
			true, // includeDiagnosticMessages
			50, // maxDiagnosticMessages
		)
	}

	describe("parseMentions with command support", () => {
		it("should parse command mentions and include content", async () => {
			const commandContent = "# Setup Environment\n\nRun the following commands:\n```bash\nnpm install\n```"
			mockGetCommand.mockResolvedValue({
				name: "setup",
				content: commandContent,
				source: "built-in",
				filePath: "<built-in:setup>",
			})

			const input = "/setup Please help me set up the project"
			const result = await callParseMentions(input)

			expect(mockGetCommand).toHaveBeenCalledWith("setup")
			expect(result.slashCommandHelp).toContain('<command name="setup">')
			expect(result.slashCommandHelp).toContain(commandContent)
			expect(result.slashCommandHelp).toContain("</command>")
			expect(result.text).toContain("Please help me set up the project")
		})

		it("should handle multiple commands in message", async () => {
			const setupContent = "# Setup Environment\n\nRun the following commands:\n```bash\nnpm install\n```"
			const deployContent = "# Deploy Environment\n\nRun the following commands:\n```bash\nnpm run deploy\n```"

			mockGetCommand
				.mockResolvedValueOnce({
					name: "setup",
					content: setupContent,
					source: "built-in",
					filePath: "<built-in:setup>",
				})
				.mockResolvedValueOnce({
					name: "deploy",
					content: deployContent,
					source: "built-in",
					filePath: "<built-in:deploy>",
				})
				.mockResolvedValueOnce({
					name: "setup",
					content: setupContent,
					source: "built-in",
					filePath: "<built-in:setup>",
				})
				.mockResolvedValueOnce({
					name: "deploy",
					content: deployContent,
					source: "built-in",
					filePath: "<built-in:deploy>",
				})

			// Both commands should be recognized
			const input = "/setup the project\nThen /deploy later"
			const result = await callParseMentions(input)

			expect(mockGetCommand).toHaveBeenCalledWith("setup")
			expect(mockGetCommand).toHaveBeenCalledWith("deploy")
			expect(mockGetCommand).toHaveBeenCalledTimes(2) // Each unique command called once (optimized)
			expect(result.slashCommandHelp).toContain('<command name="setup">')
			expect(result.slashCommandHelp).toContain("# Setup Environment")
			expect(result.slashCommandHelp).toContain('<command name="deploy">')
			expect(result.slashCommandHelp).toContain("# Deploy Environment")
		})

		it("should leave non-existent commands unchanged", async () => {
			mockGetCommand.mockReset()
			mockGetCommand.mockResolvedValue(undefined)

			const input = "/nonexistent command"
			const result = await callParseMentions(input)

			expect(mockGetCommand).toHaveBeenCalledWith("nonexistent")
			// The command should remain unchanged in the text
			expect(result.text).toBe("/nonexistent command")
			// Should not contain any command tags
			expect(result.slashCommandHelp).toBeUndefined()
			expect(result.text).not.toContain("Command 'nonexistent' not found")
		})

		it("should load skill content when command is missing and mode skill exists", async () => {
			mockGetCommand.mockResolvedValue(undefined)

			const skillsManager = {
				getSkillContent: vi.fn().mockResolvedValue({
					name: "skill-only",
					description: "Skill-generated command",
					path: "/mock/.roo/skills/skill-only/SKILL.md",
					source: "project" as const,
					instructions: "Use skill workflow",
				}),
			}

			const result = await parseMentions(
				"/skill-only run",
				"/test/cwd",
				undefined,
				undefined,
				false,
				true,
				50,
				skillsManager,
				"code",
			)

			expect(mockGetCommand).toHaveBeenCalledWith("skill-only")
			expect(skillsManager.getSkillContent).toHaveBeenCalledWith("skill-only", "code")
			expect(result.text).toContain("Skill 'skill-only' (see below for skill instructions)")
			expect(result.slashCommandHelp).toContain("Skill: skill-only")
			expect(result.slashCommandHelp).toContain("Description: Skill-generated command")
			expect(result.slashCommandHelp).toContain("Source: project")
			expect(result.slashCommandHelp).toContain("--- Skill Instructions ---")
			expect(result.slashCommandHelp).toContain("Use skill workflow")
		})

		it("expands /skill-name into exactly the text the skill tool returns", async () => {
			mockGetCommand.mockResolvedValue(undefined)

			const skill = {
				name: "release",
				description: "Cut a release",
				path: "/home/u/.roo/skills/release/SKILL.md",
				source: "global" as const,
				instructions: "1. Bump the version\n2. Tag it",
			}
			const skillsManager = { getSkillContent: vi.fn().mockResolvedValue(skill) }

			const result = await parseMentions(
				"/release please",
				"/test/cwd",
				undefined,
				undefined,
				false,
				true,
				50,
				skillsManager,
				"architect",
			)

			expect(skillsManager.getSkillContent).toHaveBeenCalledWith("release", "architect")
			expect(result.text).toBe("Skill 'release' (see below for skill instructions) please")
			expect(result.slashCommandHelp).toBe(buildSkillResult("release", undefined, skill))
		})

		it("leaves /skill-name unchanged when the skill is not available in the current mode", async () => {
			mockGetCommand.mockResolvedValue(undefined)
			// SkillsManager.getSkillContent applies the mode rules and returns null.
			const skillsManager = { getSkillContent: vi.fn().mockResolvedValue(null) }

			const result = await parseMentions(
				"/code-only now",
				"/test/cwd",
				undefined,
				undefined,
				false,
				true,
				50,
				skillsManager,
				"ask",
			)

			expect(result.text).toBe("/code-only now")
			expect(result.slashCommandHelp).toBeUndefined()
		})

		it("a built-in command wins over a skill of the same name", async () => {
			mockGetCommand.mockResolvedValue({
				name: "setup",
				content: "# Command wins",
				source: "built-in",
				filePath: "<built-in:setup>",
			})

			const skillsManager = {
				getSkillContent: vi.fn().mockResolvedValue({
					name: "setup",
					description: "Setup skill",
					path: "/mock/.roo/skills/setup/SKILL.md",
					source: "project" as const,
					instructions: "Skill should not be used",
				}),
			}

			const result = await parseMentions(
				"/setup now",
				"/test/cwd",
				undefined,
				undefined,
				false,
				true,
				50,
				skillsManager,
				"code",
			)

			expect(skillsManager.getSkillContent).not.toHaveBeenCalled()
			expect(result.slashCommandHelp).toContain('<command name="setup">')
			expect(result.slashCommandHelp).not.toContain("Skill: setup")
		})

		it("should handle command loading errors during existence check", async () => {
			mockGetCommand.mockReset()
			mockGetCommand.mockRejectedValue(new Error("Failed to load command"))

			const input = "/error-command test"
			const result = await callParseMentions(input)

			// When getCommand throws an error during existence check,
			// the command is treated as non-existent and left unchanged
			expect(result.text).toBe("/error-command test")
			expect(result.slashCommandHelp).toBeUndefined()
		})

		it("should handle command loading errors during processing", async () => {
			// With optimization, command is loaded once and cached
			mockGetCommand.mockResolvedValue({
				name: "error-command",
				content: "# Error command",
				source: "built-in",
				filePath: "<built-in:error-command>",
			})

			const input = "/error-command test"
			const result = await callParseMentions(input)

			expect(result.slashCommandHelp).toContain('<command name="error-command">')
			expect(result.slashCommandHelp).toContain("# Error command")
			expect(result.slashCommandHelp).toContain("</command>")
		})

		it("should handle command names with hyphens and underscores at start", async () => {
			mockGetCommand.mockResolvedValue({
				name: "setup-dev",
				content: "# Dev setup",
				source: "built-in",
				filePath: "<built-in:setup-dev>",
			})

			const input = "/setup-dev for the project"
			const result = await callParseMentions(input)

			expect(mockGetCommand).toHaveBeenCalledWith("setup-dev")
			expect(result.slashCommandHelp).toContain('<command name="setup-dev">')
			expect(result.slashCommandHelp).toContain("# Dev setup")
		})

		it("should preserve command content formatting", async () => {
			const commandContent = `# Complex Command

## Step 1
Run this command:
\`\`\`bash
npm install
\`\`\`

## Step 2
- Check file1.js
- Update file2.ts
- Test everything

> **Note**: This is important!`

			mockGetCommand.mockResolvedValue({
				name: "complex",
				content: commandContent,
				source: "built-in",
				filePath: "<built-in:complex>",
			})

			const input = "/complex command"
			const result = await callParseMentions(input)

			expect(result.slashCommandHelp).toContain('<command name="complex">')
			expect(result.slashCommandHelp).toContain("# Complex Command")
			expect(result.slashCommandHelp).toContain("```bash")
			expect(result.slashCommandHelp).toContain("npm install")
			expect(result.slashCommandHelp).toContain("- Check file1.js")
			expect(result.slashCommandHelp).toContain("> **Note**: This is important!")
			expect(result.slashCommandHelp).toContain("</command>")
		})

		it("should handle empty command content", async () => {
			mockGetCommand.mockResolvedValue({
				name: "empty",
				content: "",
				source: "built-in",
				filePath: "<built-in:empty>",
			})

			const input = "/empty command"
			const result = await callParseMentions(input)

			expect(result.slashCommandHelp).toContain('<command name="empty">')
			expect(result.slashCommandHelp).toContain("</command>")
			// Should still include the command tags even with empty content
		})
	})

	describe("command mention regex patterns", () => {
		it("should match valid command mention patterns anywhere", () => {
			const commandRegex = /\/([a-zA-Z0-9_.-]+)(?=\s|$)/g

			const validPatterns = ["/setup", "/build-prod", "/test_suite", "/my-command", "/command123"]

			validPatterns.forEach((pattern) => {
				const match = pattern.match(commandRegex)
				expect(match).toBeTruthy()
				expect(match![0]).toBe(pattern)
			})
		})

		it("should match command patterns in middle of text", () => {
			const commandRegex = /\/([a-zA-Z0-9_.-]+)(?=\s|$)/g

			const validPatterns = ["Please /setup", "Run /build now", "Use /deploy here"]

			validPatterns.forEach((pattern) => {
				const match = pattern.match(commandRegex)
				expect(match).toBeTruthy()
				expect(match![0]).toMatch(/^\/[a-zA-Z0-9_.-]+$/)
			})
		})

		it("should match commands at start of new lines", () => {
			const commandRegex = /\/([a-zA-Z0-9_.-]+)(?=\s|$)/g

			const multilineText = "First line\n/setup the project\nAnother line\n/deploy when ready"
			const matches = multilineText.match(commandRegex)

			// Should match both commands now
			expect(matches).toBeTruthy()
			expect(matches).toHaveLength(2)
			expect(matches![0]).toBe("/setup")
			expect(matches![1]).toBe("/deploy")
		})

		it("should match multiple commands in message", () => {
			const commandRegex = /(?:^|\s)\/([a-zA-Z0-9_.-]+)(?=\s|$)/g

			const validText = "/setup the project\nThen /deploy later"
			const matches = validText.match(commandRegex)

			expect(matches).toBeTruthy()
			expect(matches).toHaveLength(2)
			expect(matches![0]).toBe("/setup")
			expect(matches![1]).toBe(" /deploy") // Note: includes leading space
		})

		it("should not match invalid command patterns", () => {
			const commandRegex = /\/([a-zA-Z0-9_.-]+)(?=\s|$)/g

			const invalidPatterns = ["/ space", "/with space", "/with/slash", "//double", "/with@symbol"]

			invalidPatterns.forEach((pattern) => {
				const match = pattern.match(commandRegex)
				if (match) {
					// If it matches, it should not be the full invalid pattern
					expect(match[0]).not.toBe(pattern)
				}
			})
		})
	})

	describe("command mention text transformation", () => {
		it("should transform existing command mentions at start of message", async () => {
			mockGetCommand.mockResolvedValue({
				name: "setup",
				content: "# Setup instructions",
				source: "built-in",
				filePath: "<built-in:setup>",
			})

			const input = "/setup the project"
			const result = await callParseMentions(input)

			expect(result.text).toContain("Command 'setup' (see below for command content)")
		})

		it("should leave non-existent command mentions unchanged", async () => {
			mockGetCommand.mockResolvedValue(undefined)

			const input = "/nonexistent the project"
			const result = await callParseMentions(input)

			expect(result.text).toBe("/nonexistent the project")
		})

		it("should process multiple commands in message", async () => {
			mockGetCommand
				.mockResolvedValueOnce({
					name: "setup",
					content: "# Setup instructions",
					source: "built-in",
					filePath: "<built-in:setup>",
				})
				.mockResolvedValueOnce({
					name: "deploy",
					content: "# Deploy instructions",
					source: "built-in",
					filePath: "<built-in:deploy>",
				})

			const input = "/setup the project\nThen /deploy later"
			const result = await callParseMentions(input)

			expect(result.text).toContain("Command 'setup' (see below for command content)")
			expect(result.text).toContain("Command 'deploy' (see below for command content)")
		})

		it("should match commands anywhere with proper word boundaries", async () => {
			mockGetCommand.mockResolvedValue({
				name: "build",
				content: "# Build instructions",
				source: "built-in",
				filePath: "<built-in:build>",
			})

			// At the beginning - should match
			let input = "/build the project"
			let result = await callParseMentions(input)
			expect(result.text).toContain("Command 'build'")

			// After space - should match
			input = "Please /build and test"
			result = await callParseMentions(input)
			expect(result.text).toContain("Command 'build'")

			// At the end - should match
			input = "Run the /build"
			result = await callParseMentions(input)
			expect(result.text).toContain("Command 'build'")

			// At start of new line - should match
			input = "Some text\n/build the project"
			result = await callParseMentions(input)
			expect(result.text).toContain("Command 'build'")
		})
	})
})
