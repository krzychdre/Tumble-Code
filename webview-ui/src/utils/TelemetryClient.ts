import type { TelemetrySetting } from "@roo-code/types"

// posthog-js (~120 KB) is only needed when telemetry is enabled, so it is a
// dynamic import: with telemetry off the chunk is never even fetched. The
// module handle is kept so the enabled -> disabled transition can still reset
// a previously loaded instance.
type Posthog = (typeof import("posthog-js"))["default"]

export class TelemetryClient {
	private static instance: TelemetryClient
	private static telemetryEnabled: boolean = false
	private static posthog: Posthog | undefined
	private static posthogLoad: Promise<void> | undefined

	/**
	 * Returns the (already started) posthog-js load when telemetry is being
	 * enabled, so callers and tests can await initialization; `undefined`
	 * when telemetry is off (nothing is fetched).
	 */
	public updateTelemetryState(
		telemetrySetting: TelemetrySetting,
		apiKey?: string,
		distinctId?: string,
	): Promise<void> | undefined {
		if (telemetrySetting !== "disabled" && apiKey && distinctId) {
			// Flips telemetryEnabled only after posthog has loaded and been
			// initialized, so an early capture() cannot fire before init.
			// Events arriving during the load are dropped, matching the
			// existing silent-drop behavior of the capture try/catch.
			TelemetryClient.posthogLoad ??= import("posthog-js").then(
				(module) => {
					const posthog = module.default
					posthog.init(apiKey, {
						api_host: "https://ph.roocode.com",
						ui_host: "https://us.posthog.com",
						persistence: "localStorage",
						loaded: () => posthog.identify(distinctId),
						capture_pageview: false,
						capture_pageleave: false,
						autocapture: false,
					})

					TelemetryClient.posthog = posthog
					TelemetryClient.telemetryEnabled = true
				},
				(error) => {
					// Allow a retry on the next updateTelemetryState call.
					TelemetryClient.posthogLoad = undefined
					console.warn("Failed to load posthog-js:", error)
				},
			)

			return TelemetryClient.posthogLoad
		}

		TelemetryClient.telemetryEnabled = false

		// reset() is only meaningful for a previously loaded instance.
		try {
			TelemetryClient.posthog?.reset()
		} catch (_error) {
			// Silently fail if there's an error resetting.
		}

		return undefined
	}

	public static getInstance(): TelemetryClient {
		if (!TelemetryClient.instance) {
			TelemetryClient.instance = new TelemetryClient()
		}

		return TelemetryClient.instance
	}

	public capture(eventName: string, properties?: Record<string, any>) {
		if (TelemetryClient.telemetryEnabled) {
			try {
				TelemetryClient.posthog?.capture(eventName, properties)
			} catch (_error) {
				// Silently fail if there's an error capturing an event.
			}
		}
	}
}

export const telemetryClient = TelemetryClient.getInstance()
