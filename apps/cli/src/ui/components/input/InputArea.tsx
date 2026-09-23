import { memo } from "react"
import { Box, Text } from "ink"

import { figures } from "../../figures.js"
import * as theme from "../../theme.js"
import { AutocompleteInput } from "../autocomplete/AutocompleteInput.js"
import type { AutocompleteItem, AutocompleteTrigger, AutocompletePickerState } from "../autocomplete/types.js"
import type { AutocompleteInputHandle } from "../autocomplete/AutocompleteInput.js"
import InputFooter from "./InputFooter.js"
import type { Toast } from "../../hooks/useToast.js"

export interface InputAreaProps {
	/** Called when the user submits text (Enter without picker open) */
	onSubmit: (text: string) => void
	/** False when a dialog owns input; passed through to AutocompleteInput */
	isActive: boolean
	/** Dim the ❯ prompt while loading */
	isLoading: boolean
	/** Placeholder text when input is empty */
	placeholder?: string
	/** Autocomplete triggers — forwarded to AutocompleteInput */
	triggers: AutocompleteTrigger<AutocompleteItem>[]
	/** Called when an autocomplete item is selected from the picker */
	onSelect?: (item: AutocompleteItem) => void
	/** Called when picker state changes — used to render PickerSelect externally */
	onPickerStateChange?: (state: AutocompletePickerState<AutocompleteItem>) => void
	/** Ref handle to AutocompleteInput (picker state + actions) */
	inputRef?: React.Ref<AutocompleteInputHandle<AutocompleteItem>>
	/** When true, color the ❯ with theme.permission instead of promptBorder */
	accentPrompt?: boolean
	// Footer data
	mode?: string
	model?: string
	contextPercent?: number | null
	cost?: number
	toast?: Toast | null
	exitHint?: string | null
}

/**
 * Bordered input container (Claude Code style §2).
 *
 * Renders a top+bottom-only round border (no left/right rules) in
 * `theme.promptBorder`, with the `❯` prompt glyph as a flex sibling of
 * the `AutocompleteInput`. The AutocompleteInput itself renders no
 * prompt (its default is `""`), so the external `❯` is the only prompt
 * glyph and the text aligns after it. Below the box sits InputFooter.
 *
 * Followup custom-input mode: pass `accentPrompt` to color the `❯`
 * with `theme.permission` so the free-text prompt stands out.
 */
function InputArea({
	onSubmit,
	isActive,
	isLoading,
	placeholder,
	triggers,
	onSelect,
	onPickerStateChange,
	inputRef,
	accentPrompt = false,
	mode,
	model,
	contextPercent,
	cost,
	toast,
	exitHint,
}: InputAreaProps) {
	const baseColor = accentPrompt ? theme.permission : theme.promptBorder
	// Dimmed by value: `dimColor` on a hex colour does nothing in VTE (theme.dimmed).
	const promptColor = isLoading ? theme.dimmed(baseColor) : baseColor

	return (
		<Box flexDirection="column" marginTop={1}>
			<Box
				borderStyle="round"
				borderLeft={false}
				borderRight={false}
				borderColor={theme.promptBorder}
				paddingX={1}
				width="100%">
				<Text color={promptColor}>{figures.pointer} </Text>
				<AutocompleteInput
					ref={inputRef}
					placeholder={placeholder}
					onSubmit={onSubmit}
					isActive={isActive}
					triggers={triggers}
					onSelect={onSelect}
					onPickerStateChange={onPickerStateChange}
				/>
			</Box>
			<InputFooter
				toast={toast}
				exitHint={exitHint}
				mode={mode}
				model={model}
				contextPercent={contextPercent}
				cost={cost}
			/>
		</Box>
	)
}

export default memo(InputArea)

// Re-export the AutocompleteInput handle type for WP-D consumers.
export type { AutocompleteInputHandle } from "../autocomplete/AutocompleteInput.js"
