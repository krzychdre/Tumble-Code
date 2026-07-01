/**
 * Barrel export for the memory module.
 *
 * The memory system is a native, file-based, model-managed port of Claude
 * Code's `memdir/` — no dedicated memory tool is exposed to the agent. The
 * model reads/writes memory via the existing `read_file` / `write_to_file` /
 * `edit_file` / `search_files` / `list_files` tools against a per-workspace
 * directory under VS Code globalStorage, gated by the behavioral prompt
 * (`getMemorySection`) and the `validateToolUse` carve-out (`isAutoMemPath`).
 */

export {
	initMemoryPaths,
	resetMemoryPaths,
	isMemoryPathsInitialized,
	isAutoMemoryEnabled,
	getMemoryBaseDir,
	sanitizeCwd,
	getAutoMemPath,
	getAutoMemEntrypoint,
	isAutoMemPath,
	validateMemoryPath,
	ensureMemoryDirExists,
	ENTRYPOINT_NAME,
	type MemoryConfig,
} from "./paths"

export { MEMORY_TYPES, parseMemoryType, type MemoryType } from "./memoryTypes"
export {
	TYPES_SECTION_INDIVIDUAL,
	WHAT_NOT_TO_SAVE_SECTION,
	MEMORY_DRIFT_CAVEAT,
	WHEN_TO_ACCESS_SECTION,
	TRUSTING_RECALL_SECTION,
	MEMORY_FRONTMATTER_EXAMPLE,
} from "./memoryTypes"
export { memoryAgeDays, memoryAge, memoryFreshnessText, memoryFreshnessNote } from "./memoryAge"
export { parseFrontmatter, type MemoryFrontmatter } from "./frontmatter"
export {
	buildMemoryLines,
	truncateEntrypointContent,
	buildSearchingPastContextSection,
	loadMemoryPrompt,
	loadMemoryIndex,
	MAX_ENTRYPOINT_LINES,
	MAX_ENTRYPOINT_BYTES,
	DIR_EXISTS_GUIDANCE,
	type EntrypointTruncation,
} from "./memoryPrompt"
export { scanMemoryFiles, formatMemoryManifest, type MemoryHeader } from "./memoryScan"
export {
	renderTranscript,
	DEFAULT_MAX_MESSAGES,
	DEFAULT_MAX_CHARS_PER_MESSAGE,
	type TranscriptMessage,
	type RenderTranscriptOptions,
} from "./transcript"
export { memoryWriteSandbox, filterMemoryWrittenPaths, type SandboxDecision } from "./memorySandbox"
export {
	findRelevantMemories,
	selectRelevantMemories,
	parseSelectedMemories,
	collectRecentSuccessfulTools,
	SELECTOR_SYSTEM_PROMPT,
	type SideQuery,
	type RecentToolMessageView,
} from "./relevance"
export {
	readMemoriesForSurfacing,
	memoryHeader,
	collectSurfacedMemories,
	filterDuplicateMemoryAttachments,
	wrapMemoryAsSystemReminder,
	getMemoryMtime,
	MAX_MEMORY_LINES,
	MAX_MEMORY_BYTES,
	MAX_SESSION_BYTES,
	type RelevantMemory,
	type FileStateCache,
	type FileStateEntry,
} from "./surfacing"
export {
	startRelevantMemoryPrefetch,
	type MemoryPrefetch,
	type PrefetchContext,
	type PrefetchMessage,
} from "./prefetch"
export {
	executeExtractMemories,
	drainPendingExtraction,
	hasMemoryWritesSince,
	resetExtractionState,
	type ExtractionContext,
	type ExtractionMessageView,
	type SubTaskRunner,
	type SubTaskResult,
} from "./extractMemories"
export {
	executeAutoDream,
	buildConsolidationPrompt,
	resetAutoDreamState,
	type AutoDreamConfig,
	type AutoDreamContext,
} from "./autoDream"
export {
	readLastConsolidatedAt,
	tryAcquireConsolidationLock,
	rollbackConsolidationLock,
	recordConsolidation,
	countSessionsSince,
	HOLDER_STALE_MS,
} from "./consolidationLock"
