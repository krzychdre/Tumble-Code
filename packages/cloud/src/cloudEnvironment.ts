/**
 * What the process environment asks CloudService to run as.
 *
 * - `staticToken`: a job token from TUMBLE_CODE_CLOUD_TOKEN. When present the
 *   extension runs as a cloud agent and authenticates with that token instead
 *   of the interactive web login.
 * - `staticOrgSettings`: organization settings from
 *   TUMBLE_CODE_CLOUD_ORG_SETTINGS. When present they replace the settings that
 *   would otherwise be fetched from the cloud.
 *
 * An empty variable counts as unset. The former names ROO_CODE_CLOUD_TOKEN and
 * ROO_CODE_CLOUD_ORG_SETTINGS are still read when the new ones are unset.
 */
export interface CloudEnvironment {
	staticToken: string | undefined
	staticOrgSettings: string | undefined
}

const nonEmpty = (value: string | undefined): string | undefined => (value && value.length > 0 ? value : undefined)

export function resolveCloudEnvironment(env: Record<string, string | undefined> = process.env): CloudEnvironment {
	return {
		staticToken: nonEmpty(env.TUMBLE_CODE_CLOUD_TOKEN) ?? nonEmpty(env.ROO_CODE_CLOUD_TOKEN),
		staticOrgSettings: nonEmpty(env.TUMBLE_CODE_CLOUD_ORG_SETTINGS) ?? nonEmpty(env.ROO_CODE_CLOUD_ORG_SETTINGS),
	}
}
