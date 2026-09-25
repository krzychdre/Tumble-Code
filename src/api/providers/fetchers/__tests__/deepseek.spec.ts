import { deepSeekModels } from "@roo-code/types"

import { getDeepSeekModels } from "../deepseek"

// DeepSeek's /models lists the ids the key may call. A legacy name DeepSeek
// still serves (an alias in the catalog) must get the info of the model it
// names, not the generic fallback for unknown ids.
describe("getDeepSeekModels", () => {
	const listModels = (ids: string[]) =>
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(JSON.stringify({ object: "list", data: ids.map((id) => ({ id, object: "model" })) }), {
				status: 200,
			}),
		)

	afterEach(() => {
		vi.restoreAllMocks()
	})

	it("describes the current models with their catalog info", async () => {
		listModels(["deepseek-flash", "deepseek-v4-pro"])

		const models = await getDeepSeekModels(undefined, "key")

		expect(models["deepseek-flash"]).toEqual(deepSeekModels["deepseek-flash"])
		expect(models["deepseek-v4-pro"]).toEqual(deepSeekModels["deepseek-v4-pro"])
	})

	it("describes a legacy alias with the info of the model it names", async () => {
		listModels(["deepseek-v4-flash"])

		const models = await getDeepSeekModels(undefined, "key")

		expect(models["deepseek-v4-flash"]).toEqual(deepSeekModels["deepseek-flash"])
	})
})
