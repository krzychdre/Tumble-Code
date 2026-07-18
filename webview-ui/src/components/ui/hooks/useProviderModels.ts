import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { type ModelRecord, type ModelSource, type ModelSourceOptions, type ModelSourceResult } from "@roo-code/types"

import { vscode } from "@src/utils/vscode"
import { getProviderModelSource } from "@src/components/settings/utils/providerModelConfig"

export { getProviderModelSource } from "@src/components/settings/utils/providerModelConfig"

type ProviderModelsState = {
	source?: ModelSource
	models?: ModelRecord
	modelIds?: string[]
	isLoading: boolean
	error?: string
	refresh: () => void
}

let nextRequestId = 0

const resolveProviderModelSource = (provider?: string): ModelSource | undefined => {
	if (!provider) {
		return undefined
	}
	return getProviderModelSource(provider as Parameters<typeof getProviderModelSource>[0])
}

export function useProviderModels(provider?: string, options?: ModelSourceOptions): ProviderModelsState {
	const source = useMemo(() => resolveProviderModelSource(provider), [provider])
	const [result, setResult] = useState<ModelSourceResult>()
	const [isLoading, setIsLoading] = useState(false)
	const activeRequestId = useRef<string>()
	const serializedOptions = JSON.stringify(options)
	const requestOptions = useMemo<ModelSourceOptions | undefined>(
		() => (serializedOptions ? JSON.parse(serializedOptions) : undefined),
		[serializedOptions],
	)

	const requestModels = useCallback(
		(refresh = false) => {
			if (!source || source.kind === "static") {
				activeRequestId.current = undefined
				setIsLoading(false)
				return
			}

			const requestId = `provider-models-${++nextRequestId}`
			activeRequestId.current = requestId
			setIsLoading(true)
			// L1: do NOT clear `result` here. Clearing on every request caused
			// the model dropdown to momentarily empty during `refresh()`.
			// `result` is cleared in the `useEffect` below only when the
			// provider/source actually changes; for refresh we keep the stale
			// result until the new one arrives.
			vscode.postMessage({
				type: "requestProviderModels",
				modelSourceRequest: {
					requestId,
					source,
					provider,
					options: requestOptions,
					refresh,
				},
			})
		},
		[provider, requestOptions, source],
	)

	useEffect(() => {
		// Clear any stale result from a different provider/source before
		// requesting, so switching providers does not briefly show the wrong
		// model list. Refresh does NOT go through this path (it calls
		// `requestModels(true)` directly), so refresh keeps the existing
		// result until the new one arrives (L1).
		setResult(undefined)
		requestModels()
		return () => {
			activeRequestId.current = undefined
		}
	}, [provider, requestModels, serializedOptions, source])

	useEffect(() => {
		const handler = (event: MessageEvent) => {
			const message = event.data
			if (message.type !== "providerModels" || !message.modelSourceResult) {
				return
			}

			const response = message.modelSourceResult as ModelSourceResult
			if (
				response.requestId !== activeRequestId.current ||
				source?.kind === "static" ||
				response.sourceId !== source?.id
			) {
				return
			}

			setResult(response)
			setIsLoading(false)
		}

		window.addEventListener("message", handler)
		return () => window.removeEventListener("message", handler)
	}, [source])

	return {
		source,
		models: result?.models,
		modelIds: result?.modelIds,
		isLoading,
		error: result?.error,
		refresh: () => requestModels(true),
	}
}
