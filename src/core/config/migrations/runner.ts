/**
 * Start-up config migrations (roadmap item D9).
 *
 * Every migration lives in its own file named after the day it was
 * introduced (`YYYY-MM-DD-<what>.ts`), so the age of each one is visible
 * at a glance and old ones can be deleted after a release note announces
 * that the legacy shape is no longer read.
 *
 * Two kinds exist, because the two stores record "done" differently:
 *
 * - {@link FlaggedMigration}: provider profiles. The stored profiles
 *   envelope already carries a `migrations` record (one boolean per
 *   migration). A migration runs only while its flag is not `true`, and the
 *   flag is written in the same store call as the migrated data. If that
 *   write fails, neither the data nor the flag lands, so the migration runs
 *   again on the next start; each one must therefore be idempotent.
 *
 * - {@link StartupMigration}: ContextProxy global state. These have no
 *   flag: each one detects its own legacy key (for example
 *   `customCondensingPrompt`) and removes it when done, so "the legacy key
 *   is absent" is the done record. They run on every start and are no-ops
 *   once the legacy key is gone. A persisted flag would be wrong here:
 *   `resetAllState()` clears every global state key and re-runs them, and
 *   some of them (memory defaults, the invalid-folder check) must apply
 *   again after that reset.
 *
 * Registry order is execution order; keep new entries at the end unless a
 * later migration depends on an earlier one.
 */

export interface FlaggedMigration<Flag extends string, Target, Context> {
	/** Key in the persisted done-record. */
	flag: Flag
	/** Day the migration was introduced (first commit, `git log -S`). */
	introduced: string
	run(target: Target, context: Context): Promise<void>
}

export interface StartupMigration<Context> {
	/** Stable name, used in logs and docs. */
	id: string
	/** Day the migration was introduced (first commit, `git log -S`). */
	introduced: string
	run(context: Context): Promise<void>
}

/**
 * Runs every migration whose flag in `done` is not `true`, in registry
 * order, and marks it done in `done` (in memory; the caller persists it
 * together with the migrated target). Returns true when at least one ran,
 * which means the caller must write.
 */
export async function runFlaggedMigrations<Flag extends string, Target, Context>(
	registry: readonly FlaggedMigration<Flag, Target, Context>[],
	done: Partial<Record<Flag, boolean>>,
	target: Target,
	context: Context,
): Promise<boolean> {
	let ran = false
	for (const migration of registry) {
		if (done[migration.flag]) continue
		await migration.run(target, context)
		done[migration.flag] = true
		ran = true
	}
	return ran
}

/** Builds a done-record with every registry flag set to `value`. */
export function flagRecord<Flag extends string>(
	registry: readonly { flag: Flag }[],
	value: boolean,
): Record<Flag, boolean> {
	return Object.fromEntries(registry.map((migration) => [migration.flag, value])) as Record<Flag, boolean>
}

/** Runs every start-up migration in registry order. */
export async function runStartupMigrations<Context>(
	registry: readonly StartupMigration<Context>[],
	context: Context,
): Promise<void> {
	for (const migration of registry) {
		await migration.run(context)
	}
}
