/**
 * What the process environment asks CloudService to run as.
 *
 * - `staticToken`: a job token from ROO_CODE_CLOUD_TOKEN. When present the
 *   extension runs as a cloud agent and authenticates with that token instead
 *   of the interactive web login.
 * - `staticOrgSettings`: organization settings from
 *   ROO_CODE_CLOUD_ORG_SETTINGS. When present they replace the settings that
 *   would otherwise be fetched from the cloud.
 *
 * An empty variable counts as unset.
 */
export interface CloudEnvironment {
	staticToken: string | undefined
	staticOrgSettings: string | undefined
}

const nonEmpty = (value: string | undefined): string | undefined => (value && value.length > 0 ? value : undefined)

export function resolveCloudEnvironment(env: Record<string, string | undefined> = process.env): CloudEnvironment {
	return {
		// For testing you can create a token with:
		// `pnpm --filter @roo-code-cloud/roomote-cli development auth job-token --job-id 1 --user-id user_2xmBhejNeDTwanM8CgIOnMgVxzC --org-id org_2wbhchVXZMQl8OS1yt0mrDazCpW`
		// The token will last for 1 hour.
		staticToken: nonEmpty(env.ROO_CODE_CLOUD_TOKEN),
		staticOrgSettings: nonEmpty(env.ROO_CODE_CLOUD_ORG_SETTINGS),
	}
}
