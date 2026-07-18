import { useProviderModels } from "./useProviderModels"

export const useLmStudioModels = (modelId?: string) => {
	const { models, isLoading, error } = useProviderModels(modelId ? "lmstudio" : undefined)

	return { data: models ?? {}, isLoading, isError: Boolean(error), error: error ? new Error(error) : null }
}
