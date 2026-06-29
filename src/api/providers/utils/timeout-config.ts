import * as vscode from "vscode"
import { Package } from "../../../shared/package"

const DEFAULT_TIMEOUT_SECONDS = 600
const MIN_TIMEOUT_SECONDS = 1
const MAX_TIMEOUT_SECONDS = 3600

function isValidTimeout(value: unknown): value is number {
	return typeof value === "number" && !isNaN(value) && value >= MIN_TIMEOUT_SECONDS && value <= MAX_TIMEOUT_SECONDS
}

/**
 * Gets the API request timeout from VSCode configuration with validation.
 *
 * @returns The timeout in milliseconds. Out-of-range, NaN, or non-number values
 *          fall back to the default. Rounded to an integer so SDK positive-integer
 *          validation (e.g. the Anthropic SDK) never sees a float.
 */
export function getApiRequestTimeout(): number {
	const configTimeout = vscode.workspace
		.getConfiguration(Package.name)
		.get<number>("apiRequestTimeout", DEFAULT_TIMEOUT_SECONDS)

	const seconds = isValidTimeout(configTimeout) ? configTimeout : DEFAULT_TIMEOUT_SECONDS
	return Math.round(seconds * 1000)
}
