import { useState, useCallback } from "react"
import { vscode } from "@/utils/vscode"
import { useExtensionSelector } from "@/context/ExtensionStateContext"

export const useCloudUpsell = () => {
	const [isOpen, setIsOpen] = useState(false)
	// P1: narrow slices.
	const cloudIsAuthenticated = useExtensionSelector((s) => s.cloudIsAuthenticated)
	const sharingEnabled = useExtensionSelector((s) => s.sharingEnabled)
	const publicSharingEnabled = useExtensionSelector((s) => s.publicSharingEnabled)
	const isSignedInForSharing = !!cloudIsAuthenticated && !!sharingEnabled
	const [wasSignedInForSharing, setWasSignedInForSharing] = useState(isSignedInForSharing)
	const [initiatedAuth, setInitiatedAuth] = useState(false)

	// A sign-in started from this hook closes the upsell once it completes.
	if (isSignedInForSharing !== wasSignedInForSharing) {
		setWasSignedInForSharing(isSignedInForSharing)
		if (isSignedInForSharing && initiatedAuth) {
			setIsOpen(false)
			setInitiatedAuth(false)
		}
	}

	const openUpsell = useCallback(() => {
		setIsOpen(true)
	}, [])

	const closeUpsell = useCallback(() => {
		setIsOpen(false)
	}, [])

	const handleConnect = useCallback(() => {
		setInitiatedAuth(true)
		vscode.postMessage({ type: "rooCloudSignIn" })
		setIsOpen(false)
	}, [])

	return {
		isOpen,
		openUpsell,
		closeUpsell,
		handleConnect,
		isAuthenticated: cloudIsAuthenticated,
		sharingEnabled,
		publicSharingEnabled,
	}
}
