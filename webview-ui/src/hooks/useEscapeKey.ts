import { useEffect, useCallback } from "react"

/**
 * Calls `onEscape` when ESC is pressed while `isOpen`, and keeps the key from
 * reaching other handlers (default action and propagation stopped).
 * @param isOpen - Whether the component is currently open/visible
 * @param onEscape - Callback function to execute when ESC is pressed
 */
export function useEscapeKey(isOpen: boolean, onEscape: () => void) {
	const handleKeyDown = useCallback(
		(event: KeyboardEvent) => {
			// Check isOpen inside the handler to ensure proper cleanup
			if (event.key === "Escape" && isOpen) {
				event.preventDefault()
				event.stopPropagation()
				onEscape()
			}
		},
		[isOpen, onEscape],
	)

	useEffect(() => {
		// Always add the event listener to ensure proper cleanup on unmount
		// The isOpen check is now inside the handler
		window.addEventListener("keydown", handleKeyDown)

		return () => {
			window.removeEventListener("keydown", handleKeyDown)
		}
	}, [handleKeyDown])
}
