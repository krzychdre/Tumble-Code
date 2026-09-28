import {
	getZaiApiLineConfig,
	internationalZAiModels,
	isZaiChinaLine,
	mainlandZAiModels,
	zaiApiLineConfigs,
	zaiApiLineSchema,
	zaiModelCatalog,
} from "../index.js"

// Regression (Z.ai China API): every China line must pick the mainland model list, on the request
// side (`zaiModelCatalog`) and in the settings UI, which both go through `isZaiChinaLine`.
describe("Z.ai API lines", () => {
	it.each([
		[undefined, false],
		["international_coding", false],
		["international_api", false],
		["china_coding", true],
		["china_api", true],
	] as const)("%s: isZaiChinaLine is %s", (line, expected) => {
		expect(isZaiChinaLine(line)).toBe(expected)
	})

	it("an unset line is International Coding", () => {
		expect(getZaiApiLineConfig(undefined)).toBe(zaiApiLineConfigs.international_coding)
	})

	it("every China line is on the mainland host, every other line is not", () => {
		for (const line of zaiApiLineSchema.options) {
			expect(isZaiChinaLine(line)).toBe(getZaiApiLineConfig(line).baseUrl.startsWith("https://open.bigmodel.cn/"))
		}
	})

	it.each(zaiApiLineSchema.options)("%s: the model catalog follows the line", (line) => {
		const catalog = zaiModelCatalog({ zaiApiLine: line })
		expect(catalog.models).toBe(isZaiChinaLine(line) ? mainlandZAiModels : internationalZAiModels)
	})
})
