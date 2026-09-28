/**
 * Barrel export for the memory module.
 *
 * The memory system is a native, file-based, model-managed port of Claude
 * Code's `memdir/` — no dedicated memory tool is exposed to the agent. The
 * model reads/writes memory via the existing `read_file` / `write_to_file` /
 * `edit_file` / `search_files` / `list_files` tools against a per-workspace
 * directory under VS Code globalStorage, gated by the behavioral prompt
 * (`getMemorySection`) and the `validateToolUse` carve-out (`isAutoMemPath`).
 * The background writers (extraction, dream) are not agents: they ask one
 * small completion each and write the files in code (memoryFiles.ts).
 *
 * Only what callers outside the module use goes through this barrel; the
 * module's own files (and their specs) import each other directly.
 */

export { isAutoMemoryEnabled } from "./paths"
export { renderTranscript, type TranscriptMessage } from "./transcript"
export { type SideQuery } from "./relevance"
export { executeExtractMemories, drainPendingExtraction } from "./extractMemories"
export { executeAutoDream, drainPendingDreams, type AutoDreamConfig } from "./autoDream"
