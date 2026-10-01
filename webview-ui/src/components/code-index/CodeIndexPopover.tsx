import React, { useState, useEffect, useCallback, useRef } from "react"

import type { IndexingStatus, ExtensionMessage } from "@roo-code/types"

import { vscode } from "@src/utils/vscode"
import { useExtensionState } from "@src/context/ExtensionStateContext"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { Popover, PopoverContent, StandardTooltip, LabeledCheckbox } from "@src/components/ui"
import { useRooPortal } from "@src/components/ui/hooks/useRooPortal"
import { useEscapeKey } from "@src/hooks/useEscapeKey"
import { useOpenRouterModelProviders } from "@src/hooks/models/useOpenRouterModelProviders"
import { DiscardChangesDialog } from "@src/components/common/DiscardChangesDialog"
import { onExtensionMessage } from "@src/utils/extensionBus"

import { CodeIndexActions } from "./CodeIndexActions"
import { CodeIndexAdvancedFields } from "./CodeIndexAdvancedFields"
import { CodeIndexDisclosure } from "./CodeIndexDisclosure"
import { CodeIndexSetupFields } from "./CodeIndexSetupFields"
import { CodeIndexStatusSection } from "./CodeIndexStatusSection"
import { CodeIndexWorkspaceToggles } from "./CodeIndexWorkspaceToggles"
import { useCodeIndexSettings } from "./useCodeIndexSettings"
import { useIndexingStatus } from "./useIndexingStatus"

interface CodeIndexPopoverProps {
	children: React.ReactNode
	indexingStatus: IndexingStatus
}

