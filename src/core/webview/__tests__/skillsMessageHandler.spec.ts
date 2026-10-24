// npx vitest run src/core/webview/__tests__/skillsMessageHandler.spec.ts

import type { SkillMetadata, WebviewMessage } from "@tumble-code/types"
import type { ClineProvider } from "../ClineProvider"

// Mock vscode first
vi.mock("vscode", () => {
	const showErrorMessage = vi.fn()

	return {
		window: {
			showErrorMessage,
		},
	}
})

// Mock open-file
vi.mock("../../../integrations/misc/open-file", () => ({
	openFile: vi.fn(),
}))

// Mock i18n
vi.mock("../../../i18n", () => ({
	t: (key: string, params?: Record<string, any>) => {
		const translations: Record<string, string> = {
			"skills:errors.missing_create_fields": "Missing required fields: skillName, source, or skillDescription",
			"skills:errors.manager_unavailable": "Skills manager not available",
			"skills:errors.missing_delete_fields": "Missing required fields: skillName or source",
			"skills:errors.missing_move_fields": "Missing required fields: skillName or source",
			"skills:errors.skill_not_found": `Skill "${params?.name}" not found`,
		}
		return translations[key] || key
	},
}))

import * as vscode from "vscode"
import { openFile } from "../../../integrations/misc/open-file"
import { handleRequestSkills, handleCreateSkill, handleDeleteSkill, handleOpenSkillFile } from "../skillsMessageHandler"
import { logger } from "../../../utils/logging"

