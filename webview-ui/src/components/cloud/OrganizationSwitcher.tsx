import { Building2, User, Plus } from "lucide-react"

import { type CloudUserInfo, type CloudOrganizationMembership } from "@roo-code/types"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { CREATE_TEAM_VALUE, PERSONAL_ACCOUNT_VALUE, useOrganizationSwitch } from "@src/hooks/useOrganizationSwitch"

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectSeparator } from "@/components/ui/select"

type OrganizationSwitcherProps = {
	userInfo: CloudUserInfo
	organizations: CloudOrganizationMembership[]
	onOrganizationChange?: (organizationId: string | null) => void
	cloudApiUrl?: string
}

export const OrganizationSwitcher = ({
	userInfo,
	organizations,
	onOrganizationChange,
	cloudApiUrl,
}: OrganizationSwitcherProps) => {
	const { t } = useAppTranslation()
	const { selectedOrgId, isLoading, handleOrganizationChange } = useOrganizationSwitch({
		organizationId: userInfo.organizationId,
		cloudApiUrl,
		onOrganizationChange,
	})

	// Always show the switcher when user is authenticated

	const currentValue = selectedOrgId || PERSONAL_ACCOUNT_VALUE

	return (
		<div className="w-full">
			<Select value={currentValue} onValueChange={handleOrganizationChange} disabled={isLoading}>
				<SelectTrigger className="w-full">
					<SelectValue>
						<div className="flex items-center gap-2">
							{selectedOrgId ? (
								<>
									{organizations.find((org) => org.organization.id === selectedOrgId)?.organization
										.image_url ? (
										<img
											src={
												organizations.find((org) => org.organization.id === selectedOrgId)
													?.organization.image_url
											}
											alt=""
											className="w-4.5 h-4.5 rounded-full object-cover overflow-clip"
										/>
									) : (
										<Building2 className="w-4.5 h-4.5" />
									)}
									<span className="truncate">
										{
											organizations.find((org) => org.organization.id === selectedOrgId)
												?.organization.name
										}
									</span>
								</>
							) : (
								<>
									<div className="p-0.5 bg-vscode-button-background rounded-full flex items-center justify-center text-vscode-button-foreground text-xs">
										<User className="w-4 h-4 text-vscode-button-foreground" />
									</div>
									<span>{t("cloud:personalAccount")}</span>
								</>
							)}
						</div>
					</SelectValue>
				</SelectTrigger>
				<SelectContent>
					<SelectItem value={PERSONAL_ACCOUNT_VALUE}>
						<div className="flex items-center gap-2">
							<User className="w-4.5 h-4.5" />
							<span>{t("cloud:personalAccount")}</span>
						</div>
					</SelectItem>
					{organizations.length > 0 && <SelectSeparator />}
					{organizations.map((org) => (
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
					{organizations.length === 0 && (
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
