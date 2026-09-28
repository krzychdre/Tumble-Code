// npx vitest core/config/migrations/__tests__/runner.spec.ts

import { providerProfileMigrationsSchema } from "@roo-code/types"

import { flagRecord, runFlaggedMigrations, runStartupMigrations, type FlaggedMigration } from "../runner"
import { PROVIDER_PROFILE_MIGRATIONS } from "../provider-profiles/registry"
import { CONTEXT_PROXY_MIGRATIONS } from "../context-proxy/registry"

type Flag = "a" | "b" | "c"

const makeRegistry = (log: string[], failOn?: Flag): FlaggedMigration<Flag, string[], undefined>[] =>
	(["a", "b", "c"] as const).map((flag) => ({
		flag,
		introduced: "2026-01-01",
		async run(target) {
			if (flag === failOn) throw new Error(`boom ${flag}`)
			target.push(flag)
			log.push(flag)
		},
	}))

describe("runFlaggedMigrations", () => {
	it("runs pending migrations in registry order and marks them done", async () => {
		const log: string[] = []
		const done: Partial<Record<Flag, boolean>> = { b: true }
		const ran = await runFlaggedMigrations(makeRegistry(log), done, [], undefined)
		expect(ran).toBe(true)
		expect(log).toEqual(["a", "c"])
		expect(done).toEqual({ a: true, b: true, c: true })
	})

	it("returns false and runs nothing when every flag is done", async () => {
		const log: string[] = []
		const ran = await runFlaggedMigrations(makeRegistry(log), { a: true, b: true, c: true }, [], undefined)
		expect(ran).toBe(false)
		expect(log).toEqual([])
	})

	it("stops at a throwing migration and leaves its flag and later flags unset", async () => {
		const log: string[] = []
		const done: Partial<Record<Flag, boolean>> = {}
		await expect(runFlaggedMigrations(makeRegistry(log, "b"), done, [], undefined)).rejects.toThrow("boom b")
		expect(done).toEqual({ a: true })
		expect(log).toEqual(["a"])
	})
})

describe("runStartupMigrations", () => {
	it("runs every migration in registry order", async () => {
		const log: string[] = []
		await runStartupMigrations(
			["x", "y"].map((id) => ({ id, introduced: "2026-01-01", run: async () => void log.push(id) })),
			undefined,
		)
		expect(log).toEqual(["x", "y"])
	})
})

describe("migration registries", () => {
	it("provider-profile registry flags match the persisted migrations schema, in order", () => {
		expect(PROVIDER_PROFILE_MIGRATIONS.map((m) => m.flag)).toEqual(
			Object.keys(providerProfileMigrationsSchema.shape),
		)
	})

	it("flagRecord builds a record over every registry flag", () => {
		expect(flagRecord(PROVIDER_PROFILE_MIGRATIONS, true)).toEqual({
			rateLimitSecondsMigrated: true,
			openAiHeadersMigrated: true,
			consecutiveMistakeLimitMigrated: true,
			todoListEnabledMigrated: true,
			claudeCodeLegacySettingsMigrated: true,
		})
	})

	it("every migration carries a valid introduction date and ContextProxy ids are unique", () => {
		const dates = [...PROVIDER_PROFILE_MIGRATIONS, ...CONTEXT_PROXY_MIGRATIONS].map((m) => m.introduced)
		for (const date of dates) expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
		const ids = CONTEXT_PROXY_MIGRATIONS.map((m) => m.id)
		expect(new Set(ids).size).toBe(ids.length)
	})
})
