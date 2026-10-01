import * as path from "path"
import * as fs from "fs/promises"

import * as yaml from "yaml"

import { type ModeConfig, type PromptComponent, modeConfigSchema } from "@roo-code/types"

import { fileExistsAtPath } from "../../utils/fs"
import { getWorkspacePath } from "../../utils/path"
import { logger } from "../../utils/logging"
import { modeRulesDir, ROOMODES_FILENAME } from "./modeRulesDir"

// Type definitions for import/export functionality
interface RuleFile {
	relativePath: string
	content: string
}

interface ExportedModeConfig extends ModeConfig {
	rulesFiles?: RuleFile[]
}

interface ImportData {
	customModes: ExportedModeConfig[]
}

export interface ExportResult {
	success: boolean
	yaml?: string
	error?: string
}

export interface ImportResult {
	success: boolean
	slug?: string
	error?: string
}

/** What exporting and importing a mode need from the CustomModesManager. */
export interface ModeExportHost {
	getCustomModes(): Promise<ModeConfig[]>
	updateCustomMode(slug: string, config: ModeConfig): Promise<void>
	refreshMergedState(): Promise<void>
}

/**
 * Exports a mode configuration with its associated rules files into a shareable YAML format
 * @param slug - The mode identifier to export
 * @param customPrompts - Optional custom prompts to merge into the export
 * @returns Success status with YAML content or error message
 */
export async function exportModeWithRules(
	host: ModeExportHost,
	slug: string,
	customPrompts?: PromptComponent,
): Promise<ExportResult> {
	try {
		// Import modes from shared to check built-in modes
		const { modes: builtInModes } = await import("../../shared/modes")

		// Get all current modes
		const allModes = await host.getCustomModes()
		let mode = allModes.find((m) => m.slug === slug)

		// If mode not found in custom modes, check if it's a built-in mode that has been customized
		if (!mode) {
			// Only check workspace-based modes if workspace is available
			const workspacePath = getWorkspacePath()
			if (workspacePath) {
				const roomodesPath = path.join(workspacePath, ROOMODES_FILENAME)
				try {
					const roomodesExists = await fileExistsAtPath(roomodesPath)
					if (roomodesExists) {
						const roomodesContent = await fs.readFile(roomodesPath, "utf-8")
						const roomodesData = yaml.parse(roomodesContent)
						const roomodesModes = roomodesData?.customModes || []

						// Find the mode in .roomodes
						mode = roomodesModes.find((m: any) => m.slug === slug)
					}
				} catch (error) {
					// Continue to check built-in modes
				}
			}

			// If still not found, check if it's a built-in mode
			if (!mode) {
				const builtInMode = builtInModes.find((m) => m.slug === slug)
				if (builtInMode) {
					// Use the built-in mode as the base
					mode = { ...builtInMode }
				} else {
					return { success: false, error: "Mode not found" }
				}
			}
		}

		// Global modes keep their rules under ~/.roo, everything else under the workspace .roo
		const rulesDir = await modeRulesDir(slug, mode.source === "global" ? "global" : "project")
		if (!rulesDir) {
			return { success: false, error: "No workspace found" }
		}

		const rulesFiles: RuleFile[] = []
		try {
			const stats = await fs.stat(rulesDir)
			if (stats.isDirectory()) {
				// Extract content specific to this mode by looking for the mode-specific rules
				const entries = await fs.readdir(rulesDir, { withFileTypes: true })

				for (const entry of entries) {
					if (entry.isFile()) {
						// Use path.join with rulesDir and entry.name for compatibility
						const filePath = path.join(rulesDir, entry.name)
						const content = await fs.readFile(filePath, "utf-8")
						if (content.trim()) {
							// Calculate relative path from within the rules directory
							// This excludes the rules-{slug} folder from the path
							const relativePath = path.relative(rulesDir, filePath)
							// Normalize path to use forward slashes for cross-platform compatibility
							const normalizedRelativePath = relativePath.replace(/\\/g, "/")
							rulesFiles.push({ relativePath: normalizedRelativePath, content: content.trim() })
						}
					}
				}
			}
		} catch (error) {
			// Directory doesn't exist, which is fine - mode might not have rules
		}

		// Create an export mode with rules files preserved
		const exportMode: ExportedModeConfig = {
			...mode,
			// Remove source property for export
			source: "project" as const,
		}

		// Merge custom prompts if provided
		if (customPrompts) {
			if (customPrompts.roleDefinition) exportMode.roleDefinition = customPrompts.roleDefinition
			if (customPrompts.description) exportMode.description = customPrompts.description
			if (customPrompts.whenToUse) exportMode.whenToUse = customPrompts.whenToUse
			if (customPrompts.customInstructions) exportMode.customInstructions = customPrompts.customInstructions
		}

		// Add rules files if any exist
		if (rulesFiles.length > 0) {
			exportMode.rulesFiles = rulesFiles
		}

		// Generate YAML
		const exportData = {
			customModes: [exportMode],
		}

		const yamlContent = yaml.stringify(exportData)

		return { success: true, yaml: yamlContent }
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error)
		logger.error("Failed to export mode with rules", { slug, error: errorMessage })
		return { success: false, error: errorMessage }
	}
}

/**
 * Helper method to import rules files for a mode
 * @param importMode - The mode being imported
 * @param rulesFiles - The rules files to import
 * @param source - The import source ("global" or "project")
 */
