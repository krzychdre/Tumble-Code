import { readFileSync } from "node:fs"
import { join } from "node:path"

import { internationalZAiModels, mainlandZAiModels } from "../index.js"

// The mainland table is derived from the international one plus per-model overrides. The fixture is
// the hand-written mainland table as it stood before the derivation; when a mainland price or limit
// changes on purpose, update the override and the fixture together.
const fixture: Record<string, unknown> = JSON.parse(
	readFileSync(join(__dirname, "__fixtures__", "zai-mainland-models.json"), "utf8"),
)

describe("mainlandZAiModels", () => {
	it("is deep-equal to the frozen mainland table", () => {
		expect(mainlandZAiModels).toStrictEqual(fixture)
	})

	it("keeps the mainland model order", () => {
		expect(Object.keys(mainlandZAiModels)).toEqual(Object.keys(fixture))
	})

	it("does not share or mutate the international entries", () => {
		expect(mainlandZAiModels["glm-5.3"]).not.toBe(internationalZAiModels["glm-5.3"])
		expect(internationalZAiModels["glm-5.3"].inputPrice).toBe(1.4)
		expect(internationalZAiModels["glm-4.6"].contextWindow).toBe(200_000)
	})
})
