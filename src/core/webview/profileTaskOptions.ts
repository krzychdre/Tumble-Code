import type { OrganizationAllowList, ProviderSettings } from "@roo-code/types"

import { ProfileValidator } from "../../shared/ProfileValidator"
import { OrganizationAllowListViolationError } from "../../utils/errors"
import { t } from "../../i18n"

/**
 * Task options that follow from the provider profile a new task will run on.
 * Shared by `createTask` and `createBackgroundTask` so that both enforce the
 * organization allow list and apply the profile's consecutive-mistake limit.
 *
 * @throws OrganizationAllowListViolationError when the profile is not allowed.
 */
export function profileTaskOptions(
	apiConfiguration: ProviderSettings,
	organizationAllowList: OrganizationAllowList,
): { apiConfiguration: ProviderSettings; consecutiveMistakeLimit: number | undefined } {
	if (!ProfileValidator.isProfileAllowed(apiConfiguration, organizationAllowList)) {
		throw new OrganizationAllowListViolationError(t("common:errors.violated_organization_allowlist"))
	}
	return { apiConfiguration, consecutiveMistakeLimit: apiConfiguration.consecutiveMistakeLimit }
}
