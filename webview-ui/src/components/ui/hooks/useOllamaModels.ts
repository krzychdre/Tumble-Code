import { useProviderModels } from "./useProviderModels"

export const useOllamaModels = (modelId?: string) => {
	const { models, isLoading, error } = useProviderModels(modelId ? "ollama" : undefined)

	return { data: models ?? {}, isLoading, isError: Boolean(error), error: error ? new Error(error) : null }
}