async function importRulesFiles(
	importMode: ExportedModeConfig,
	rulesFiles: RuleFile[],
	source: "global" | "project",
): Promise<void> {
	// importModeWithRules refuses a project import without a workspace before it gets here.
	const rulesFolderPath = await modeRulesDir(importMode.slug, source)
	if (!rulesFolderPath) {
		return
	}

	// Always remove the existing rules folder for this mode if it exists
	// This ensures that if the imported mode has no rules, the folder is cleaned up
	try {
		await fs.rm(rulesFolderPath, { recursive: true, force: true })
		logger.info(`Removed existing ${source} rules folder for mode ${importMode.slug}`)
	} catch (error) {
		// It's okay if the folder doesn't exist
		logger.debug(`No existing ${source} rules folder to remove for mode ${importMode.slug}`)
	}

	// Only proceed with file creation if there are rules files to import
	if (!rulesFiles || !Array.isArray(rulesFiles) || rulesFiles.length === 0) {
		return
	}

	// Import the new rules files with path validation
	for (const ruleFile of rulesFiles) {
		if (ruleFile.relativePath && ruleFile.content) {
			// Validate the relative path to prevent path traversal attacks
			const normalizedRelativePath = path.normalize(ruleFile.relativePath)

			// Ensure the path doesn't contain traversal sequences
			if (normalizedRelativePath.includes("..") || path.isAbsolute(normalizedRelativePath)) {
				logger.error(`Invalid file path detected: ${ruleFile.relativePath}`)
				continue // Skip this file but continue with others
			}

			// Check if path starts with a rules-* folder (old export format)
			let cleanedRelativePath = normalizedRelativePath
			const rulesMatch = normalizedRelativePath.match(/^rules-[^/\\]+[/\\]/)
			if (rulesMatch) {
				// Strip the entire rules-* folder reference for backwards compatibility
				cleanedRelativePath = normalizedRelativePath.substring(rulesMatch[0].length)
				logger.info(`Detected old export format, stripping ${rulesMatch[0]} from path`)
			}

			// Use the rules folder path instead of base directory
			const targetPath = path.join(rulesFolderPath, cleanedRelativePath)
			const normalizedTargetPath = path.normalize(targetPath)
			const expectedBasePath = path.normalize(rulesFolderPath)

			// Ensure the resolved path stays within the rules folder
			if (!normalizedTargetPath.startsWith(expectedBasePath)) {
				logger.error(`Path traversal attempt detected: ${ruleFile.relativePath}`)
				continue // Skip this file but continue with others
			}

			// Ensure directory exists
			const targetDir = path.dirname(targetPath)
			await fs.mkdir(targetDir, { recursive: true })

			// Write the file
			await fs.writeFile(targetPath, ruleFile.content, "utf-8")
		}
	}
}

/**
 * Imports modes from YAML content, including their associated rules files
 * @param yamlContent - The YAML content containing mode configurations
 * @param source - Target level for import: "global" (all projects) or "project" (current workspace only)
 * @returns Success status with optional error message
 */
export async function importModeWithRules(
	host: ModeExportHost,
	yamlContent: string,
	source: "global" | "project" = "project",
): Promise<ImportResult> {
	try {
		// Parse the YAML content with proper type validation
		let importData: ImportData
		try {
			const parsed = yaml.parse(yamlContent)

			// Validate the structure
			if (!parsed?.customModes || !Array.isArray(parsed.customModes) || parsed.customModes.length === 0) {
				return { success: false, error: "Invalid import format: Expected 'customModes' array in YAML" }
			}

			importData = parsed as ImportData
		} catch (parseError) {
			return {
				success: false,
				error: `Invalid YAML format: ${parseError instanceof Error ? parseError.message : "Failed to parse YAML"}`,
			}
		}

		// Check workspace availability early if importing at project level
		if (source === "project") {
			const workspacePath = getWorkspacePath()
			if (!workspacePath) {
				return { success: false, error: "No workspace found" }
			}
		}

		// Process each mode in the import
		for (const importMode of importData.customModes) {
			const { rulesFiles, ...modeConfig } = importMode

			// Validate the mode configuration
			const validationResult = modeConfigSchema.safeParse(modeConfig)
			if (!validationResult.success) {
				logger.error(`Invalid mode configuration for ${modeConfig.slug}`, {
					errors: validationResult.error.issues,
				})
				return {
					success: false,
					error: `Invalid mode configuration for ${modeConfig.slug}: ${validationResult.error.issues.map((e) => e.message).join(", ")}`,
				}
			}

			// Check for existing mode conflicts
			const existingModes = await host.getCustomModes()
			const existingMode = existingModes.find((m) => m.slug === importMode.slug)
			if (existingMode) {
				logger.info(`Overwriting existing mode: ${importMode.slug}`)
			}

			// Import the mode configuration with the specified source
			await host.updateCustomMode(importMode.slug, {
				...modeConfig,
				source: source, // Use the provided source parameter
			})

			// Import rules files (this also handles cleanup of existing rules folders)
			await importRulesFiles(importMode, rulesFiles || [], source)
		}

		// Refresh the modes after import
		await host.refreshMergedState()

		// Return the imported mode's slug so the UI can activate it
		return { success: true, slug: importData.customModes[0]?.slug }
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error)
		logger.error("Failed to import mode with rules", { error: errorMessage })
		return { success: false, error: errorMessage }
	}
}
