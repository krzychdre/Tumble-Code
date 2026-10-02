import { useState, useEffect, useRef } from "react"

import type { ModeConfig, PromptComponent, ExtensionMessage } from "@tumble-code/types"

import { Mode, getAllModes, findModeBySlug, defaultModeSlug } from "@shared/modes"

import { vscode } from "@src/utils/vscode"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { useExtensionState } from "@src/context/ExtensionStateContext"
import { Section } from "@src/components/settings/Section"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@src/components/ui"
import { DeleteModeDialog } from "@src/components/modes/DeleteModeDialog"

import { CreateModeDialog } from "./CreateModeDialog"
import { ImportModeDialog } from "./ImportModeDialog"
import { GlobalCustomInstructionsSection } from "./GlobalCustomInstructionsSection"
import { ModeCustomInstructionsSection } from "./ModeCustomInstructionsSection"
import { ModePromptFields } from "./ModePromptFields"
import { ModeSelectorRow } from "./ModeSelectorRow"
import { ModesViewHeader } from "./ModesViewHeader"
import { ModeToolsSection } from "./ModeToolsSection"
import { SystemPromptActions, SystemPromptDialog } from "./SystemPromptSection"
import { postAgentPrompt, postAgentReset, postCustomMode, type ResettablePromptField } from "./modePromptUpdates"
import { useModeImportExport } from "./useModeImportExport"
import { onExtensionMessage } from "@src/utils/extensionBus"

type ModesViewProps = {
	/**
	 * Loads another API profile. ModesView lives inside SettingsView, whose Save buffer is
	 * replaced when the profile changes, so the owner decides whether unsaved edits allow it.
	 */
	onSelectApiConfiguration: (configName: string) => void
}

