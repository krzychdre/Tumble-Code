import { memo } from "react"
import { Text, Box } from "ink"

import * as theme from "../theme.js"
import type { Toast, ToastType } from "../hooks/useToast.js"

interface ToastDisplayProps {
	toast: Toast | null
}

/**
 * Map a toast type to its semantic theme color.
 * success → theme.success, warning → theme.warning,
 * error → theme.error, info → theme.suggestion.
 */
function getToastColor(type: ToastType): string {
	switch (type) {
		case "success":
			return theme.success
		case "warning":
			return theme.warning
		case "error":
			return theme.error
		case "info":
		default:
			return theme.suggestion
	}
}

/**
 * Map a toast type to a single-glyph icon.
 */
function getToastIcon(type: ToastType): string {
	switch (type) {
		case "success":
			return "✓"
		case "warning":
			return "⚠"
		case "error":
			return "✗"
		case "info":
		default:
			return "ℹ"
	}
}

/**
 * Single-line toast display, colored by kind (no box).
 * Toasts are the one element that should pop, so they render at full
 * intensity (not dim) in their kind color.
 */
function ToastDisplay({ toast }: ToastDisplayProps) {
	if (!toast) {
		return null
	}

	const color = getToastColor(toast.type)
	const icon = getToastIcon(toast.type)

	return (
		<Box>
			<Text color={color}>
				{icon} {toast.message}
			</Text>
		</Box>
	)
}

export default memo(ToastDisplay)
