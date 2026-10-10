import { SECRET_STATE_KEYS, ProviderSettings } from "@tumble-code/types"

export function checkExistKey(config: ProviderSettings | undefined) {
	if (!config) {
		return false
	}

	// Special case for fake-ai, openai-codex, and qwen-code providers which don't need any configuration.
	if (config.apiProvider && ["fake-ai", "openai-codex", "qwen-code"].includes(config.apiProvider)) {
		return true
	}

	// Check all secret keys from the centralized SECRET_STATE_KEYS array.
	const hasSecretKey = SECRET_STATE_KEYS.some((key) => config[key as keyof ProviderSettings] !== undefined)

	// Check additional non-secret configuration properties
	const hasOtherConfig = [
		config.awsRegion,
		config.vertexProjectId,
		config.ollamaModelId,
		config.lmStudioModelId,
		config.vsCodeLmModelSelector,
	].some((value) => value !== undefined)

	return hasSecretKey || hasOtherConfig
}