const ModesView = ({ onSelectApiConfiguration }: ModesViewProps) => {
	const { t } = useAppTranslation()

	const {
		customModePrompts,
		listApiConfigMeta,
		currentApiConfigName,
		mode,
		customInstructions,
		setCustomInstructions,
		customModes,
		mcpServers,
	} = useExtensionState()

	// Use a local state to track the visually active mode
	// This prevents flickering when switching modes rapidly by:
	// 1. Updating the UI immediately when a mode is clicked
	// 2. Not syncing with the backend mode state (which would cause flickering)
	// 3. Still sending the mode change to the backend for persistence
	const [visualMode, setVisualMode] = useState(mode)

	// Build modes fresh each render so search reflects inline rename updates immediately
	const modes = getAllModes(customModes)

	const [isDialogOpen, setIsDialogOpen] = useState(false)
	const [selectedPromptContent, setSelectedPromptContent] = useState("")
	const [selectedPromptTitle, setSelectedPromptTitle] = useState("")
	const [isToolsEditMode, setIsToolsEditMode] = useState(false)
	const [isCreateModeDialogOpen, setIsCreateModeDialogOpen] = useState(false)
	const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
	const [modeToDelete, setModeToDelete] = useState<{
		slug: string
		name: string
		source?: string
		rulesFolderPath?: string
	} | null>(null)

	// The selected mode's config if it is a custom mode (editable), and the selected mode itself.
	const customMode = findModeBySlug(visualMode, customModes)
	const findMode = (m: ModeConfig): boolean => m.slug === visualMode
	const currentMode: ModeConfig | undefined = customModes?.find(findMode) || modes.find(findMode)

	const updateAgentPrompt = (promptData: PromptComponent) =>
		postAgentPrompt(customModePrompts, visualMode as Mode, promptData)

	const updateCustomMode = (modeConfig: ModeConfig) => postCustomMode(visualMode, modeConfig)

	const resetAgentPrompt = (field: ResettablePromptField) => {
		if (currentMode?.slug) {
			postAgentReset(customModePrompts, currentMode.slug, field)
		}
	}

	const switchMode = (slug: string) => {
		vscode.postMessage({
			type: "mode",
			text: slug,
		})
	}

	// Handle mode switching with explicit state initialization
	const handleModeSwitch = (modeConfig: ModeConfig) => {
		if (modeConfig.slug === visualMode) return // Prevent unnecessary updates

		// Immediately update visual state for instant feedback
		setVisualMode(modeConfig.slug)

		// Then send the mode change message to the backend
		switchMode(modeConfig.slug)

		// Exit tools edit mode when switching modes
		setIsToolsEditMode(false)
	}

	// Sync visualMode with backend mode changes to prevent desync
	useEffect(() => {
		setVisualMode(mode)
	}, [mode])

	const importExport = useModeImportExport({
		currentSlug: currentMode?.slug,
		onImported: (slug) => {
			const importedMode = modes.find((m) => m.slug === slug)
			if (importedMode) {
				handleModeSwitch(importedMode)
			} else {
				// Slug not yet in state (race condition): select the default mode
				setVisualMode(defaultModeSlug)
				switchMode(defaultModeSlug)
			}
		},
	})

	const handleCreateMode = (newMode: ModeConfig) => {
		postCustomMode(newMode.slug, newMode)
		// Immediately select the newly created mode in the UI
		setVisualMode(newMode.slug)
		switchMode(newMode.slug)
		setIsCreateModeDialogOpen(false)
	}

	// The message listener below is registered once; it reads modeToDelete through this ref.
	const modeToDeleteRef = useRef(modeToDelete)
	useEffect(() => {
		modeToDeleteRef.current = modeToDelete
	}, [modeToDelete])

	useEffect(() => {
		const handler = (message: ExtensionMessage) => {
			if (message.type === "systemPrompt") {
				if (message.text) {
					setSelectedPromptContent(message.text)
					setSelectedPromptTitle(`System Prompt (${message.mode} mode)`)
					setIsDialogOpen(true)
				}
			} else if (message.type === "deleteCustomModeCheck") {
				const currentModeToDelete = modeToDeleteRef.current
				if (message.slug && currentModeToDelete && currentModeToDelete.slug === message.slug) {
					setModeToDelete({
						...currentModeToDelete,
						rulesFolderPath: message.rulesFolderPath,
					})
					setShowDeleteConfirm(true)
				}
			}
		}

		return onExtensionMessage(["systemPrompt", "deleteCustomModeCheck"], handler)
	}, [])

	return (
		<div>
			<ModesViewHeader onImport={importExport.openImportDialog} isImporting={importExport.isImporting} />

			<Section>
				<div>
					<ModeSelectorRow
						modes={modes}
						visualMode={visualMode}
						customMode={customMode}
						currentModeName={currentMode?.name}
						onSelectMode={handleModeSwitch}
						onRename={(renamed, name) =>
							updateCustomMode({
								...renamed,
								name,
								source: renamed.source || "global",
							})
						}
						onCreate={() => setIsCreateModeDialogOpen(true)}
						onDelete={(toDelete) => {
							setModeToDelete({
								slug: toDelete.slug,
								name: toDelete.name,
								source: toDelete.source || "global",
							})
							vscode.postMessage({
								type: "deleteCustomMode",
								slug: toDelete.slug,
								checkOnly: true,
							})
						}}
						onExport={() => {
							if (currentMode?.slug) {
								importExport.exportMode(currentMode.slug)
							}
						}}
						isExporting={importExport.isExporting}
					/>

					{/* API Configuration - Moved Here */}
					<div className="mb-block">
						<div className="font-bold mb-1">{t("prompts:apiConfiguration.title")}</div>
						<div className="text-sm text-vscode-descriptionForeground mb-row">
							{t("prompts:apiConfiguration.select")}
						</div>
						<div className="mb-row">
							<Select value={currentApiConfigName} onValueChange={onSelectApiConfiguration}>
								<SelectTrigger className="w-full">
									<SelectValue placeholder={t("settings:common.select")} />
								</SelectTrigger>
								<SelectContent>
									{(listApiConfigMeta || []).map((config) => (
										<SelectItem key={config.id} value={config.name}>
											{config.name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
					</div>
				</div>

				<ModePromptFields
					visualMode={visualMode}
					customMode={customMode}
					currentModeSlug={currentMode?.slug}
					customModePrompts={customModePrompts}
					onUpdateCustomMode={updateCustomMode}
					onUpdateAgentPrompt={updateAgentPrompt}
					onReset={resetAgentPrompt}
				/>

				<ModeToolsSection
					visualMode={visualMode}
					currentMode={currentMode}
					customMode={customMode}
					customModePrompts={customModePrompts}
					mcpServers={mcpServers}
					isToolsEditMode={isToolsEditMode}
					onToggleToolsEditMode={() => setIsToolsEditMode(!isToolsEditMode)}
					onUpdateCustomMode={postCustomMode}
					onUpdateAgentPrompt={updateAgentPrompt}
				/>

				<ModeCustomInstructionsSection
					visualMode={visualMode}
					currentMode={currentMode}
					customMode={customMode}
					customModes={customModes}
					customModePrompts={customModePrompts}
					onUpdateCustomMode={updateCustomMode}
					onUpdateAgentPrompt={updateAgentPrompt}
					onReset={() => resetAgentPrompt("customInstructions")}
				/>

				<SystemPromptActions currentModeSlug={currentMode?.slug} />

				<GlobalCustomInstructionsSection
					customInstructions={customInstructions}
					setCustomInstructions={setCustomInstructions}
				/>
			</Section>

			{isCreateModeDialogOpen && (
				<CreateModeDialog
					modes={modes}
					mcpServers={mcpServers}
					onCreate={handleCreateMode}
					onClose={() => setIsCreateModeDialogOpen(false)}
				/>
			)}

			{isDialogOpen && (
				<SystemPromptDialog
					title={selectedPromptTitle}
					currentModeName={currentMode?.name}
					content={selectedPromptContent}
					onClose={() => setIsDialogOpen(false)}
				/>
			)}

			{importExport.isImportDialogOpen && (
				<ImportModeDialog
					importLevel={importExport.importLevel}
					onImportLevelChange={importExport.setImportLevel}
					isImporting={importExport.isImporting}
					onImport={importExport.startImport}
					onCancel={importExport.closeImportDialog}
				/>
			)}

			{/* Delete Mode Confirmation Dialog */}
			<DeleteModeDialog
				open={showDeleteConfirm}
				onOpenChange={setShowDeleteConfirm}
				modeToDelete={modeToDelete}
				onConfirm={() => {
					if (modeToDelete) {
						vscode.postMessage({
							type: "deleteCustomMode",
							slug: modeToDelete.slug,
						})
						setShowDeleteConfirm(false)
						setModeToDelete(null)
					}
				}}
			/>
		</div>
	)
}

export default ModesView
