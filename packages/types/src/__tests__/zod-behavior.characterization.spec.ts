/**
 * Characterization of the zod behavior our shared schemas depend on (DEP-8, zod 3 to zod 4).
 *
 * Every case here passed on zod 3.25.76 before the switch. The expectations that changed with zod 4
 * are the default messages (zod 3 said "Required" and "Expected string, received number"; zod 4 says
 * "Invalid input: expected string, received undefined"); they are listed in the changeset.
 * The cases fall into three groups:
 * - parse results that other code relies on (partial records, defaults, coercion, null handling);
 * - validation messages that reach the user (custom modes, settings import) or the model;
 * - the shape of the issues list (path and message), because callers join them into text.
 *
 * When a zod upgrade changes one of these, the change has to be deliberate and listed in the
 * changeset, not discovered by a user.
 */

import { z } from "zod"

import { toolUsageSchema } from "../tool.js"
import { customModesSettingsSchema, groupEntryArraySchema, modeConfigSchema } from "../mode.js"
import { organizationAllowListSchema, organizationSettingsSchema, userSettingsDataSchema } from "../cloud.js"
import { installMarketplaceItemOptionsSchema, mcpParameterSchema } from "../marketplace.js"
import { globalSettingsSchema } from "../global-settings.js"
import { RooCodeEventName, taskEventSchema } from "../events.js"

