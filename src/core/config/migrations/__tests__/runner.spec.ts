// npx vitest core/config/migrations/__tests__/runner.spec.ts

import { providerProfileMigrationsSchema } from "@roo-code/types"

import { flagRecord, runFlaggedMigrations, runStartupMigrations, type FlaggedMigration } from "../runner"
import { PROVIDER_PROFILE_MIGRATIONS, RETIRED_PROVIDER_PROFILE_MIGRATION_FLAGS } from "../provider-profiles/registry"
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
	// Retired flags belong to deleted migrations. They stay in the strict schema so stored envelopes that carry
	// them still parse, and they must never come back into the registry (a returning flag would be skipped on
	// every install that recorded it as done years ago).
	it("schema keys are exactly the retired flags followed by the live registry flags, in order", () => {
		expect([
			...RETIRED_PROVIDER_PROFILE_MIGRATION_FLAGS,
			...PROVIDER_PROFILE_MIGRATIONS.map((m) => m.flag),
		]).toEqual(Object.keys(providerProfileMigrationsSchema.shape))
	})

	it("no retired flag is used by a live migration", () => {
		const live = new Set<string>(PROVIDER_PROFILE_MIGRATIONS.map((m) => m.flag))
		expect(RETIRED_PROVIDER_PROFILE_MIGRATION_FLAGS.filter((flag) => live.has(flag))).toEqual([])
	})

	it("the strict schema still accepts a stored record with every retired flag", () => {
		const stored = Object.fromEntries(RETIRED_PROVIDER_PROFILE_MIGRATION_FLAGS.map((flag) => [flag, false]))
		expect(providerProfileMigrationsSchema.parse(stored)).toEqual(stored)
	})

	it("flagRecord builds a record over the live registry flags only", () => {
		expect(flagRecord(PROVIDER_PROFILE_MIGRATIONS, true)).toEqual({})
	})

	it("every migration carries a valid introduction date and ContextProxy ids are unique", () => {
		const dates = [...PROVIDER_PROFILE_MIGRATIONS, ...CONTEXT_PROXY_MIGRATIONS].map((m) => m.introduced)
		for (const date of dates) expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
		const ids = CONTEXT_PROXY_MIGRATIONS.map((m) => m.id)
		expect(new Set(ids).size).toBe(ids.length)
	})
})
