// cd src && npx vitest run core/task/__tests__/ApiRequestBuilder.provider-capabilities.spec.ts

import { ApiRequestBuilder, type ApiRequestBuilderAccess } from "../ApiRequestBuilder"

const buildToolsMock = vi.hoisted(() => vi.fn().mockResolvedValue({ tools: [], allowedFunctionNames: undefined }))
vi.mock("../build-tools", () => ({ buildNativeToolsArrayWithRestrictions: buildToolsMock }))

/**
 * API-6: whether a request declares every tool and restricts the callable ones
 * (instead of dropping the tools the mode may not use) is the provider's
 * `allowedFunctionNames` capability, not a provider-name check.
 */
describe("ApiRequestBuilder tool restrictions follow the provider capability", () => {
	const buildTools = async (apiProvider: string) => {
		buildToolsMock.mockClear()
		const access = {
			taskId: "task-1",
			providerRef: { deref: () => ({}) },
			cwd: "/workspace",
			isBackground: false,
			materializedDeferredTools: new Set<string>(),
			deferredToolDirectory: new Map(),
		} as unknown as ApiRequestBuilderAccess

		await new ApiRequestBuilder(access).buildToolsArray({}, { apiProvider } as never, "code", {})

		return buildToolsMock.mock.calls[0][0].includeAllToolsWithRestrictions
	}

	it.each([
		["gemini", true],
		["vertex", false],
		["anthropic", false],
		["gemini-cli", false],
	])("%s: includeAllToolsWithRestrictions is %s", async (apiProvider, expected) => {
		expect(await buildTools(apiProvider)).toBe(expected)
	})
})
