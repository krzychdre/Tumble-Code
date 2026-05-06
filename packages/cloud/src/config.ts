export const PRODUCTION_CLERK_BASE_URL = "https://clerk.roocode.com"
export const PRODUCTION_ROO_CODE_API_URL = "https://app.roocode.com"
export const PRODUCTION_ROO_CODE_PROVIDER_URL = "https://api.roocode.com/proxy"

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

export const getClerkBaseUrl = () => runtimeClerkBaseUrl || process.env.CLERK_BASE_URL || PRODUCTION_CLERK_BASE_URL

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
 * This is the base URL for the Roo cloud proxy/provider (e.g. "https://api.roocode.com/proxy").
 * Pass `undefined` to clear the override and fall back to env var / default.
 */
export const setRooCodeProviderUrl = (url: string | undefined) => {
	runtimeRooCodeProviderUrl = url
}

export const getRooCodeProviderUrl = () =>
	runtimeRooCodeProviderUrl || process.env.ROO_CODE_PROVIDER_URL || PRODUCTION_ROO_CODE_PROVIDER_URL
