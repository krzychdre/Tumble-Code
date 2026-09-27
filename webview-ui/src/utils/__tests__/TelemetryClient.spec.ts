import type { TelemetryClient } from "../TelemetryClient"

// P4: TelemetryClient loads posthog-js through a dynamic import, only when
// telemetry is enabled. vi.mock factories do NOT re-run for dynamic imports
// after vi.resetModules(), so per-test isolation (fresh client statics AND a
// fresh fetch counter) uses vi.doMock before each dynamic import: the factory
// runs exactly once per actual module fetch, which is precisely the laziness
// signal under test.

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

	const { telemetryClient } = await import("../TelemetryClient")
	return { client: telemetryClient, posthog }
}

describe("TelemetryClient", () => {
	it("is a singleton per module instance", async () => {
		const { client } = await freshClient()
		const constructor = Object.getPrototypeOf(client).constructor
		expect(constructor.getInstance()).toBe(client)
		expect(constructor.getInstance()).toBe(constructor.getInstance())
	})

	it("has updateTelemetryState and capture methods", async () => {
		const { client } = await freshClient()
		expect(typeof client.updateTelemetryState).toBe("function")
		expect(typeof client.capture).toBe("function")
	})

	it("never fetches posthog-js while telemetry stays off", async () => {
		const { client, posthog } = await freshClient()
		await client.updateTelemetryState("disabled")
		await client.updateTelemetryState("unset")
		client.capture("test_event")

		expect(fetches.count).toBe(0)
		expect(posthog.init).not.toHaveBeenCalled()
		expect(posthog.capture).not.toHaveBeenCalled()
	})

	it("fetches and initializes posthog-js exactly once when enabled with key and id", async () => {
		const { client, posthog } = await freshClient()
		await client.updateTelemetryState("enabled", "test-api-key", "test-user-id")

		expect(fetches.count).toBe(1)
		expect(posthog.init).toHaveBeenCalledTimes(1)
		expect(posthog.init).toHaveBeenCalledWith(
			"test-api-key",
			expect.objectContaining({ persistence: "localStorage" }),
		)
	})
})
