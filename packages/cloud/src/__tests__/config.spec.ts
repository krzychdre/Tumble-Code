import { describe, it, expect, beforeEach } from "vitest"

import {
	PRODUCTION_CLERK_BASE_URL,
	PRODUCTION_ROO_CODE_API_URL,
	PRODUCTION_ROO_CODE_PROVIDER_URL,
	getClerkBaseUrl,
	getRooCodeApiUrl,
	getRooCodeProviderUrl,
	setClerkBaseUrl,
	setRooCodeApiUrl,
	setRooCodeProviderUrl,
} from "../config.js"

describe("cloud config", () => {
	beforeEach(() => {
		// Reset runtime overrides between tests
		setClerkBaseUrl(undefined)
		setRooCodeApiUrl(undefined)
		setRooCodeProviderUrl(undefined)

		// Clear any env vars set during tests
		delete process.env.CLERK_BASE_URL
		delete process.env.ROO_CODE_API_URL
		delete process.env.ROO_CODE_PROVIDER_URL
	})

	describe("default values", () => {
		it("should return production Clerk base URL by default", () => {
			expect(getClerkBaseUrl()).toBe(PRODUCTION_CLERK_BASE_URL)
			expect(getClerkBaseUrl()).toBe("https://clerk.roocode.com")
		})

		it("should return production Roo Code API URL by default", () => {
			expect(getRooCodeApiUrl()).toBe(PRODUCTION_ROO_CODE_API_URL)
			expect(getRooCodeApiUrl()).toBe("https://app.roocode.com")
		})

		it("should return production Roo Code Provider URL by default", () => {
			expect(getRooCodeProviderUrl()).toBe(PRODUCTION_ROO_CODE_PROVIDER_URL)
			expect(getRooCodeProviderUrl()).toBe("https://api.roocode.com/proxy")
		})
	})

	describe("environment variable overrides", () => {
		it("should use CLERK_BASE_URL env var when set", () => {
			process.env.CLERK_BASE_URL = "https://custom-clerk.example.com"
			expect(getClerkBaseUrl()).toBe("https://custom-clerk.example.com")
			delete process.env.CLERK_BASE_URL
		})

		it("should use ROO_CODE_API_URL env var when set", () => {
			process.env.ROO_CODE_API_URL = "https://custom-api.example.com"
			expect(getRooCodeApiUrl()).toBe("https://custom-api.example.com")
			delete process.env.ROO_CODE_API_URL
		})

		it("should use ROO_CODE_PROVIDER_URL env var when set", () => {
			process.env.ROO_CODE_PROVIDER_URL = "https://custom-proxy.example.com/proxy"
			expect(getRooCodeProviderUrl()).toBe("https://custom-proxy.example.com/proxy")
			delete process.env.ROO_CODE_PROVIDER_URL
		})
	})

	describe("runtime overrides", () => {
		it("should override Clerk base URL via setClerkBaseUrl", () => {
			setClerkBaseUrl("https://runtime-clerk.example.com")
			expect(getClerkBaseUrl()).toBe("https://runtime-clerk.example.com")
		})

		it("should override Roo Code API URL via setRooCodeApiUrl", () => {
			setRooCodeApiUrl("https://runtime-api.example.com")
			expect(getRooCodeApiUrl()).toBe("https://runtime-api.example.com")
		})

		it("should override Roo Code Provider URL via setRooCodeProviderUrl", () => {
			setRooCodeProviderUrl("https://runtime-proxy.example.com/proxy")
			expect(getRooCodeProviderUrl()).toBe("https://runtime-proxy.example.com/proxy")
		})

		it("should take precedence over env vars when runtime override is set", () => {
			process.env.ROO_CODE_API_URL = "https://env-api.example.com"
			setRooCodeApiUrl("https://runtime-api.example.com")
			expect(getRooCodeApiUrl()).toBe("https://runtime-api.example.com")
			delete process.env.ROO_CODE_API_URL
		})

		it("should fall back to env var when runtime override is cleared", () => {
			setRooCodeApiUrl("https://runtime-api.example.com")
			setRooCodeApiUrl(undefined) // Clear runtime override
			process.env.ROO_CODE_API_URL = "https://env-api.example.com"
			expect(getRooCodeApiUrl()).toBe("https://env-api.example.com")
			delete process.env.ROO_CODE_API_URL
		})

		it("should fall back to production default when both runtime and env are cleared", () => {
			setRooCodeProviderUrl("https://runtime-proxy.example.com/proxy")
			setRooCodeProviderUrl(undefined) // Clear runtime override
			expect(getRooCodeProviderUrl()).toBe(PRODUCTION_ROO_CODE_PROVIDER_URL)
		})
	})
})
