import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { type ModelRecord, type ModelSource, type ModelSourceOptions, type ModelSourceResult } from "@roo-code/types"

import { request } from "@src/utils/extensionBus"
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
	const serializedOptions = JSON.stringify(options)
	const requestOptions = useMemo<ModelSourceOptions | undefined>(
		() => (serializedOptions ? JSON.parse(serializedOptions) : undefined),
		[serializedOptions],
	)

	// The request in flight; a newer request or a provider change aborts it, so
	// only the latest response is applied.
	const activeRequest = useRef<AbortController>()

	const requestModels = useCallback(
		(refresh = false) => {
			activeRequest.current?.abort()
			activeRequest.current = undefined

			if (!source || source.kind === "static") {
				setIsLoading(false)
				return
			}

			const controller = new AbortController()
			activeRequest.current = controller
			setIsLoading(true)
			// L1: do NOT clear `result` here. Clearing on every request caused
			// the model dropdown to momentarily empty during `refresh()`.
			// `result` is cleared in the `useEffect` below only when the
			// provider/source actually changes; for refresh we keep the stale
			// result until the new one arrives.
			request({
				build: (requestId) => ({
					type: "requestProviderModels",
					modelSourceRequest: {
						requestId,
						source,
						provider,
						options: requestOptions,
						refresh,
					},
				}),
				responseType: "providerModels",
				responseId: (message) => message.modelSourceResult?.requestId,
				signal: controller.signal,
			}).then(
				(message) => {
					if (activeRequest.current === controller) {
						activeRequest.current = undefined
					}
					if (message.modelSourceResult) {
						setResult(message.modelSourceResult)
						setIsLoading(false)
					}
				},
				() => {
					// Aborted by a newer request or by unmount: its response is not wanted.
				},
			)
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
			activeRequest.current?.abort()
			activeRequest.current = undefined
		}
	}, [provider, requestModels, serializedOptions, source])

	return {
		source,
		models: result?.models,
		modelIds: result?.modelIds,
		isLoading,
		error: result?.error,
		refresh: () => requestModels(true),
	}
}
