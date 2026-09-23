import { memo, useMemo, useRef, useState } from "react"
import { Box, Text, useInput } from "ink"

import { figures } from "../../figures.js"
import * as theme from "../../theme.js"

export interface SelectItem {
	label: string
	description?: string
	value: string
}

interface Props {
	items: SelectItem[]
	onSelect: (value: string) => void
	onCancel?: () => void
	isActive?: boolean // default true; when false, ignore input
	initialIndex?: number
	numbered?: boolean // default true
	maxVisible?: number // default 8
}

/**
 * Compute the visible window around the focused index. The window "follows"
 * the focus so the focused row is always visible, clamped to valid bounds.
 */
function computeVisibleWindow(
	focusedIndex: number,
	totalItems: number,
	maxVisible: number,
): { from: number; to: number } {
	if (totalItems === 0) {
		return { from: 0, to: 0 }
	}

	const visibleCount = Math.min(maxVisible, totalItems)
	const from = Math.max(0, Math.min(focusedIndex, totalItems - visibleCount))
	const to = Math.min(totalItems, from + visibleCount)
	return { from, to }
}

/**
 * Self-contained selectable list.
 * ↑/↓ navigate with wraparound; digits 1-9 jump-select (and confirm) the
 * single-digit entry; Enter confirms; Esc calls onCancel. Only maxVisible
 * rows around the focused index are rendered, with dim overflow hints.
 */
function SelectList({
	items,
	onSelect,
	onCancel,
	isActive = true,
	initialIndex = 0,
	numbered = true,
	maxVisible = 8,
}: Props) {
	const [focusedIndex, setFocusedIndex] = useState(() =>
		items.length === 0 ? 0 : Math.max(0, Math.min(initialIndex, items.length - 1)),
	)

	// Mirror the focused index in a ref so rapid key presses (before a render
	// flush) read the latest selection instead of a stale closure.
	const focusedIndexRef = useRef(focusedIndex)
	focusedIndexRef.current = focusedIndex

	useInput(
		(input, key) => {
			if (items.length === 0) {
				return
			}

			if (key.escape) {
				onCancel?.()
				return
			}

			if (key.return) {
				const item = items[focusedIndexRef.current]
				if (item) {
					onSelect(item.value)
				}
				return
			}

			if (key.upArrow) {
				setFocusedIndex((prev) => {
					const next = prev === 0 ? items.length - 1 : prev - 1
					focusedIndexRef.current = next
					return next
				})
				return
			}

			if (key.downArrow) {
				setFocusedIndex((prev) => {
					const next = prev >= items.length - 1 ? 0 : prev + 1
					focusedIndexRef.current = next
					return next
				})
				return
			}

			// digits: jump-select directly (numbers render in absolute 1-based indexing)
			if (input.length === 1 && input >= "1" && input <= "9") {
				const target = Number(input) - 1
				const item = items[target]
				if (item) {
					onSelect(item.value)
				}
			}
		},
		{ isActive },
	)

	const visibleWindow = useMemo(
		() => computeVisibleWindow(focusedIndex, items.length, maxVisible),
		[focusedIndex, items.length, maxVisible],
	)

	if (items.length === 0) {
		return null
	}

	const visibleItems = items.slice(visibleWindow.from, visibleWindow.to)
	const hasMoreAbove = visibleWindow.from > 0
	const hasMoreBelow = visibleWindow.to < items.length

	return (
		<Box flexDirection="column" minHeight={maxVisible}>
			{hasMoreAbove && (
				<Text dimColor>
					{figures.arrowUp} {visibleWindow.from} more
				</Text>
			)}

			{visibleItems.map((item, visibleIndex) => {
				const actualIndex = visibleWindow.from + visibleIndex
				const isFocused = actualIndex === focusedIndex

				return (
					<Box flexDirection="column" key={item.value}>
						<Box flexDirection="row">
							{isFocused ? (
								<Text color={theme.permission}>
									{figures.pointer} {numbered ? `${actualIndex + 1}. ` : ""}
								</Text>
							) : (
								<Text>
									{"  "}
									{numbered ? `${actualIndex + 1}. ` : ""}
								</Text>
							)}
							<Text wrap="truncate-end" bold={isFocused}>
								{item.label}
							</Text>
						</Box>
						{item.description !== undefined && (
							<Box paddingLeft={2}>
								<Text color={theme.faint}>{item.description}</Text>
							</Box>
						)}
					</Box>
				)
			})}

			{hasMoreBelow && (
				<Text dimColor>
					{figures.arrowDown} {items.length - visibleWindow.to} more
				</Text>
			)}
		</Box>
	)
}

export default memo(SelectList)
