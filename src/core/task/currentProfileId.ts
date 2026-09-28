/**
 * Resolve the current provider-profile ID from provider state.
 *
 * The single implementation of what used to exist four times
 * (ApiRequestBuilder, TaskApiLoop wrapper, Task forwarder, and a private
 * copy in TaskContextManager) — see ai_plans/2026-09-28_d3-remove-task-forwarders.md.
 */
export function getCurrentProfileId(state: any): string {
	return (
		state?.listApiConfigMeta?.find((profile: any) => profile.name === state?.currentApiConfigName)?.id ?? "default"
	)
}
