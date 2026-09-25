import * as vscode from "vscode"

import type { GlobalState } from "@roo-code/types"

import { t } from "../../../i18n"
import { resolveImageMentions } from "../../mentions/resolveImageMentions"
import type { MarketplaceManager } from "../../../services/marketplace"
import type { ClineProvider } from "../ClineProvider"

/**
 * Builds the context every message handler receives. It is created once per
 * incoming message (as the closures in the old single switch were), so the
 * helpers always read the provider's current state.
 */
export function createHandlerContext(provider: ClineProvider, marketplaceManager?: MarketplaceManager) {
	return {
		provider,
		marketplaceManager,
		// Concise get/update of global state through the contextProxy API.
		getGlobalState: <K extends keyof GlobalState>(key: K) => provider.contextProxy.getValue(key),
		updateGlobalState: async <K extends keyof GlobalState>(key: K, value: GlobalState[K]) =>
			await provider.contextProxy.setValue(key, value),
		getCurrentCwd: () => {
			return provider.getCurrentTask()?.cwd || provider.cwd
		},
	}
}

export type HandlerContext = ReturnType<typeof createHandlerContext>

/** Serializes an error with its non-enumerable fields (message, stack) for the log. */
export function serializeError(error: unknown): string {
	return JSON.stringify(error, Object.getOwnPropertyNames(error), 2)
}

/**
 * Logs `${logPrefix}${serialized error}` to the output channel and shows the
 * translated `i18nKey` as an error toast (not awaited, as before).
 */
export function logAndToast(ctx: HandlerContext, logPrefix: string, error: unknown, i18nKey: string): void {
	ctx.provider.log(`${logPrefix}${serializeError(error)}`)
	vscode.window.showErrorMessage(t(i18nKey))
}

/**
 * Resolves image file mentions in incoming messages.
 * Matches read_file behavior: respects size limits and model capabilities.
 */
export async function resolveIncomingImages(ctx: HandlerContext, payload: { text?: string; images?: string[] }) {
	const { provider } = ctx
	const text = payload.text ?? ""
	const images = payload.images
	const currentTask = provider.getCurrentTask()
	const state = await provider.getState()
	const resolved = await resolveImageMentions({
		text,
		images,
		cwd: ctx.getCurrentCwd(),
		rooIgnoreController: currentTask?.rooIgnoreController,
		maxImageFileSize: state.maxImageFileSize,
		maxTotalImageSize: state.maxTotalImageSize,
	})
	return resolved
}
