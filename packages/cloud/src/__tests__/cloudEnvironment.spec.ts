// npx vitest run src/__tests__/cloudEnvironment.spec.ts

import { resolveCloudEnvironment } from "../cloudEnvironment.js"

describe("resolveCloudEnvironment", () => {
	it("returns nothing for an empty environment", () => {
		expect(resolveCloudEnvironment({})).toEqual({ staticToken: undefined, staticOrgSettings: undefined })
	})

	it("treats empty strings as unset", () => {
		expect(resolveCloudEnvironment({ ROO_CODE_CLOUD_TOKEN: "", ROO_CODE_CLOUD_ORG_SETTINGS: "" })).toEqual({
			staticToken: undefined,
			staticOrgSettings: undefined,
		})
	})

	it("passes both values through unchanged", () => {
		expect(
			resolveCloudEnvironment({ ROO_CODE_CLOUD_TOKEN: " tok ", ROO_CODE_CLOUD_ORG_SETTINGS: "e30=" }),
		).toEqual({ staticToken: " tok ", staticOrgSettings: "e30=" })
	})

	it("ignores unrelated variables", () => {
		expect(resolveCloudEnvironment({ ROO_CODE_API_URL: "https://x" })).toEqual({
			staticToken: undefined,
			staticOrgSettings: undefined,
		})
	})

	it("reads process.env by default", () => {
		vi.stubEnv("ROO_CODE_CLOUD_TOKEN", "from-process")
		try {
			expect(resolveCloudEnvironment().staticToken).toBe("from-process")
		} finally {
			vi.unstubAllEnvs()
		}
	})
})
