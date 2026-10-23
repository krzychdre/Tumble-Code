/**
 * Anthropic SDK client options that send the key in `X-Api-Key`, the header MiniMax and Anthropic-compatible
 * gateways read. The SDK itself sends `apiKey` as `Authorization: Bearer`; the null drops that header.
 */
export function xApiKeyAuth(apiKey: string | undefined) {
	return { apiKey, defaultHeaders: { "X-Api-Key": apiKey, Authorization: null } }
}