export const CodeIndexPopover: React.FC<CodeIndexPopoverProps> = ({
	children,
	indexingStatus: externalIndexingStatus,
}) => {
	const { t } = useAppTranslation()
	const { codebaseIndexConfig, codebaseIndexModels, cwd, apiConfiguration } = useExtensionState()
	const [open, setOpen] = useState(false)
	// The disclosure flags live here, not in the groups: the popover content unmounts on close.
	const [isAdvancedSettingsOpen, setIsAdvancedSettingsOpen] = useState(false)
	const [isSetupSettingsOpen, setIsSetupSettingsOpen] = useState(false)

	const indexingStatus = useIndexingStatus(externalIndexingStatus, cwd)

	const {
		currentSettings,
		formErrors,
		saveStatus,
		saveError,
		hasUnsavedChanges,
		updateSetting,
		handleSaveSettings,
		discardChanges,
	} = useCodeIndexSettings(codebaseIndexConfig, t)

	// Discard changes dialog state
	const [isDiscardDialogShow, setDiscardDialogShow] = useState(false)
	const confirmDialogHandler = useRef<(() => void) | null>(null)

	// Request initial indexing status
	useEffect(() => {
		if (open) {
			vscode.postMessage({ type: "requestIndexingStatus" })
			vscode.postMessage({ type: "requestCodeIndexSecretStatus" })
		}
		const handleMessage = (message: ExtensionMessage) => {
			if (message.type === "workspaceUpdated") {
				// When workspace changes, request updated indexing status
				if (open) {
					vscode.postMessage({ type: "requestIndexingStatus" })
					vscode.postMessage({ type: "requestCodeIndexSecretStatus" })
				}
			}
		}

		return onExtensionMessage("workspaceUpdated", handleMessage)
	}, [open])

	// Discard changes functionality
	const checkUnsavedChanges = useCallback(
		(then: () => void) => {
			if (hasUnsavedChanges) {
				confirmDialogHandler.current = then
				setDiscardDialogShow(true)
			} else {
				then()
			}
		},
		[hasUnsavedChanges],
	)

	const onConfirmDialogResult = (confirm: boolean) => {
		if (confirm) {
			// Discard changes: Reset to initial settings
			discardChanges()
			confirmDialogHandler.current?.() // Execute the pending action (e.g., close popover)
		}
		setDiscardDialogShow(false)
	}

	// Handle popover close with unsaved changes check
	const handlePopoverClose = useCallback(() => {
		checkUnsavedChanges(() => {
			setOpen(false)
		})
	}, [checkUnsavedChanges])

	// Use the shared ESC key handler hook - respects unsaved changes logic
	useEscapeKey(open, handlePopoverClose)

	// Fetch OpenRouter model providers for embedding model
	const { data: openRouterEmbeddingProviders } = useOpenRouterModelProviders(
		currentSettings.codebaseIndexEmbedderProvider === "openrouter"
			? currentSettings.codebaseIndexEmbedderModelId
			: undefined,
		undefined,
		{
			enabled:
				currentSettings.codebaseIndexEmbedderProvider === "openrouter" &&
				!!currentSettings.codebaseIndexEmbedderModelId,
		},
	)

	const portalContainer = useRooPortal("roo-portal")

	return (
		<>
			<Popover
				open={open}
				onOpenChange={(newOpen) => {
					if (!newOpen) {
						// User is trying to close the popover
						handlePopoverClose()
					} else {
						setOpen(newOpen)
					}
				}}>
				{children}
				<PopoverContent
					className="w-[calc(100vw-32px)] max-w-[450px] max-h-[80vh] overflow-y-auto p-0"
					align="end"
					alignOffset={0}
					side="bottom"
					sideOffset={5}
					collisionPadding={16}
					avoidCollisions={true}
					container={portalContainer}>
					<div className="p-3 border-b border-vscode-dropdown-border cursor-default">
						<div className="flex flex-row items-center gap-1 p-0 m-0 w-full">
							<h4 className="m-0 flex-1">{t("settings:codeIndex.title")}</h4>
						</div>
					</div>

					<div className="p-4">
						{/* Enable/Disable Toggle */}
						<div className="mb-4">
							<div className="flex items-center gap-2">
								<LabeledCheckbox
									checked={currentSettings.codebaseIndexEnabled}
									onChange={(e: any) => updateSetting("codebaseIndexEnabled", e.target.checked)}>
									<span className="font-medium">{t("settings:codeIndex.enableLabel")}</span>
								</LabeledCheckbox>
								<StandardTooltip content={t("settings:codeIndex.enableDescription")}>
									<span
										className="codicon codicon-info text-xs text-vscode-descriptionForeground cursor-help"
										aria-hidden="true"
									/>
								</StandardTooltip>
							</div>
						</div>

						<CodeIndexStatusSection indexingStatus={indexingStatus} />

						<CodeIndexDisclosure
							label={t("settings:codeIndex.setupConfigLabel")}
							isOpen={isSetupSettingsOpen}
							onToggle={() => setIsSetupSettingsOpen(!isSetupSettingsOpen)}>
							<CodeIndexSetupFields
								settings={currentSettings}
								formErrors={formErrors}
								updateSetting={updateSetting}
								openRouterEmbeddingProviders={openRouterEmbeddingProviders}
								codebaseIndexModels={codebaseIndexModels}
								apiConfiguration={apiConfiguration}
							/>
						</CodeIndexDisclosure>

						<CodeIndexDisclosure
							label={t("settings:codeIndex.advancedConfigLabel")}
							isOpen={isAdvancedSettingsOpen}
							onToggle={() => setIsAdvancedSettingsOpen(!isAdvancedSettingsOpen)}>
							<CodeIndexAdvancedFields settings={currentSettings} updateSetting={updateSetting} />
							{currentSettings.codebaseIndexEnabled && (
								// One child, so the disclosure's space-y does not spread the two checkboxes apart
								<div>
									<CodeIndexWorkspaceToggles indexingStatus={indexingStatus} />
								</div>
							)}
						</CodeIndexDisclosure>

						{currentSettings.codebaseIndexEnabled && !indexingStatus.workspaceEnabled && (
							<p className="mt-4 mb-0 text-xs text-vscode-descriptionForeground">
								{t("settings:codeIndex.workspaceDisabledMessage")}
							</p>
						)}

						<CodeIndexActions
							indexingStatus={indexingStatus}
							codebaseIndexEnabled={currentSettings.codebaseIndexEnabled}
							saveStatus={saveStatus}
							saveError={saveError}
							hasUnsavedChanges={hasUnsavedChanges}
							onSave={handleSaveSettings}
						/>
					</div>
				</PopoverContent>
			</Popover>

			{/* Discard Changes Dialog */}
			<DiscardChangesDialog
				open={isDiscardDialogShow}
				onOpenChange={setDiscardDialogShow}
				onResult={onConfirmDialogResult}
			/>
		</>
	)
}
