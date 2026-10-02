import { useEffect } from "react"

import type { AutoApprovalMode } from "@tumble-code/types"

import { useExtensionSelector } from "@/context/ExtensionStateContext"

/** Bypass and autonomous count only while auto-approval itself is on (same rule as the composer trigger). */
export function isElevatedAutoApproval(autoApprovalEnabled: boolean | undefined, mode: AutoApprovalMode | undefined) {
	return !!autoApprovalEnabled && (mode === "bypass" || mode === "autonomous")
}

/**
 * Mirrors the auto-approve mode onto `<html data-auto-approve>`, which switches the `--frame-accent`
 * colour (popover frames, composer focus outline) from the theme's focus blue to orange. The attribute
 * sits on the root because popovers render into portals outside the chat subtree.
 */
export function useAutoApproveFrameAccent() {
	const autoApprovalEnabled = useExtensionSelector((s) => s.autoApprovalEnabled)
	const autoApprovalMode = useExtensionSelector((s) => s.autoApprovalMode)
	const elevated = isElevatedAutoApproval(autoApprovalEnabled, autoApprovalMode)

	useEffect(() => {
		const root = document.documentElement
		if (elevated) {
			root.dataset.autoApprove = "elevated"
		} else {
			delete root.dataset.autoApprove
		}
	}, [elevated])
}
