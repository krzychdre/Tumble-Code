// npx vitest services/marketplace/__tests__/marketplace-files.spec.ts
//
// Validates the real marketplace files at the repo root (marketplace/), the
// same files RemoteConfigLoader downloads from GitHub. Both levels are checked:
// the marketplace item itself and, for modes, the custom mode inside `content`
// that SimpleInstaller hands to CustomModesManager.importModeWithRules.

import * as fs from "fs"
import * as path from "path"
import * as yaml from "yaml"

import { mcpMarketplaceItemSchema, modeConfigSchema, modeMarketplaceItemSchema } from "@tumble-code/types"

const marketplaceDir = path.resolve(__dirname, "../../../../marketplace")

function yamlFiles(folder: string): string[] {
	const dir = path.join(marketplaceDir, folder)
	if (!fs.existsSync(dir)) return []
	return fs
		.readdirSync(dir)
		.filter((name) => /\.ya?ml$/i.test(name))
		.sort()
}

function readYaml(folder: string, name: string): unknown {
	return yaml.parse(fs.readFileSync(path.join(marketplaceDir, folder, name), "utf-8"))
}

const modeFiles = yamlFiles("modes")
const mcpFiles = yamlFiles("mcps")

describe("marketplace files in the repo", () => {
	it("ships the example mode", () => {
		expect(modeFiles).toContain("docs-writer.yaml")
	})

	describe.each(modeFiles)("modes/%s", (fileName) => {
		const item = modeMarketplaceItemSchema.parse(readYaml("modes", fileName))

		it("has an id equal to the file name", () => {
			expect(item.id).toBe(fileName.replace(/\.ya?ml$/i, ""))
		})

		it("has no emoji in its name", () => {
			expect(item.name).not.toMatch(/\p{Extended_Pictographic}/u)
		})

		it("carries content that installs as a valid custom mode", () => {
			// Mirrors importModeWithRules: rulesFiles is stripped before validation.
			const { rulesFiles: _rulesFiles, ...modeConfig } = yaml.parse(item.content)
			const result = modeConfigSchema.safeParse(modeConfig)
			expect(result.success, JSON.stringify(result.error?.issues)).toBe(true)
			expect(result.data?.slug).toBe(item.id)
		})
	})

	describe.each(mcpFiles)("mcps/%s", (fileName) => {
		it("matches the MCP item schema", () => {
			const result = mcpMarketplaceItemSchema.safeParse(readYaml("mcps", fileName))
			expect(result.success, JSON.stringify(result.error?.issues)).toBe(true)
		})
	})
})
