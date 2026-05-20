import type { SkillContent } from "../../shared/skills"

export interface SkillLookup {
	getSkillContent(name: string, currentMode?: string): Promise<SkillContent | null>
}

export async function resolveSkillContentForMode(
	skillsManager: SkillLookup | undefined,
	skillName: string,
	currentMode: string,
): Promise<SkillContent | null> {
	if (!skillsManager) {
		return null
	}

	return skillsManager.getSkillContent(skillName, currentMode)
}

type SkillContentForFormatting = Pick<SkillContent, "source" | "description" | "instructions">

export function buildSkillApprovalMessage(
	skillName: string,
	args: string | undefined,
	skillContent: Pick<SkillContent, "source" | "description">,
	toolCallId?: string,
): string {
	return JSON.stringify({
		tool: "skill",
		skill: skillName,
		args,
		source: skillContent.source,
		description: skillContent.description,
		// Stamp the native tool-call id so the finalized-duplicate dedup links
		// this complete card to its streaming placeholder.
		toolCallId,
	})
}

export function buildSkillResult(
	skillName: string,
	args: string | undefined,
	skillContent: SkillContentForFormatting,
): string {
	let result = `Skill: ${skillName}`

	if (skillContent.description) {
		result += `\nDescription: ${skillContent.description}`
	}

	if (args) {
		result += `\nProvided arguments: ${args}`
	}

	result += `\nSource: ${skillContent.source}`
	result += `\n\n--- Skill Instructions ---\n\n${skillContent.instructions}`

	return result
}
