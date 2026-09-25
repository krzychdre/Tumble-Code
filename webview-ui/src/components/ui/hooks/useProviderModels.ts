import { useContext, useMemo } from "react"
import { QueryClient, QueryClientContext, useQuery } from "@tanstack/react-query"

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

/**
 * Used when a hook renders outside a QueryClientProvider (the app roots have
 * one; some specs and isolated components do not), so the cache is still
 * shared between those consumers.
 */
const fallbackQueryClient = new QueryClient()

/**
 * Cache policy, chosen to keep the old per-mount behavior while sharing:
 * - consumers mounted at the same time share one request and one result
 *   (`staleTime: Infinity` while anyone observes the entry);
 * - the entry is dropped once the last consumer unmounts (`gcTime: 0`), so a
 *   later mount asks the host again, exactly like before;
 * - the host answers errors in the payload, so there is nothing to retry, and
 *   webview focus or network state must not trigger requests (a local Ollama
 *   works offline, so `networkMode: "always"`).
 */
const cachePolicy = {
	staleTime: Infinity,
	gcTime: 0,
	retry: false,
	refetchOnWindowFocus: false,
	refetchOnReconnect: false,
	networkMode: "always",
} as const

type DynamicModelSource = Exclude<ModelSource, { kind: "static" }>

function fetchProviderModels(
	source: DynamicModelSource,
	provider: string | undefined,
	options: ModelSourceOptions | undefined,
	refresh: boolean,
	signal: AbortSignal,
): Promise<ModelSourceResult> {
	return request({
		build: (requestId) => ({
			type: "requestProviderModels",
			modelSourceRequest: { requestId, source, provider, options, refresh },
		}),
		responseType: "providerModels",
		// A response without a result carries no id, so it never matches.
		responseId: (message) => message.modelSourceResult?.requestId,
		signal,
	}).then((message) => message.modelSourceResult as ModelSourceResult)
}

export function useProviderModels(provider?: string, options?: ModelSourceOptions): ProviderModelsState {
	const queryClient = useContext(QueryClientContext) ?? fallbackQueryClient
	const source = useMemo(() => resolveProviderModelSource(provider), [provider])
	const serializedOptions = JSON.stringify(options)
	const requestOptions = useMemo<ModelSourceOptions | undefined>(
		() => (serializedOptions ? JSON.parse(serializedOptions) : undefined),
		[serializedOptions],
	)
	const dynamicSource = source && source.kind !== "static" ? source : undefined
	const enabled = !!dynamicSource
	const sourceId = dynamicSource?.id
	const queryKey = useMemo(
		() => ["providerModels", provider, sourceId, serializedOptions ?? ""] as const,
		[provider, sourceId, serializedOptions],
	)

	// A provider or options change is a new key, so the old list disappears
	// instead of briefly showing the wrong provider's models.
	const query = useQuery(
		{
			queryKey,
			queryFn: ({ signal }) => fetchProviderModels(dynamicSource!, provider, requestOptions, false, signal),
			enabled,
			...cachePolicy,
		},
		queryClient,
	)

	const refresh = () => {
		if (!dynamicSource) {
			return
		}
		// A refresh replaces a request still in flight, like before. The cached
		// list stays visible until the new one arrives (L1): the cancel reverts
		// to the previous data rather than clearing it.
		void queryClient.cancelQueries({ queryKey, exact: true })
		queryClient
			.fetchQuery({
				queryKey,
				queryFn: ({ signal }) => fetchProviderModels(dynamicSource!, provider, requestOptions, true, signal),
				...cachePolicy,
				staleTime: 0,
			})
			.catch(() => {
				// Cancelled by a newer refresh or by the last consumer leaving.
			})
	}

	const result = query.data
	return {
		source,
		models: result?.models,
		modelIds: result?.modelIds,
		isLoading: enabled && query.fetchStatus === "fetching",
		error: result?.error,
		refresh,
	}
}
