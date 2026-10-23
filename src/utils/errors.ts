import { serializeError } from "serialize-error"

export class OrganizationAllowListViolationError extends Error {
	constructor(message: string) {
		super(message)
	}
}

/**
 * `serializeError` for a caught value. A thrown string, number or `null` comes back unchanged, as it did
 * before serialize-error 13 began wrapping primitives in a "Non-error value: ..." `NonError`.
 */
export function serializeThrown(value: unknown): unknown {
	return typeof value === "object" && value !== null ? serializeError(value) : value
}
