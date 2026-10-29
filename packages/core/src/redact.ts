/**
 * The one redactor for everything the extension sends to the cloud: telemetry
 * events, task messages (live bridge, sync, backfill), LLM exchanges and error
 * reports. The cloud must never receive a provider key or any other stored
 * secret, and error text is where they leak: an SDK names the bad header value
 * or the base URL with its credentials in the error it throws.
 */

/** Shorter configured values are not replaced, so short strings are not mangled everywhere. */
const MIN_SECRET_LENGTH = 8

const REDACTED = "[redacted]"

/**
 * Removes the obvious secrets from a text: bearer tokens, `api_key: ...`-style pairs,
 * credentials in URLs, key/token query parameters and the common provider key shapes.
 * Conversation content goes through it too, so a key the user pasted into a chat is not
 * sent either.
 */
function scrubSecrets(text: string): string {
	return text
		.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/g, "Bearer [redacted]")
		.replace(
			/(["']?(?:authorization|x-api-key|api[-_]?key|access[-_]?token|secret[-_]?key|client[-_]?secret|password)["']?\s*[:=]\s*["']?)([^\s"',}&]{4,})/gi,
			"$1[redacted]",
		)
		.replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/?#@:]*:[^\s/?#@]+@/gi, "$1[redacted]@")
		.replace(/([?&](?:key|api[-_]?key|token|access_token|auth|sig|signature)=)[^&\s"'#]+/gi, "$1[redacted]")
		.replace(/\bsk-(?:ant-|proj-|or-)?[A-Za-z0-9_-]{8,}/g, "[redacted-key]")
		.replace(/\bAIza[0-9A-Za-z_-]{30,}/g, "[redacted-key]")
		.replace(/\b(?:ghp|gho|ghu|ghs|github_pat)_[A-Za-z0-9_]{20,}/g, "[redacted-key]")
		.replace(/\bxox[abposr]-[A-Za-z0-9-]{10,}/g, "[redacted-key]")
		.replace(/\bAKIA[0-9A-Z]{16}\b/g, "[redacted-key]")
}

function redactText(text: string, secrets: readonly string[]): string {
	let redacted = text
	for (const secret of secrets) {
		redacted = redacted.replaceAll(secret, REDACTED)
	}
	return scrubSecrets(redacted)
}

function redactDeep<T>(value: T, secrets: readonly string[]): T {
	if (typeof value === "string") {
		return redactText(value, secrets) as T
	}
	if (Array.isArray(value)) {
		return value.map((item) => redactDeep(item, secrets)) as T
	}
	if (value && typeof value === "object") {
		return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactDeep(item, secrets)])) as T
	}
	return value
}

/**
 * A copy of a JSON-like value with every string redacted: each configured secret value
 * (the stored provider keys, custom header values and code-index keys) replaced wherever
 * it appears, then the pattern rules of {@link scrubSecrets}. A value is matched as stored
 * and trimmed, longest first, so a key saved with a stray newline is still found.
 */
export function redactSecrets<T>(value: T, secretValues: readonly string[]): T {
	const secrets = [...new Set(secretValues.flatMap((secret) => [secret, secret.trim()]))]
		.filter((secret) => secret.length >= MIN_SECRET_LENGTH)
		.sort((a, b) => b.length - a.length)
	return redactDeep(value, secrets)
}
