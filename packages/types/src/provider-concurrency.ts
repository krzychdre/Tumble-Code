/**
 * How many subagents may run at once on one provider profile.
 *
 * `maxConcurrentRequests` is the profile's cap on requests in flight (unset =
 * no per-profile cap). Each subagent on the profile takes one slot; the parent
 * task takes one too when it runs on the same profile, because its next request
 * goes to the same server while the subagents work.
 *
 * Returns `undefined` when the profile sets no cap (only the global
 * `parallelTasksMaxConcurrency` applies), otherwise the slots left for
 * subagents, never below 0. A result of 0 means a fan-out on this profile can
 * never start.
 */
export function subagentSlotsForProfile(
	maxConcurrentRequests: number | undefined,
	parentUsesProfile: boolean,
): number | undefined {
	if (maxConcurrentRequests === undefined) {
		return undefined
	}
	return Math.max(0, maxConcurrentRequests - (parentUsesProfile ? 1 : 0))
}
