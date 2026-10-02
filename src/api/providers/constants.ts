import { Package } from "../../shared/package"

/**
 * App attribution for OpenRouter-style gateways, which show the referer and title in their usage
 * pages and app rankings. One copy for every request that sends them.
 */
export const APP_ATTRIBUTION_HEADERS = {
	"HTTP-Referer": "https://github.com/krzychdre/Tumble-Code",
	"X-Title": "Tumble Code",
}

export const DEFAULT_HEADERS = {
	...APP_ATTRIBUTION_HEADERS,
	"User-Agent": `TumbleCode/${Package.version}`,
}
