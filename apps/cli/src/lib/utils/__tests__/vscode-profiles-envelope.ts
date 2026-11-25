import {
	createKnownPersistedProviderProfile,
	createProviderProfilesEnvelope,
	openAiModelInfoSaneDefaults,
	type ProviderProfilesEnvelope,
} from "@tumble-code/types"

/**
 * The provider profiles of a VS Code install, as the extension writes them into
 * the `vscode` section: GLM on an OpenAI-compatible server is the current
 * profile, Claude Opus is bound to architect mode.
 */
export function vscodeProfilesEnvelope(): ProviderProfilesEnvelope {
	return createProviderProfilesEnvelope({
		currentApiConfigName: "glm",
		apiConfigs: {
			glm: createKnownPersistedProviderProfile({
				id: "glm-id",
				apiProvider: "openai",
				openAiBaseUrl: "http://192.168.50.194:11111/v1",
				openAiModelId: "GLM-5.3-NVFP4",
				openAiCustomModelInfo: { ...openAiModelInfoSaneDefaults, contextWindow: 1_048_576 },
				openAiPreserveReasoning: true,
				enableReasoningEffort: true,
				reasoningEffort: "high",
				maxConcurrentRequests: 4,
				modelTemperature: 0.6,
				openAiHeaders: { "X-Team": "qub-it" },
			}),
			opus: createKnownPersistedProviderProfile({
				id: "opus-id",
				apiProvider: "anthropic",
				apiModelId: "claude-opus-5-5",
				enableReasoningEffort: false,
				slimToolset: true,
			}),
		},
		modeApiConfigs: { architect: "opus-id" },
	})
}
