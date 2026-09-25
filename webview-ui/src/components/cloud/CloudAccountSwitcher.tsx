import { Building2, Plus } from "lucide-react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectSeparator } from "@/components/ui/select"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { useExtensionState } from "@src/context/ExtensionStateContext"
import { cn } from "@src/lib/utils"
import { CREATE_TEAM_VALUE, PERSONAL_ACCOUNT_VALUE, useOrganizationSwitch } from "@src/hooks/useOrganizationSwitch"

export const CloudAccountSwitcher = () => {
	const { t } = useAppTranslation()
	const { cloudUserInfo, cloudOrganizations = [], cloudApiUrl } = useExtensionState()
	const { selectedOrgId, isLoading, handleOrganizationChange } = useOrganizationSwitch({
		organizationId: cloudUserInfo?.organizationId,
		cloudApiUrl,
	})

	// Show the switcher whenever user is authenticated
	if (!cloudUserInfo) {
		return null
	}

	const currentValue = selectedOrgId || PERSONAL_ACCOUNT_VALUE
	const currentOrg = cloudOrganizations.find((org) => org.organization.id === selectedOrgId)

	// Render the account icon based on current context
	const renderAccountIcon = () => {
		if (selectedOrgId && currentOrg?.organization.image_url) {
			// Organization with logo
			return (
				<img
					src={currentOrg.organization.image_url}
					alt={currentOrg.organization.name}
					className="w-5 h-5 rounded object-cover"
				/>
			)
		} else if (selectedOrgId) {
			// Organization without logo
			return <Building2 className="w-4.5 h-4.5" />
		} else if (cloudUserInfo.picture) {
			// Personal account with avatar
			return (
				<img
					src={cloudUserInfo.picture}
					alt={cloudUserInfo.name || cloudUserInfo.email}
					className="w-5 h-5 rounded-full object-cover"
				/>
			)
		} else {
			// Personal account without avatar - show initials
			const initial = cloudUserInfo.name?.charAt(0) || cloudUserInfo.email?.charAt(0) || "?"
			return (
				<div className="w-5 h-5 rounded-full flex items-center justify-center bg-vscode-button-background text-vscode-button-foreground text-xs">
					{initial}
				</div>
			)
		}
	}

	return (
		<div className="inline-block ml-1">
			<Select value={currentValue} onValueChange={handleOrganizationChange} disabled={isLoading}>
				<SelectTrigger
					className={cn(
						"h-4.5 w-4.5 p-0 gap-0",
						"bg-transparent opacity-90 hover:opacity-50",
						"flex items-center justify-center",
						"rounded-lg overflow-clip",
						"border border-vscode-dropdown-border",
						"[&>svg]:hidden", // Hide the default chevron/caret
						isLoading && "opacity-50",
					)}
					aria-label={selectedOrgId ? currentOrg?.organization.name : t("cloud:personalAccount")}>
					{renderAccountIcon()}
				</SelectTrigger>

				<SelectContent>
					{/* Personal Account Option */}
					<SelectItem value={PERSONAL_ACCOUNT_VALUE}>
						<div className="flex items-center gap-2">
							{cloudUserInfo.picture ? (
								<img
									src={cloudUserInfo.picture}
									alt={cloudUserInfo.name || cloudUserInfo.email}
									className="w-4.5 h-4.5 rounded-full object-cover overflow-clip"
								/>
							) : (
								<div className="w-4.5 h-4.5 rounded-full flex items-center justify-center bg-vscode-button-background text-vscode-button-foreground text-xs">
									{cloudUserInfo.name?.charAt(0) || cloudUserInfo.email?.charAt(0) || "?"}
								</div>
							)}
							<span>{t("cloud:personalAccount")}</span>
						</div>
					</SelectItem>

					{cloudOrganizations.length > 0 && <SelectSeparator />}

					{/* Organization Options */}
					{cloudOrganizations.map((org) => (
						<SelectItem key={org.organization.id} value={org.organization.id}>
							<div className="flex items-center gap-2">
								{org.organization.image_url ? (
									<img
										src={org.organization.image_url}
										alt=""
										className="w-4.5 h-4.5 rounded-full object-cover overflow-clip"
									/>
								) : (
									<Building2 className="w-4.5 h-4.5" />
								)}
								<span className="truncate">{org.organization.name}</span>
							</div>
						</SelectItem>
					))}

					{/* Only show Create Team Account if user has no organizations */}
					{cloudOrganizations.length === 0 && (
						<>
							<SelectSeparator />
							<SelectItem value={CREATE_TEAM_VALUE}>
								<div className="flex items-center gap-2">
									<Plus className="w-4.5 h-4.5" />
									<span>{t("cloud:createTeamAccount")}</span>
								</div>
							</SelectItem>
						</>
					)}
				</SelectContent>
			</Select>
		</div>
	)
}
