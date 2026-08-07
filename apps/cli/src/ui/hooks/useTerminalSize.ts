/**
 * useTerminalSize - Hook that tracks terminal dimensions and re-renders on resize
 * Includes debouncing to prevent rendering issues during rapid resizing
 */

import { useState, useEffect, useRef } from "react"

interface TerminalSize {
	columns: number
	rows: number
}

/**
 * Returns the current terminal size and re-renders when it changes
 * Debounces resize events to prevent rendering artifacts
 */
export function useTerminalSize(): TerminalSize {
	// Get initial size synchronously - this is the value used for first render
	const [size, setSize] = useState<TerminalSize>(() => ({
		columns: process.stdout.columns || 80,
		rows: process.stdout.rows || 24,
	}))

	const debounceTimer = useRef<NodeJS.Timeout | null>(null)

	useEffect(() => {
		const handleResize = () => {
			// Clear any pending debounce
			if (debounceTimer.current) {
				clearTimeout(debounceTimer.current)
			}

			// Debounce resize events by 50ms
			debounceTimer.current = setTimeout(() => {
				// NOTE: never write raw escape codes (e.g. clear-screen) here.
				// Ink tracks the cursor relative to its last frame; a raw
				// \x1b[2J\x1b[H behind its back made every subsequent frame
				// render at the top of the screen (proven byte-level: 2J+H
				// followed by ink's cursorUp clamping at row 0), painting the
				// input line into the transcript on every VSCode panel resize.
				// Ink has its own resize handler and clears when needed.
				setSize({
					columns: process.stdout.columns || 80,
					rows: process.stdout.rows || 24,
				})
				debounceTimer.current = null
			}, 50)
		}

		// Listen for resize events
		process.stdout.on("resize", handleResize)

		// Cleanup
		return () => {
			process.stdout.off("resize", handleResize)
			if (debounceTimer.current) {
				clearTimeout(debounceTimer.current)
			}
		}
	}, [])

	return size
}
