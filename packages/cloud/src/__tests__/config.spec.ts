import { describe, it, expect, beforeEach } from "vitest"

import * as cloudConfig from "../config.js"

import {
	PRODUCTION_CLERK_BASE_URL,
	PRODUCTION_TUMBLE_CODE_API_URL,
	getClerkBaseUrl,
	getTumbleCodeApiUrl,
	setClerkBaseUrl,
	setTumbleCodeApiUrl,
} from "../config.js"

describe("cloud config", () => {
	beforeEach(() => {
		// Reset runtime overrides between tests
		setClerkBaseUrl(undefined)
		setTumbleCodeApiUrl(undefined)

		// Clear any env vars set during tests
		delete process.env.CLERK_BASE_URL
		delete process.env.TUMBLE_CODE_API_URL
		delete process.env.ROO_CODE_API_URL
	})

	describe("default values", () => {
		it("should return production Clerk base URL by default", () => {
			expect(getClerkBaseUrl()).toBe(PRODUCTION_CLERK_BASE_URL)
			expect(getClerkBaseUrl()).toBe("https://auth.tumblecode.dev")
		})

		it("should return production Tumble Code API URL by default", () => {
			expect(getTumbleCodeApiUrl()).toBe(PRODUCTION_TUMBLE_CODE_API_URL)
			expect(getTumbleCodeApiUrl()).toBe("https://app.tumblecode.dev")
		})
	})

	describe("environment variable overrides", () => {
		it("should use CLERK_BASE_URL env var when set", () => {
			process.env.CLERK_BASE_URL = "https://custom-clerk.example.com"
			expect(getClerkBaseUrl()).toBe("https://custom-clerk.example.com")
			delete process.env.CLERK_BASE_URL
		})

		it("should use TUMBLE_CODE_API_URL env var when set", () => {
			process.env.TUMBLE_CODE_API_URL = "https://custom-api.example.com"
			expect(getTumbleCodeApiUrl()).toBe("https://custom-api.example.com")
			delete process.env.TUMBLE_CODE_API_URL
		})

		it("still reads the former ROO_CODE_API_URL, but TUMBLE_CODE_API_URL wins", () => {
			process.env.ROO_CODE_API_URL = "https://legacy-api.example.com"
			expect(getTumbleCodeApiUrl()).toBe("https://legacy-api.example.com")
			process.env.TUMBLE_CODE_API_URL = "https://custom-api.example.com"
			expect(getTumbleCodeApiUrl()).toBe("https://custom-api.example.com")
		})
	})

	describe("runtime overrides", () => {
		it("should override Clerk base URL via setClerkBaseUrl", () => {
			setClerkBaseUrl("https://runtime-clerk.example.com")
			expect(getClerkBaseUrl()).toBe("https://runtime-clerk.example.com")
		})

		it("should override Roo Code API URL via setTumbleCodeApiUrl", () => {
			setTumbleCodeApiUrl("https://runtime-api.example.com")
			expect(getTumbleCodeApiUrl()).toBe("https://runtime-api.example.com")
		})

		it("should take precedence over env vars when runtime override is set", () => {
			process.env.TUMBLE_CODE_API_URL = "https://env-api.example.com"
			setTumbleCodeApiUrl("https://runtime-api.example.com")
			expect(getTumbleCodeApiUrl()).toBe("https://runtime-api.example.com")
			delete process.env.TUMBLE_CODE_API_URL
		})

		it("should fall back to env var when runtime override is cleared", () => {
			setTumbleCodeApiUrl("https://runtime-api.example.com")
			setTumbleCodeApiUrl(undefined) // Clear runtime override
			process.env.TUMBLE_CODE_API_URL = "https://env-api.example.com"
			expect(getTumbleCodeApiUrl()).toBe("https://env-api.example.com")
			delete process.env.TUMBLE_CODE_API_URL
		})

		it("should fall back to production default when both runtime and env are cleared", () => {
			setTumbleCodeApiUrl("https://runtime-api.example.com")
			setTumbleCodeApiUrl(undefined) // Clear runtime override
			expect(getTumbleCodeApiUrl()).toBe(PRODUCTION_TUMBLE_CODE_API_URL)
		})
	})

	describe("Clerk base URL auto-detect for self-hosted deployments", () => {
		it("should auto-detect Clerk base URL from Roo Code API URL when API URL is non-production", () => {
			// Simulate self-hosted: only cloudApiUrl is set, clerkBaseUrl is not set
			setTumbleCodeApiUrl("http://localhost:8085")
			expect(getClerkBaseUrl()).toBe("http://localhost:8085")
		})

		it("should auto-detect Clerk base URL from TUMBLE_CODE_API_URL env var when no explicit Clerk override", () => {
			process.env.TUMBLE_CODE_API_URL = "https://my-selfhosted.example.com"
			expect(getClerkBaseUrl()).toBe("https://my-selfhosted.example.com")
			delete process.env.TUMBLE_CODE_API_URL
		})

		it("should use explicit CLERK_BASE_URL env var instead of auto-detect from API URL", () => {
			process.env.TUMBLE_CODE_API_URL = "https://my-selfhosted.example.com"
			process.env.CLERK_BASE_URL = "https://explicit-clerk.example.com"
			expect(getClerkBaseUrl()).toBe("https://explicit-clerk.example.com")
			delete process.env.TUMBLE_CODE_API_URL
			delete process.env.CLERK_BASE_URL
		})

		it("should use explicit runtime setClerkBaseUrl instead of auto-detect from API URL", () => {
			setTumbleCodeApiUrl("http://localhost:8085")
			setClerkBaseUrl("https://explicit-clerk.example.com")
			expect(getClerkBaseUrl()).toBe("https://explicit-clerk.example.com")
		})

		it("should return production Clerk URL when API URL is production", () => {
			setTumbleCodeApiUrl("https://app.tumblecode.dev")
			expect(getClerkBaseUrl()).toBe(PRODUCTION_CLERK_BASE_URL)
		})

		it("should return production Clerk URL when no API URL override is set", () => {
			// No overrides at all — both are production defaults
			expect(getClerkBaseUrl()).toBe(PRODUCTION_CLERK_BASE_URL)
		})

		it("should auto-detect Clerk URL from runtime API URL override even when env var for API URL is different", () => {
			process.env.TUMBLE_CODE_API_URL = "https://env-api.example.com"
			setTumbleCodeApiUrl("http://localhost:8085")
			// Runtime override takes precedence for API URL, and Clerk auto-detects from it
			expect(getClerkBaseUrl()).toBe("http://localhost:8085")
			delete process.env.TUMBLE_CODE_API_URL
		})

		it("should auto-detect Clerk URL from env-based API URL when runtime API URL is not set", () => {
			process.env.TUMBLE_CODE_API_URL = "https://selfhosted.example.com"
			// No runtime API URL override, so env var is used for API URL
			// Clerk should auto-detect from the env-based API URL
			expect(getClerkBaseUrl()).toBe("https://selfhosted.example.com")
			delete process.env.TUMBLE_CODE_API_URL
		})
	})

	describe("removed cloud provider URL (D15)", () => {
		// The cloud proxy provider that read ROO_CODE_PROVIDER_URL is gone; the
		// getter had no caller outside tests, so the variable and its
		// cloudProviderUrl setting were accepted but never used.
		it("exports no provider URL getter, setter or default", () => {
			const names = Object.keys(cloudConfig).filter((name) => /ProviderUrl|PROVIDER_URL/.test(name))
			expect(names).toEqual([])
		})
	})
})
