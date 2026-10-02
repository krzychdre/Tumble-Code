// pnpm --filter @tumble-code/telemetry test src/__tests__/TelemetryService.provider.spec.ts
//
// Regression: activation sets the provider before the cloud client is
// registered (the cloud starts in the background), and the service used to
// drop a provider set while it had no client. The cloud client then sent every
// event without the app properties, its schema rejected all of them, and the
// cloud metrics lost most of the token usage from 2026-09-29 on.

import type { TelemetryClient, TelemetryPropertiesProvider } from "@tumble-code/types"

import { TelemetryService } from "../TelemetryService.js"

const makeClient = (): TelemetryClient => ({
	setProvider: vi.fn(),
	capture: vi.fn(async () => {}),
	captureException: vi.fn(),
	isTelemetryEnabled: vi.fn(() => true),
	shutdown: vi.fn(),
})

const provider = {} as TelemetryPropertiesProvider

describe("TelemetryService provider", () => {
	it("hands a provider set before any client to the client registered later", () => {
		const service = new TelemetryService([])
		service.setProvider(provider)

		const client = makeClient()
		service.register(client)

		expect(client.setProvider).toHaveBeenCalledWith(provider)
	})

	it("passes a provider set later to every registered client", () => {
		const first = makeClient()
		const second = makeClient()
		const service = new TelemetryService([first])
		service.register(second)

		service.setProvider(provider)

		expect(first.setProvider).toHaveBeenCalledWith(provider)
		expect(second.setProvider).toHaveBeenCalledWith(provider)
	})

	it("registers a client without a provider when none was set", () => {
		const client = makeClient()
		new TelemetryService([]).register(client)

		expect(client.setProvider).not.toHaveBeenCalled()
	})
})
