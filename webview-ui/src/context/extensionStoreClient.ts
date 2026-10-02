/**
 * The webview's extension store as an external store for
 * `useSyncExternalStore` (roadmap P1).
 *
 * The reducer stays pure and unchanged (`extensionStateReducer.ts`); this
 * class only adds the external-store protocol around it: a listener set and
 * an eagerly rebuilt read model (`T`, the flattened context value) so
 * selector consumers can read a consistent
 * snapshot the moment a host message lands, before React re-renders anything.
 *
 * The context actions (`A`) are created once per client and never change
 * identity: they close over the client, never over a store snapshot, so the
 * flattened value can reference them across store changes without churning the
 * memoized children of legacy consumers. The first value is built lazily (on
 * the first `getValue`) so the actions factory can attach them first.
 *
 * Notifications happen synchronously in `apply`, only when the store actually
 * changed (the reducer returns `prev` itself otherwise), so no-op messages
 * never re-render anybody.
 */
import type { ExtensionMessage, ExtensionState } from "@tumble-code/types"

import {
	applyExtensionMessage,
	createInitialExtensionStore,
	updateExtensionState,
	type ExtensionStore,
} from "./extensionStateReducer"

export type StoreListener = () => void

export class ExtensionStoreClient<T, A> {
	/** The context actions, created once by the provider. Stable identities. */
	readonly actions: A

	private readonly buildValue: (store: ExtensionStore, client: ExtensionStoreClient<T, A>) => T
	private store: ExtensionStore
	private listeners = new Set<StoreListener>()
	private cachedValue: T | undefined

	constructor(
		createActions: (client: ExtensionStoreClient<T, A>) => A,
		buildValue: (store: ExtensionStore, client: ExtensionStoreClient<T, A>) => T,
	) {
		this.buildValue = buildValue
		this.store = createInitialExtensionStore()
		this.actions = createActions(this)
	}

	/** The current store. Read-only; never mutate. */
	getStore = (): ExtensionStore => this.store

	/** The read model for the current store (the flattened context value). */
	getValue = (): T => {
		if (this.cachedValue === undefined) {
			this.cachedValue = this.buildValue(this.store, this)
		}
		return this.cachedValue
	}

	subscribe = (listener: StoreListener): (() => void) => {
		this.listeners.add(listener)
		return () => {
			this.listeners.delete(listener)
		}
	}

	/** Applies one host message. Returns whether the store changed. */
	applyMessage = (message: ExtensionMessage): boolean => {
		return this.apply(applyExtensionMessage(this.store, message))
	}

	/** Local setter path for the context actions: touches `extensionState` only. */
	updateExtensionState = (update: (prevState: ExtensionState) => ExtensionState): boolean => {
		return this.apply(updateExtensionState(this.store, update))
	}

	/** Clears the resync request flag (it is not part of the read model). */
	clearClineMessagesResyncRequest = (): void => {
		if (this.store.clineMessagesResyncRequested) {
			this.apply({ ...this.store, clineMessagesResyncRequested: false })
		}
	}

	private apply(next: ExtensionStore): boolean {
		if (next === this.store) {
			return false
		}
		this.store = next
		this.cachedValue = this.buildValue(next, this)
		// Iterate a snapshot: a listener removed during delivery is skipped.
		for (const listener of [...this.listeners]) {
			listener()
		}
		return true
	}
}
