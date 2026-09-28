/**
 * apply_patch tool module
 *
 * A stripped-down, file-oriented diff format designed to be easy to parse and safe to apply.
 * Based on the Codex apply_patch specification.
 */

export { parsePatch, ParseError } from "./parser"
export { processAllHunks } from "./apply"
export type { ApplyPatchFileChange } from "./apply"