/** The exact text CustomModesManager shows for a broken .roomodes file. */
const formatIssues = (error: z.ZodError) => error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`)

const validMode = {
	slug: "my-mode",
	name: "My Mode",
	roleDefinition: "You are a tester.",
	groups: ["read"],
}

describe("zod behavior characterization (DEP-8)", () => {
	describe("records keyed by an enum stay partial", () => {
		it("accepts a tool usage record that names only some tools", () => {
			const usage = { read_file: { attempts: 2, failures: 1 } }
			expect(toolUsageSchema.parse(usage)).toEqual(usage)
		})

		it("accepts an empty tool usage record", () => {
			expect(toolUsageSchema.parse({})).toEqual({})
		})

		it("rejects a tool name that is not in the enum", () => {
			expect(toolUsageSchema.safeParse({ not_a_tool: { attempts: 1, failures: 0 } }).success).toBe(false)
		})

		it("keeps a partial toolUsage in a TaskCompleted event payload", () => {
			const payload = [
				"task-1",
				{ totalTokensIn: 1, totalTokensOut: 2, totalCost: 0, contextTokens: 3 },
				{ execute_command: { attempts: 1, failures: 0 } },
				{ isSubtask: false },
			]
			const parsed = taskEventSchema.parse({ eventName: RooCodeEventName.TaskCompleted, payload })
			if (parsed.eventName !== RooCodeEventName.TaskCompleted) throw new Error("wrong event")
			expect(parsed.payload[2]).toEqual({ execute_command: { attempts: 1, failures: 0 } })
		})
	})

	describe("organization allow list", () => {
		it("accepts arbitrary provider names as keys", () => {
			const allowList = { allowAll: false, providers: { "some-provider": { allowAll: true } } }
			expect(organizationAllowListSchema.parse(allowList)).toEqual(allowList)
		})
	})

	describe("cloud settings: optional fields reject null (the cloud API must exclude None)", () => {
		const organization = {
			version: 1,
			defaultSettings: {},
			allowList: { allowAll: true, providers: {} },
		}

		it("accepts a minimal organization settings object", () => {
			expect(organizationSettingsSchema.safeParse(organization).success).toBe(true)
		})

		it("rejects null in an optional organization field", () => {
			const result = organizationSettingsSchema.safeParse({ ...organization, cloudSettings: null })
			expect(result.success).toBe(false)
			expect(result.error?.issues.map((issue) => issue.path.join("."))).toEqual(["cloudSettings"])
		})

		it("rejects null in an optional nested cloud setting", () => {
			const result = organizationSettingsSchema.safeParse({
				...organization,
				cloudSettings: { enableTaskSharing: null },
			})
			expect(result.success).toBe(false)
			expect(result.error?.issues.map((issue) => issue.path.join("."))).toEqual([
				"cloudSettings.enableTaskSharing",
			])
		})

		it("rejects null in an optional user setting", () => {
			const result = userSettingsDataSchema.safeParse({
				features: {},
				settings: { taskSyncEnabled: null },
				version: 1,
			})
			expect(result.success).toBe(false)
			expect(result.error?.issues.map((issue) => issue.path.join("."))).toEqual(["settings.taskSyncEnabled"])
		})

		it("strips unknown keys from organization settings", () => {
			const parsed = organizationSettingsSchema.parse({ ...organization, somethingNew: true })
			expect(parsed).not.toHaveProperty("somethingNew")
		})

		it("rejects a negative integer default setting", () => {
			const result = organizationSettingsSchema.safeParse({
				...organization,
				defaultSettings: { maxOpenTabsContext: -1 },
			})
			expect(result.success).toBe(false)
		})
	})

	describe("defaults", () => {
		it("fills marketplace install defaults", () => {
			expect(installMarketplaceItemOptionsSchema.parse({})).toEqual({ target: "project" })
			expect(mcpParameterSchema.parse({ name: "n", key: "k" })).toEqual({ name: "n", key: "k", optional: false })
		})

		it("keeps an explicit marketplace target", () => {
			expect(installMarketplaceItemOptionsSchema.parse({ target: "global" })).toEqual({ target: "global" })
		})
	})

	describe("mode config", () => {
		it("accepts a valid mode and trims the role definition", () => {
			expect(modeConfigSchema.parse({ ...validMode, roleDefinition: "  Tester  " }).roleDefinition).toBe("Tester")
		})

		it("strips the deprecated browser group before validating", () => {
			expect(groupEntryArraySchema.parse(["read", "browser", ["edit", { fileRegex: "\\.md$" }]])).toEqual([
				"read",
				["edit", { fileRegex: "\\.md$" }],
			])
		})

		it("reports custom messages for slug, name and role definition", () => {
			const result = modeConfigSchema.safeParse({ ...validMode, slug: "bad slug", name: "", roleDefinition: " " })
			expect(result.success).toBe(false)
			expect(formatIssues(result.error!)).toEqual([
				"slug: Slug must contain only letters numbers and dashes",
				"name: Name is required",
				"roleDefinition: Role definition is required",
			])
		})

		it("reports duplicate groups", () => {
			const result = modeConfigSchema.safeParse({ ...validMode, groups: ["read", "read"] })
			expect(formatIssues(result.error!)).toEqual(["groups: Duplicate groups are not allowed"])
		})

		it("reports an invalid file regex inside a group tuple", () => {
			const result = modeConfigSchema.safeParse({ ...validMode, groups: [["edit", { fileRegex: "[" }]] })
			expect(result.success).toBe(false)
			expect(result.error!.issues).toHaveLength(1)
			expect(result.error!.issues[0]!.path.slice(0, 2)).toEqual(["groups", 0])
		})

		it("reports an unknown group name at its index", () => {
			const result = modeConfigSchema.safeParse({ ...validMode, groups: ["read", "flying"] })
			expect(result.success).toBe(false)
			expect(result.error!.issues).toHaveLength(1)
			expect(result.error!.issues[0]!.path).toEqual(["groups", 1])
		})

		it("reports a missing required field with the field name in the path", () => {
			const { name: _name, ...withoutName } = validMode
			const result = modeConfigSchema.safeParse(withoutName)
			expect(result.success).toBe(false)
			expect(result.error!.issues.map((issue) => issue.path.join("."))).toEqual(["name"])
		})

		it("reports duplicate slugs in a custom modes file", () => {
			const result = customModesSettingsSchema.safeParse({ customModes: [validMode, validMode] })
			expect(formatIssues(result.error!)).toEqual(["customModes: Duplicate mode slugs are not allowed"])
		})
	})

	describe("zod default messages that reach the user (.roomodes, custom_modes.yaml, mode dialogs)", () => {
		it("missing field", () => {
			const { name: _name, ...withoutName } = validMode
			expect(formatIssues(modeConfigSchema.safeParse(withoutName).error!)).toEqual([
				"name: Invalid input: expected string, received undefined",
			])
		})

		it("wrong type", () => {
			expect(formatIssues(modeConfigSchema.safeParse({ ...validMode, name: 42 }).error!)).toEqual([
				"name: Invalid input: expected string, received number",
			])
		})

		it("unknown group name", () => {
			expect(formatIssues(modeConfigSchema.safeParse({ ...validMode, groups: ["flying"] }).error!)).toEqual([
				"groups.0: Invalid input",
			])
		})

		it("invalid file regex", () => {
			expect(
				formatIssues(
					modeConfigSchema.safeParse({ ...validMode, groups: [["edit", { fileRegex: "[" }]] }).error!,
				),
			).toEqual(["groups.0.1.fileRegex: Invalid regular expression pattern"])
		})

		it("unknown source", () => {
			expect(formatIssues(modeConfigSchema.safeParse({ ...validMode, source: "team" }).error!)).toEqual([
				'source: Invalid option: expected one of "global"|"project"',
			])
		})

		it("groups is not an array", () => {
			expect(formatIssues(modeConfigSchema.safeParse({ ...validMode, groups: "read" }).error!)).toEqual([
				"groups: Invalid input: expected array, received string",
			])
		})

		it("customModes is missing", () => {
			expect(formatIssues(customModesSettingsSchema.safeParse({}).error!)).toEqual([
				"customModes: Invalid input: expected array, received undefined",
			])
		})
	})

	describe("global settings", () => {
		it("strips unknown keys", () => {
			expect(globalSettingsSchema.parse({ somethingUnknown: 1 })).toEqual({})
		})

		it("rejects a checkpoint timeout that is not an integer", () => {
			expect(globalSettingsSchema.safeParse({ checkpointTimeout: 15.5 }).success).toBe(false)
		})
	})
})
