import { memo, useCallback, useMemo, useState } from "react"
import { Box, Text } from "ink"

import type { CliModelSettings } from "@/types/types.js"
import { buildModelRows, type ModelRow } from "@/lib/utils/model-command.js"

import * as theme from "../theme.js"
import { figures } from "../figures.js"
import { PickerSelect } from "./autocomplete/index.js"

/** Model rows shown at once; the list lives in the height-clamped tail. */
const MAX_VISIBLE_MODELS = 8

export interface ModelPickerProps {
	/** The mode whose model the list changes. */
	mode: string
	/** The model the mode runs now, marked in the list. */
	currentModel: string | undefined
	/** `models` of cli-settings.json. */
	models: Record<string, CliModelSettings> | undefined
	/** Enter: the id of the highlighted model. */
	onSelect: (model: string) => void
	/** Esc: close without a change. */
	onClose: () => void
	/** When false, the list ignores all input (default true) */
	isActive?: boolean
}

function renderRow(row: ModelRow, isSelected: boolean) {
	return (
		<Text wrap="truncate-end">
			<Text color={theme.success}>{row.current ? figures.bullet : " "} </Text>
			<Text bold={isSelected}>{row.key}</Text>
			{row.details && <Text color={theme.secondaryText}> ({row.details})</Text>}
		</Text>
	)
}

/**
 * `/model` without an argument: the models of cli-settings.json to pick from,
 * like the profile dropdown of the VS Code extension. The rows, the keys and
 * the scrolling are the autocomplete picker's (PickerSelect), so the list
 * looks and moves like the `/` and `#` pickers; the frame and the title are
 * the MCP panel's, because unlike those pickers this list is not filtered by
 * typing and has to say which mode it changes. Shift+Tab is held back by
 * useGlobalInput while it is open, so the mode cannot change under it.
 */
function ModelPicker({ mode, currentModel, models, onSelect, onClose, isActive = true }: ModelPickerProps) {
	const rows = useMemo(() => buildModelRows(currentModel, models), [currentModel, models])
	// Open on the model in use, so Enter straight away changes nothing.
	const [selectedIndex, setSelectedIndex] = useState(() =>
		Math.max(
			0,
			rows.findIndex((row) => row.current),
		),
	)
	const handleSelect = useCallback((row: ModelRow) => onSelect(row.key), [onSelect])

	return (
		<Box borderStyle="round" borderColor={theme.permission} paddingX={1} flexDirection="column">
			<Text bold color={theme.permission}>
				Model for {mode} mode
			</Text>

			<PickerSelect
				results={rows}
				selectedIndex={selectedIndex}
				maxVisible={Math.min(MAX_VISIBLE_MODELS, rows.length)}
				onSelect={handleSelect}
				onEscape={onClose}
				onIndexChange={setSelectedIndex}
				renderItem={renderRow}
				isActive={isActive}
			/>

			<Box marginTop={1}>
				<Text color={theme.secondaryText} wrap="truncate-end">
					{`${figures.arrowUp}${figures.arrowDown} select ${figures.dot} enter switch ${figures.dot} esc close`}
				</Text>
			</Box>
		</Box>
	)
}

export default memo(ModelPicker)
