/**
 * Gate-scope test-only exports kept on purpose (R3-3b). The gate
 * (`scripts/find-test-only-exports.mjs --check`) fails on any export that no
 * production file uses AND that its own file does not use either; every entry
 * here is an exception with a reason. Do not add an entry to make CI green -
 * fix the code or restructure the seam instead. An entry is "file: name"
 * (or "file" alone to accept the whole file verdict).
 *
 * What belongs here:
 * - the forTests/state-reset seams the specs import to restore module state,
 * - genuinely load-bearing public API consumed outside the pnpm graph
 *   (runtime-compiled user code, the cloud service) or pinned by a
 *   public-surface characterization spec.
 */
export const allowlist = [
	// --- test seams: module-state reset/inspect helpers consumed by specs ---
	"src/api/providers/fetchers/modelCache.ts: resetModelCacheForTests",
	"src/core/memory/autoDream.ts: _inFlightDreamsCount",
	"src/core/memory/autoDream.ts: resetAutoDreamState",
	"src/core/memory/extractMemories.ts: _cursorKeys",
	"src/core/memory/extractMemories.ts: _inFlightExtractionsCount",
	"src/core/memory/extractMemories.ts: resetExtractionState",
	"src/core/memory/paths.ts: resetMemoryPaths",
	"src/services/search/file-search.ts: clearWorkspaceFileListCacheForTests",
	"src/core/prompts/sections/system-info.ts: resetOsInfoCacheForTests",
	"src/core/task/RetryHandler.ts: resetGlobalApiRequestTime",
	"src/core/webview/panelRegistry.ts: clearPanels",
	"src/services/code-index/embedders/rate-limit-gate.ts: resetRateLimitGates",
	"src/services/tree-sitter/index.ts: setMinComponentLines",
	"src/utils/logging/index.ts: resetLoggerForTests",

	// --- load-bearing public API / protocol contracts ---

	// Helper for user-authored custom tool files, compiled and imported at
	// runtime outside this repo (packages/core/src/custom-tools/esbuild-runner.ts);
	// documented in the CustomToolDefinition JSDoc.
	"packages/types/src/custom-tool.ts: defineCustomTool",

	// The extension <-> webview channel surface is pinned by
	// packages/types/src/__tests__/vscode-extension-host-surface.spec.ts;
	// these payload types are the message contracts the host emits
	// (openAiCodexRateLimits, indexingStatusUpdate) with no TS importer.
	"packages/types/src/vscode-extension-host/cloudAuth.ts: OpenAiCodexRateLimitsMessage",
	"packages/types/src/vscode-extension-host/cloudAuth.ts: RequestOpenAiCodexRateLimitsMessage",
	"packages/types/src/vscode-extension-host/codeIndex.ts: IndexingStatusUpdateMessage",

	// Events/validation schemas characterized by specs as the public types
	// package surface (public-api-no-ipc, zod-behavior, delegation-events).
	"packages/types/src/events.ts: taskEventSchema",
	"packages/types/src/followup.ts: suggestionItemSchema",
	"packages/types/src/provider-settings.ts: providerSettingsSchemaDiscriminated",

	// Cloud organization settings contract: the types mirror the self-hosted
	// cloudapi payloads; the zod schemas derive them and the specs pin the
	// shape (packages/types/src/__tests__/cloud.test.ts).
	"packages/types/src/cloud.ts: OrganizationCloudSettings",
	"packages/types/src/cloud.ts: OrganizationDefaultSettings",
	"packages/types/src/cloud.ts: OrganizationFeatures",
	"packages/types/src/cloud.ts: WorkspaceTaskVisibility",

	// Provider registry derived tables asserted by characterization specs
	// against the descriptor list (provider-registry, provider-model-id).
	"packages/types/src/provider-registry.ts: getActiveProviderDefinitions",
	"packages/types/src/provider-registry.ts: getRetiredProviderDefinitions",
	"packages/types/src/provider-settings.ts: getModelIdKeyForProvider",
	"packages/types/src/provider-settings.ts: modelIdKeysByProvider",
	"packages/types/src/provider-settings.ts: providerNamesWithRetired",
	"packages/types/src/model.ts: ReasoningEffortWithMinimal",

	// CLI settings validation contract: providers a run may start without an
	// API key; pinned by the CLI provider-types spec.
	"apps/cli/src/lib/utils/provider-types.ts: keylessProviders",
]
