export const PRODUCTION_CLERK_BASE_URL = "https://auth.tumblecode.dev"
export const PRODUCTION_ROO_CODE_API_URL = "https://app.tumblecode.dev"
export const PRODUCTION_ROO_CODE_PROVIDER_URL = "https://api.tumblecode.dev/proxy"

// Runtime overrides (set from VS Code configuration, take priority over env vars)
let runtimeClerkBaseUrl: string | undefined
let runtimeRooCodeApiUrl: string | undefined
let runtimeRooCodeProviderUrl: string | undefined

/**
 * Set the Clerk base URL at runtime (e.g. from VS Code configuration).
 * Pass `undefined` to clear the override and fall back to env var / default.
 */
export const setClerkBaseUrl = (url: string | undefined) => {
	runtimeClerkBaseUrl = url
}

/**
 * Get the Clerk base URL.
 *
 * Priority:
 * 1. Explicit runtime override (setClerkBaseUrl)
 * 2. CLERK_BASE_URL environment variable
 * 3. Auto-detect: if the Roo Code API URL is non-production, use it as the
 *    Clerk base URL (self-hosted deployments serve Clerk-compatible endpoints)
 * 4. Production default (https://auth.tumblecode.dev)
 *
 * The auto-detect step (3) is critical for self-hosted deployments: when the
 * user configures ROO_CODE_API_URL (or cloudApiUrl in VS Code) to point to
 * their self-hosted instance but does NOT explicitly set CLERK_BASE_URL,
 * the ticket created by the self-hosted backend must be validated against
 * the self-hosted Clerk facade, not the production Clerk. Without this,
 * the extension sends the ticket to production Clerk which has no knowledge
 * of self-hosted users/sessions, resulting in HTTP 400.
 */
export const getClerkBaseUrl = () => {
	// Explicit overrides take priority
	if (runtimeClerkBaseUrl) return runtimeClerkBaseUrl
	if (process.env.CLERK_BASE_URL) return process.env.CLERK_BASE_URL

	// Auto-detect: if the API URL is non-production, the Clerk facade is on the same server
	const apiUrl = getRooCodeApiUrl()
	if (apiUrl !== PRODUCTION_ROO_CODE_API_URL) return apiUrl

	return PRODUCTION_CLERK_BASE_URL
}

/**
 * Set the Roo Code API URL at runtime (e.g. from VS Code configuration).
 * Pass `undefined` to clear the override and fall back to env var / default.
 */
export const setRooCodeApiUrl = (url: string | undefined) => {
	runtimeRooCodeApiUrl = url
}

export const getRooCodeApiUrl = () =>
	runtimeRooCodeApiUrl || process.env.ROO_CODE_API_URL || PRODUCTION_ROO_CODE_API_URL

/**
 * Set the Roo Code Provider URL at runtime (e.g. from VS Code configuration).
 * This is the base URL for the Roo cloud proxy/provider (e.g. "https://api.tumblecode.dev/proxy").
 * Pass `undefined` to clear the override and fall back to env var / default.
 */
export const setRooCodeProviderUrl = (url: string | undefined) => {
	runtimeRooCodeProviderUrl = url
}

export const getRooCodeProviderUrl = () =>
	runtimeRooCodeProviderUrl || process.env.ROO_CODE_PROVIDER_URL || PRODUCTION_ROO_CODE_PROVIDER_URL
