// cd src && ./node_modules/.bin/vitest run core/config/__tests__/ModeConfig.spec.ts

// The rules we added on top of the plain field types in @tumble-code/types
// (mode.ts): slug format, trimmed role definition, file regex check, unique
// groups and slugs, and dropping the retired "browser" group.

import { customModesSettingsSchema, modeConfigSchema, type ModeConfig } from "@tumble-code/types"

const mode = (extra: Record<string, unknown> = {}) => ({
	slug: "test",
	name: "Test",
	roleDefinition: "role",
	groups: ["read"],
	...extra,
})

const issues = (result: { success: boolean; error?: { issues: { message: string }[] } }) =>
	result.success ? [] : result.error!.issues.map((issue) => issue.message)

describe("modeConfigSchema", () => {
	it.each([
		["a slug with spaces", { slug: "has spaces" }, "Slug must contain only letters numbers and dashes"],
		["an empty name", { name: "" }, "Name is required"],
		["a whitespace-only role definition", { roleDefinition: "  \n " }, "Role definition is required"],
		["an invalid file regex", { groups: [["edit", { fileRegex: "[" }]] }, "Invalid regular expression pattern"],
		["a repeated group", { groups: ["read", "read"] }, "Duplicate groups are not allowed"],
		[
			"a group repeated as a tuple",
			{ groups: ["edit", ["edit", { fileRegex: "\\.md$" }]] },
			"Duplicate groups are not allowed",
		],
	])("rejects %s", (_label, extra, message) => {
		expect(issues(modeConfigSchema.safeParse(mode(extra)))).toContain(message)
	})

	it("accepts a valid file regex and trims the role definition", () => {
		const parsed: ModeConfig = modeConfigSchema.parse(
			mode({
				roleDefinition: "  role  ",
				groups: ["read", ["edit", { fileRegex: "\\.md$", description: "md" }]],
			}),
		)

		expect(parsed.roleDefinition).toBe("role")
		expect(parsed.groups).toEqual(["read", ["edit", { fileRegex: "\\.md$", description: "md" }]])
	})

	it.each([
		["a string", ["read", "browser", "edit"], ["read", "edit"]],
		["a tuple", ["read", ["browser", { description: "x" }]], ["read"]],
		["every group", ["browser"], []],
	])("drops the retired browser group given as %s", (_label, groups, expected) => {
		expect(modeConfigSchema.parse(mode({ groups })).groups).toEqual(expected)
	})

	it.each([
		["an unknown group", "unknown"],
		["a group that is not a name", 5],
	])("still rejects %s", (_label, group) => {
		expect(modeConfigSchema.safeParse(mode({ groups: ["read", group] })).success).toBe(false)
	})

	it("treats an empty file regex as no restriction", () => {
		expect(modeConfigSchema.safeParse(mode({ groups: [["edit", { fileRegex: "" }]] })).success).toBe(true)
	})
})

describe("customModesSettingsSchema", () => {
	it("rejects two modes with the same slug", () => {
		expect(issues(customModesSettingsSchema.safeParse({ customModes: [mode(), mode()] }))).toContain(
			"Duplicate mode slugs are not allowed",
		)
	})

	it("drops the browser group in every mode", () => {
		const parsed = customModesSettingsSchema.parse({
			customModes: [
				mode({ groups: ["browser", "read"] }),
				mode({ slug: "b", groups: [["browser", {}], "edit"] }),
			],
		})

		expect(parsed.customModes.map((m) => m.groups)).toEqual([["read"], ["edit"]])
	})
})
