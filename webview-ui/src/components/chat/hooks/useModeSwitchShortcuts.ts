import { useCallback, useEffect } from "react"

import type { ModeConfig } from "@roo-code/types"

import { getAllModes } from "@roo/modes"

/**
 * Cmd/Ctrl + . switches to the next mode, with Shift to the previous one.
 * Scroll-intent keys (PageUp, Home, ArrowUp) are handled by useScrollLifecycle.
 */
export function useModeSwitchShortcuts(
	mode: string,
	customModes: ModeConfig[] | undefined,
	switchToMode: (modeSlug: string) => void,
) {
	const handleKeyDown = useCallback(
		(event: KeyboardEvent) => {
			if ((event.metaKey || event.ctrlKey) && event.key === ".") {
				event.preventDefault()
				const allModes = getAllModes(customModes)
				const currentModeIndex = allModes.findIndex((m) => m.slug === mode)
				const offset = event.shiftKey ? allModes.length - 1 : 1
				switchToMode(allModes[(currentModeIndex + offset) % allModes.length].slug)
			}
		},
		[mode, customModes, switchToMode],
	)

	useEffect(() => {
		window.addEventListener("keydown", handleKeyDown)

		return () => {
			window.removeEventListener("keydown", handleKeyDown)
		}
	}, [handleKeyDown])
}
