import { getClerkBaseUrl, getTumbleCodeApiUrl, setClerkBaseUrl, setTumbleCodeApiUrl } from "../config.js"

type Sources = {
	runtimeApi?: string
	runtimeClerk?: string
	env?: Record<string, string>
}

const arrange = ({ runtimeApi, runtimeClerk, env = {} }: Sources) => {
	setTumbleCodeApiUrl(runtimeApi)
	setClerkBaseUrl(runtimeClerk)
	for (const [name, value] of Object.entries(env)) {
		vi.stubEnv(name, value)
	}
}

describe("cloud config", () => {
	beforeEach(() => {
		for (const name of ["CLERK_BASE_URL", "TUMBLE_CODE_API_URL", "ROO_CODE_API_URL"]) {
			vi.stubEnv(name, "")
		}
	})

	afterEach(() => {
		setTumbleCodeApiUrl(undefined)
		setClerkBaseUrl(undefined)
		vi.unstubAllEnvs()
	})

	it.each<[string, Sources, string]>([
		["the production default", {}, "https://app.tumblecode.dev"],
		["the former ROO_CODE_API_URL", { env: { ROO_CODE_API_URL: "https://legacy" } }, "https://legacy"],
		[
			"TUMBLE_CODE_API_URL over the former name",
			{ env: { ROO_CODE_API_URL: "https://legacy", TUMBLE_CODE_API_URL: "https://env" } },
			"https://env",
		],
		[
			"the runtime override over the environment",
			{ runtimeApi: "https://rt", env: { TUMBLE_CODE_API_URL: "https://env" } },
			"https://rt",
		],
	])("API URL: %s", (_name, sources, expected) => {
		arrange(sources)

		expect(getTumbleCodeApiUrl()).toBe(expected)
	})

	it.each<[string, Sources, string]>([
		["the production default", {}, "https://auth.tumblecode.dev"],
		[
			"production for the production API URL",
			{ runtimeApi: "https://app.tumblecode.dev" },
			"https://auth.tumblecode.dev",
		],
		// Self-hosted: the server that issued the ticket also serves the Clerk facade.
		[
			"the API URL of a self-hosted server",
			{ env: { TUMBLE_CODE_API_URL: "https://selfhosted" } },
			"https://selfhosted",
		],
		[
			"CLERK_BASE_URL over the self-hosted API URL",
			{ runtimeApi: "http://localhost:8085", env: { CLERK_BASE_URL: "https://clerk-env" } },
			"https://clerk-env",
		],
		[
			"the runtime override over CLERK_BASE_URL",
			{ runtimeClerk: "https://clerk-rt", env: { CLERK_BASE_URL: "https://clerk-env" } },
			"https://clerk-rt",
		],
	])("Clerk URL: %s", (_name, sources, expected) => {
		arrange(sources)

		expect(getClerkBaseUrl()).toBe(expected)
	})
})
