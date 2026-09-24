import path from "path"
import { pathToFileURL } from "url"

import type { ProviderSettings } from "@roo-code/types"

/**
 * Test seam for the CLI integration suite (apps/cli/scripts/integration).
 *
 * When this variable names a module, the extension runs on the hidden
 * `fake-ai` provider with the scripted model that module default-exports,
 * whatever provider the flags and settings resolved. The suite uses it to
 * drive the real CLI and extension without a network or an API key. It is
 * unset in normal use, and `fake-ai` stays out of `--provider`.
 */
export const FAKE_AI_MODULE_ENV = "ROO_CLI_FAKE_AI_MODULE"

/**
 * The provider settings that select the fake model, or undefined when the
 * variable is unset. The fake is handed over as the live object: the
 * extension runs in this process, and FakeAIHandler calls its functions.
 */
export async function loadFakeAiProviderSettings(
	env: NodeJS.ProcessEnv = process.env,
): Promise<ProviderSettings | undefined> {
	const modulePath = env[FAKE_AI_MODULE_ENV]

	if (!modulePath) {
		return undefined
	}

	const module = (await import(pathToFileURL(path.resolve(modulePath)).href)) as { default?: unknown }
	const fakeAi = module.default as { id?: unknown; createMessage?: unknown } | undefined

	if (!fakeAi || typeof fakeAi.id !== "string" || typeof fakeAi.createMessage !== "function") {
		throw new Error(
			`${FAKE_AI_MODULE_ENV}: ${modulePath} must default-export a fake model with an id and createMessage()`,
		)
	}

	return { apiProvider: "fake-ai", fakeAi }
}
