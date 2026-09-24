export const DEFAULT_SUITE_TIMEOUT = 120_000

export function setDefaultSuiteTimeout(context: Mocha.Suite) {
	context.timeout(DEFAULT_SUITE_TIMEOUT)
}

/**
 * Skips the suite when OPENROUTER_API_KEY is not set. Its tests need a real
 * model: they run on the OpenRouter profile that suite/index.ts configures
 * (openai/gpt-4.1), and without a key every request fails with 401 and the
 * test runs into its timeout instead of reporting anything useful.
 */
export function requireOpenRouterKey(context: Mocha.Suite) {
	context.beforeAll(function () {
		if (!process.env.OPENROUTER_API_KEY) {
			console.log(`Skipping "${context.title}": it needs OPENROUTER_API_KEY`)
			this.skip()
		}
	})
}
