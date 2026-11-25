import { readVscodeProfiles } from "../vscode-profiles.js"
import { vscodeProfilesEnvelope } from "./vscode-profiles-envelope.js"

describe("readVscodeProfiles", () => {
	it("gives a bound mode its own profile and every other mode the current one", () => {
		const profiles = readVscodeProfiles(vscodeProfilesEnvelope())!

		expect(profiles.boundModes).toEqual(["architect"])
		expect(profiles.forMode("architect")?.connection).toEqual({
			provider: "anthropic",
			model: "claude-opus-5-5",
			baseUrl: undefined,
		})
		const glm = { provider: "openai", model: "GLM-5.3-NVFP4", baseUrl: "http://192.168.50.194:11111/v1" }
		expect(profiles.forMode("code")?.connection).toEqual(glm)
		expect(profiles.forMode(undefined)?.connection).toEqual(glm)
	})

	it("reads a profile's model facts as a models entry would", () => {
		const profiles = readVscodeProfiles(vscodeProfilesEnvelope())!

		expect(profiles.forMode("code")?.modelSettings).toMatchObject({
			contextWindow: 1_048_576,
			preserveReasoning: true,
			reasoningEffort: "high",
			maxConcurrentRequests: 4,
		})
		expect(profiles.forMode("architect")?.modelSettings).toEqual({
			reasoningEffort: "disabled",
			modelSize: "slim",
		})
	})

	it.each([undefined, { schemaVersion: 1, apiConfigs: {} }])("reads nothing from %j", (envelope) => {
		expect(readVscodeProfiles(envelope)).toBeUndefined()
	})
})