describe("skillsMessageHandler", () => {
	const loggerErrorSpy = vi.spyOn(logger, "error").mockImplementation(() => {})
	const mockPostMessageToWebview = vi.fn()
	const mockGetSkillsMetadata = vi.fn()
	const mockCreateSkill = vi.fn()
	const mockDeleteSkill = vi.fn()
	const mockGetSkill = vi.fn()
	const mockFindSkillByNameAndSource = vi.fn()

	const createMockProvider = (hasSkillsManager: boolean = true): ClineProvider => {
		const skillsManager = hasSkillsManager
			? {
					whenReady: vi.fn().mockResolvedValue(undefined),
					getSkillsMetadata: mockGetSkillsMetadata,
					createSkill: mockCreateSkill,
					deleteSkill: mockDeleteSkill,
					getSkill: mockGetSkill,
					findSkillByNameAndSource: mockFindSkillByNameAndSource,
				}
			: undefined

		return {
			postMessageToWebview: mockPostMessageToWebview,
			getSkillsManager: () => skillsManager,
		} as unknown as ClineProvider
	}

	const mockSkills: SkillMetadata[] = [
		{
			name: "test-skill",
			description: "Test skill description",
			path: "/path/to/test-skill/SKILL.md",
			source: "global",
		},
		{
			name: "project-skill",
			description: "Project skill description",
			path: "/project/.roo/skills/project-skill/SKILL.md",
			source: "project",
		},
	]

	beforeEach(() => {
		vi.clearAllMocks()
	})

	describe("handleRequestSkills", () => {
		it("returns skills when skills manager is available", async () => {
			const provider = createMockProvider(true)
			mockGetSkillsMetadata.mockReturnValue(mockSkills)

			const result = await handleRequestSkills(provider)

			expect(result).toEqual(mockSkills)
			expect(mockPostMessageToWebview).toHaveBeenCalledWith({ type: "skills", skills: mockSkills })
		})

		it("returns empty skills when skills manager is not available", async () => {
			const provider = createMockProvider(false)

			const result = await handleRequestSkills(provider)

			expect(result).toEqual([])
			expect(mockPostMessageToWebview).toHaveBeenCalledWith({ type: "skills", skills: [] })
		})

		it("handles errors and returns empty skills", async () => {
			const provider = createMockProvider(true)
			mockGetSkillsMetadata.mockImplementation(() => {
				throw new Error("Test error")
			})

			const result = await handleRequestSkills(provider)

			expect(result).toEqual([])
			expect(loggerErrorSpy).toHaveBeenCalled()
			expect(mockPostMessageToWebview).toHaveBeenCalledWith({ type: "skills", skills: [] })
		})
	})

	describe("handleCreateSkill", () => {
		it.each([
			["for every mode", {}, undefined],
			["for one mode", { skillMode: "code" }, ["code"]],
		])("creates a skill %s, opens it and posts the list", async (_name, extra, modes) => {
			mockCreateSkill.mockResolvedValue("/path/to/new-skill/SKILL.md")
			mockGetSkillsMetadata.mockReturnValue(mockSkills)

			const result = await handleCreateSkill(createMockProvider(true), {
				type: "createSkill",
				skillName: "new-skill",
				source: "global",
				skillDescription: "New skill description",
				...extra,
			} as WebviewMessage)

			expect(result).toEqual(mockSkills)
			expect(mockCreateSkill).toHaveBeenCalledWith("new-skill", "global", "New skill description", modes)
			expect(openFile).toHaveBeenCalledWith("/path/to/new-skill/SKILL.md")
			expect(mockPostMessageToWebview).toHaveBeenCalledWith({ type: "skills", skills: mockSkills })
		})

		it.each([
			[
				"required fields are missing",
				true,
				{ skillName: "new-skill" },
				"Missing required fields: skillName, source, or skillDescription",
			],
			[
				"the skills manager is not available",
				false,
				{ skillName: "new-skill", source: "global", skillDescription: "d" },
				"Skills manager not available",
			],
		])("reports a failure when %s", async (_name, hasManager, fields, reason) => {
			const result = await handleCreateSkill(createMockProvider(hasManager), {
				type: "createSkill",
				...fields,
			} as WebviewMessage)

			expect(result).toBeUndefined()
			expect(loggerErrorSpy).toHaveBeenCalledWith(`Error creating skill: ${reason}`)
			expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(`Failed to create skill: ${reason}`)
		})
	})

	describe("handleDeleteSkill", () => {
		it.each([
			["for every mode", {}, undefined],
			["for one mode", { skillMode: "code" }, "code"],
		])("deletes a skill %s and posts the list", async (_name, extra, mode) => {
			mockGetSkillsMetadata.mockReturnValue([mockSkills[1]])

			const result = await handleDeleteSkill(createMockProvider(true), {
				type: "deleteSkill",
				skillName: "test-skill",
				source: "global",
				...extra,
			} as WebviewMessage)

			expect(result).toEqual([mockSkills[1]])
			expect(mockDeleteSkill).toHaveBeenCalledWith("test-skill", "global", mode)
			expect(mockPostMessageToWebview).toHaveBeenCalledWith({ type: "skills", skills: [mockSkills[1]] })
		})

		it.each([
			[
				"required fields are missing",
				true,
				{ skillName: "test-skill" },
				"Missing required fields: skillName or source",
			],
			[
				"the skills manager is not available",
				false,
				{ skillName: "test-skill", source: "global" },
				"Skills manager not available",
			],
		])("reports a failure when %s", async (_name, hasManager, fields, reason) => {
			const result = await handleDeleteSkill(createMockProvider(hasManager), {
				type: "deleteSkill",
				...fields,
			} as WebviewMessage)

			expect(result).toBeUndefined()
			expect(loggerErrorSpy).toHaveBeenCalledWith(`Error deleting skill: ${reason}`)
			expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(`Failed to delete skill: ${reason}`)
		})
	})

	describe("handleOpenSkillFile", () => {
		it("opens the file of the skill found by name and source", async () => {
			mockFindSkillByNameAndSource.mockReturnValue(mockSkills[0])

			await handleOpenSkillFile(createMockProvider(true), {
				type: "openSkillFile",
				skillName: "test-skill",
				source: "global",
			} as WebviewMessage)

			expect(mockFindSkillByNameAndSource).toHaveBeenCalledWith("test-skill", "global")
			expect(openFile).toHaveBeenCalledWith("/path/to/test-skill/SKILL.md")
		})

		it.each([
			[
				"required fields are missing",
				true,
				{ skillName: "test-skill" },
				"Missing required fields: skillName or source",
			],
			[
				"the skills manager is not available",
				false,
				{ skillName: "test-skill", source: "global" },
				"Skills manager not available",
			],
			[
				"the skill is not found",
				true,
				{ skillName: "nonexistent-skill", source: "global" },
				'Skill "nonexistent-skill" not found',
			],
		])("reports a failure when %s", async (_name, hasManager, fields, reason) => {
			mockFindSkillByNameAndSource.mockReturnValue(undefined)

			await handleOpenSkillFile(createMockProvider(hasManager), {
				type: "openSkillFile",
				...fields,
			} as WebviewMessage)

			expect(openFile).not.toHaveBeenCalled()
			expect(loggerErrorSpy).toHaveBeenCalledWith(`Error opening skill file: ${reason}`)
			expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(`Failed to open skill file: ${reason}`)
		})
	})
})
