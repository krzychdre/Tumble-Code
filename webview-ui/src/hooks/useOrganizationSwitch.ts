import { useCallback, useEffect, useState } from "react"

import type { ExtensionMessage } from "@roo-code/types"

import { vscode } from "@src/utils/vscode"
import { onExtensionMessage } from "@src/utils/extensionBus"

/** Select values that are not organization ids. */
export const PERSONAL_ACCOUNT_VALUE = "personal"
export const CREATE_TEAM_VALUE = "create-team"

type UseOrganizationSwitchOptions = {
	/** The organization the user is signed in to, from the extension state (none = personal account). */
	organizationId?: string | null
	/** Base URL of the cloud app; the create-team option opens its billing page. */
	cloudApiUrl?: string
	onOrganizationChange?: (organizationId: string | null) => void
}

/**
 * The organization picker logic shared by CloudAccountSwitcher and OrganizationSwitcher.
 *
 * Picking an organization posts `switchOrganization`, shows the pick right away and locks
 * the picker until the extension answers with `organizationSwitchResult`: on success the
 * pick stays, on failure the picker goes back to the organization from the extension state.
 */
export function useOrganizationSwitch({
	organizationId,
	cloudApiUrl,
	onOrganizationChange,
}: UseOrganizationSwitchOptions) {
	const signedInOrgId = organizationId || null
	const [selectedOrgId, setSelectedOrgId] = useState<string | null>(signedInOrgId)
	const [isLoading, setIsLoading] = useState(false)

	useEffect(() => {
		setSelectedOrgId(signedInOrgId)
	}, [signedInOrgId])

	useEffect(() => {
		const handleMessage = (message: ExtensionMessage) => {
			if (message?.type !== "organizationSwitchResult") {
				return
			}
			setIsLoading(false)
			setSelectedOrgId(message.success ? (message.organizationId ?? null) : signedInOrgId)
		}

		return onExtensionMessage("organizationSwitchResult", handleMessage)
	}, [signedInOrgId])

	const handleOrganizationChange = useCallback(
		(value: string) => {
			if (value === CREATE_TEAM_VALUE) {
				if (cloudApiUrl) {
					vscode.postMessage({ type: "openExternal", url: `${cloudApiUrl}/billing` })
				}
				return
			}

			const newOrgId = value === PERSONAL_ACCOUNT_VALUE ? null : value
			if (newOrgId === selectedOrgId) {
				return
			}

			setIsLoading(true)
			vscode.postMessage({ type: "switchOrganization", organizationId: newOrgId })
			setSelectedOrgId(newOrgId)
			onOrganizationChange?.(newOrgId)
		},
		[cloudApiUrl, onOrganizationChange, selectedOrgId],
	)

	return { selectedOrgId, isLoading, handleOrganizationChange }
}
