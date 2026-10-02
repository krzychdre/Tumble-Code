import type { RemoteControlStatus } from "@tumble-code/types"

/**
 * The remote-control bridge status the state push reports (UI plan §4, the
 * CLI status line). `setupRemoteControlBridge` writes it; the state builder
 * reads it. A module of its own, without the vscode import of bridge.ts, so
 * the state builder does not load the bridge wiring.
 */
let status: RemoteControlStatus = "off"

export function getRemoteControlStatus(): RemoteControlStatus {
	return status
}

/** Returns whether the status changed. */
export function setRemoteControlStatus(next: RemoteControlStatus): boolean {
	if (next === status) {
		return false
	}

	status = next
	return true
}
