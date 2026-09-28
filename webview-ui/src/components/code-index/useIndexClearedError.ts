import { useCallback, useState } from "react"

import { useExtensionMessage } from "@src/utils/extensionBus"

/**
 * The error of the last failed "clear index data" request, or `null`.
 *
 * The host answers `clearIndexData` with `indexCleared` (`values.success`,
 * and `values.error` on failure). A success needs no extra UI because the
 * host also pushes an `indexingStatusUpdate` ("Index data cleared
 * successfully."), so success only removes an earlier error.
 *
 * `dismiss` removes the error, for example when the user starts a new clear.
 */
export function useIndexClearedError(): { error: string | null; dismiss: () => void } {
	const [error, setError] = useState<string | null>(null)

	useExtensionMessage("indexCleared", (message) => {
		const values = message.values
		if (values?.success) {
			setError(null)
		} else {
			const text = typeof values?.error === "string" ? values.error : ""
			setError(text || null)
		}
	})

	const dismiss = useCallback(() => setError(null), [])

	return { error, dismiss }
}
