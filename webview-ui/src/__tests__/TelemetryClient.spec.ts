import type { TelemetryClient } from "@src/utils/TelemetryClient"

// P4: TelemetryClient loads posthog-js through a dynamic import, only when
// telemetry is enabled. vi.mock factories do NOT re-run for dynamic imports
// after vi.resetModules(), so per-test isolation (fresh client statics AND a
// fresh fetch counter) uses vi.doMock before each dynamic import: the factory
// runs exactly once per actual module fetch, which is precisely the laziness
// signal under test.
const API_KEY = "test-api-key"
const DISTINCT_ID = "test-user-id"

interface PosthogMock {
	reset: ReturnType<typeof vi.fn>
	init: ReturnType<typeof vi.fn>
	identify: ReturnType<typeof vi.fn>
	capture: ReturnType<typeof vi.fn>
}

const makePosthogMock = (): PosthogMock => ({
	reset: vi.fn(),
	init: vi.fn(),
	identify: vi.fn(),
	capture: vi.fn(),
})

// Fetch counter: incremented by the vi.doMock factory, i.e. exactly once per
// actual module fetch. Reset by freshClient() before each dynamic import.
const fetches = { count: 0 }

const freshClient = async (): Promise<{ client: TelemetryClient; posthog: PosthogMock }> => {
	vi.resetModules()
	fetches.count = 0
	const posthog = makePosthogMock()

	vi.doMock("posthog-js", () => {
		fetches.count++
		return { default: posthog }
	})

	const { telemetryClient } = await import("@src/utils/TelemetryClient")
	return { client: telemetryClient, posthog }
}

describe("TelemetryClient", () => {
	it("is a singleton per module instance", async () => {
		const { client } = await freshClient()
		const constructor = Object.getPrototypeOf(client).constructor
		expect(constructor.getInstance()).toBe(client)
		expect(constructor.getInstance()).toBe(constructor.getInstance())
	})

	it("never imports posthog-js when telemetry is disabled", async () => {
		const { client, posthog } = await freshClient()
		await client.updateTelemetryState("disabled")
		expect(fetches.count).toBe(0)
		expect(posthog.init).not.toHaveBeenCalled()
	})

	it("never imports posthog-js when telemetry is unset", async () => {
		const { client, posthog } = await freshClient()
		await client.updateTelemetryState("unset")
		expect(fetches.count).toBe(0)
		expect(posthog.init).not.toHaveBeenCalled()
	})

	it("never imports posthog-js when enabled but apiKey or distinctId is missing", async () => {
		const { client } = await freshClient()
		await client.updateTelemetryState("enabled")
		expect(fetches.count).toBe(0)

		await client.updateTelemetryState("enabled", API_KEY)
		expect(fetches.count).toBe(0)
	})

	it("imports and initializes posthog-js once when telemetry is enabled with API key and distinctId", async () => {
		const { client, posthog } = await freshClient()
		await client.updateTelemetryState("enabled", API_KEY, DISTINCT_ID)

		expect(fetches.count).toBe(1)
		expect(posthog.init).toHaveBeenCalledWith(
			API_KEY,
			expect.objectContaining({
				api_host: "https://ph.roocode.com",
				persistence: "localStorage",
				loaded: expect.any(Function),
			}),
		)

		// The loaded callback identifies the machine once posthog is ready.
		const loaded = posthog.init.mock.calls[0][1].loaded as () => void
		loaded()
		expect(posthog.identify).toHaveBeenCalledWith(DISTINCT_ID)
	})

	it("does not fetch or initialize twice when updateTelemetryState runs again while enabled", async () => {
		const { client, posthog } = await freshClient()
		await client.updateTelemetryState("enabled", API_KEY, DISTINCT_ID)
		await client.updateTelemetryState("enabled", API_KEY, DISTINCT_ID)

		expect(fetches.count).toBe(1)
		expect(posthog.init).toHaveBeenCalledTimes(1)
	})

	it("drops events captured before the posthog chunk has loaded", async () => {
		const { client, posthog } = await freshClient()
		// updateTelemetryState is async now: capture() arriving before the
		// load resolves must not throw and must not capture.
		const pending = client.updateTelemetryState("enabled", API_KEY, DISTINCT_ID)
		client.capture("test_event")
		await pending

		expect(posthog.capture).not.toHaveBeenCalled()
	})

	it("captures events once telemetry is enabled and loaded", async () => {
		const { client, posthog } = await freshClient()
		await client.updateTelemetryState("enabled", API_KEY, DISTINCT_ID)
		vi.clearAllMocks()

		client.capture("test_event", { property: "value" })

		expect(posthog.capture).toHaveBeenCalledWith("test_event", { property: "value" })
	})

	it("does not capture when telemetry is disabled", async () => {
		const { client, posthog } = await freshClient()
		await client.updateTelemetryState("enabled", API_KEY, DISTINCT_ID)
		await client.updateTelemetryState("disabled")
		vi.clearAllMocks()

		client.capture("test_event")

		expect(posthog.capture).not.toHaveBeenCalled()
	})

	it("resets a previously loaded posthog when telemetry flips to disabled", async () => {
		const { client, posthog } = await freshClient()
		await client.updateTelemetryState("enabled", API_KEY, DISTINCT_ID)
		await client.updateTelemetryState("disabled")

		expect(posthog.reset).toHaveBeenCalled()
	})

	it("does not throw when capture is called with telemetry never enabled", async () => {
		const { client } = await freshClient()
		expect(() => client.capture("test_event")).not.toThrow()
	})
})
