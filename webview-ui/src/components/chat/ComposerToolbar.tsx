import { useCallback, useMemo } from "react"

import { Mode, getAllModes } from "@roo/modes"

import { vscode } from "@src/utils/vscode"
import { useExtensionSelector } from "@src/context/ExtensionStateContext"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { cn } from "@src/lib/utils"

import { ModeSelector } from "./ModeSelector"
import { ApiConfigSelector } from "./ApiConfigSelector"
import { AutoApproveDropdown } from "./AutoApproveDropdown"
import { IndexingStatusBadge } from "./IndexingStatusBadge"
import { CloudAccountSwitcher } from "../cloud/CloudAccountSwitcher"

interface ComposerToolbarProps {
	mode: Mode
	setMode: (value: Mode) => void
	modeShortcutText: string
	selectApiConfigDisabled: boolean
	isEditMode: boolean
}

/**
 * The row under the composer: mode, API configuration and auto-approve selectors on the left, indexing
 * status and cloud account on the right (those two are hidden while editing a message).
 */
export const ComposerToolbar = ({
	mode,
	setMode,
	modeShortcutText,
	selectApiConfigDisabled,
	isEditMode,
}: ComposerToolbarProps) => {
	const { t } = useAppTranslation()
	// P1: narrow selectors, none of these change while a token streams.
	const currentApiConfigName = useExtensionSelector((s) => s.currentApiConfigName)
	const listApiConfigMeta = useExtensionSelector((s) => s.listApiConfigMeta)
	const customModes = useExtensionSelector((s) => s.customModes)
	const customModePrompts = useExtensionSelector((s) => s.customModePrompts)
	const pinnedApiConfigs = useExtensionSelector((s) => s.pinnedApiConfigs)
	const togglePinnedApiConfig = useExtensionSelector((s) => s.togglePinnedApiConfig)
	const cloudUserInfo = useExtensionSelector((s) => s.cloudUserInfo)
	const lockApiConfigAcrossModes = useExtensionSelector((s) => s.lockApiConfigAcrossModes)
	const modeApiConfigs = useExtensionSelector((s) => s.modeApiConfigs)

	// Find the ID and display text for the currently selected API configuration.
	const { currentConfigId, displayName } = useMemo(() => {
		const currentConfig = listApiConfigMeta?.find((config) => config.name === currentApiConfigName)
		return {
			currentConfigId: currentConfig?.id || "",
			displayName: currentApiConfigName || "", // Use the name directly for display.
		}
	}, [listApiConfigMeta, currentApiConfigName])

	const availableModes = useMemo(
		() => getAllModes(customModes).map((mode) => ({ slug: mode.slug, name: mode.name })),
		[customModes],
	)

	const handleModeChange = useCallback(
		(value: Mode) => {
			setMode(value)
			vscode.postMessage({ type: "mode", text: value })
		},
		[setMode],
	)

	const handleApiConfigChange = useCallback((value: string) => {
		vscode.postMessage({ type: "loadApiConfigurationById", text: value })
	}, [])

	const handleToggleLockApiConfig = useCallback(() => {
		const newValue = !lockApiConfigAcrossModes
		vscode.postMessage({ type: "lockApiConfigAcrossModes", bool: newValue })
	}, [lockApiConfigAcrossModes])

	return (
		<div className="flex items-center gap-2">
			<div className="flex items-center gap-2 min-w-0 overflow-clip flex-1">
				<ModeSelector
					value={mode}
					title={t("chat:selectMode")}
					onChange={handleModeChange}
					triggerClassName="text-ellipsis overflow-hidden flex-shrink-0"
					modeShortcutText={modeShortcutText}
					customModes={customModes}
					customModePrompts={customModePrompts}
				/>
				<ApiConfigSelector
					value={currentConfigId}
					displayName={displayName}
					disabled={selectApiConfigDisabled}
					title={t("chat:selectApiConfig")}
					onChange={handleApiConfigChange}
					triggerClassName="min-w-[28px] text-ellipsis overflow-hidden flex-shrink"
					listApiConfigMeta={listApiConfigMeta || []}
					pinnedApiConfigs={pinnedApiConfigs}
					togglePinnedApiConfig={togglePinnedApiConfig}
					lockApiConfigAcrossModes={!!lockApiConfigAcrossModes}
					onToggleLockApiConfig={handleToggleLockApiConfig}
					availableModes={availableModes}
					modeApiConfigs={modeApiConfigs}
				/>
				<AutoApproveDropdown triggerClassName="min-w-[28px] text-ellipsis overflow-hidden flex-shrink" />
			</div>
			<div
				className={cn(
					"flex flex-shrink-0 items-center gap-0.5 h-5 leading-none",
					!isEditMode && cloudUserInfo ? "" : "pr-2",
				)}>
				{!isEditMode ? <IndexingStatusBadge /> : null}
				{!isEditMode && cloudUserInfo && <CloudAccountSwitcher />}
			</div>
		</div>
	)
}
