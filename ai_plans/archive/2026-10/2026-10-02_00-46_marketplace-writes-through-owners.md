# Marketplace writes MCP and mode files through their owners

Status: done on branch `fix/marketplace-writes-through-owners` (simplification round 2, item A7).

## Touched files

- `src/services/marketplace/SimpleInstaller.ts`
- `src/services/marketplace/MarketplaceManager.ts`
- `src/services/marketplace/__tests__/SimpleInstaller.spec.ts`
- `src/services/marketplace/__tests__/SimpleInstaller.mcpWrites.spec.ts` (new)
- `src/services/marketplace/__tests__/MarketplaceManager.installedMetadata.spec.ts` (new)
- `.changeset/marketplace-writes-through-owners.md`

## Problem

- `SimpleInstaller.installMcp` and `removeMcp` wrote `.roo/mcp.json` and the global `mcp_settings.json` with a plain
  `fs.writeFile` (`SimpleInstaller.ts:268`, `:357` on main 72893f2dd). A crash or a failed write in the middle left a
  truncated file. `McpConfigStore.write` (`src/services/mcp/McpConfigStore.ts:154`) already writes these files
  atomically (safeWriteJson: temp file, fsync, rename, inter-process lock).
- `SimpleInstaller.installMode` had a fallback for a missing `CustomModesManager` that wrote `.roomodes` /
  `custom_modes.yaml` itself (`SimpleInstaller.ts:91-157`, write at `:139`), bypassing the manager's write queue and
  state refresh. The only production caller (`ClineProvider.ts:409`) always passes the manager, so the fallback was
  dead in production and only exercised by a spec.
- `removeMcp` swallowed every error (`SimpleInstaller.ts:359-361`): on a corrupt file the user got "removed" while
  nothing changed.
- `MarketplaceManager.checkProjectInstallations` / `checkGlobalInstallations` (`MarketplaceManager.ts:262-340`) held
  four copies of "read, parse, collect names" that swallowed every error, so a broken `mcp.json` looked exactly like
  "nothing installed".

## Fix

- `SimpleInstaller` owns a `McpConfigStore` (same settings directory and file locations as before) and reads and
  writes MCP settings only through it. One helper, `readMcpFileForUpdate`, gives an empty server list for a missing
  file and refuses (with the existing "contains invalid JSON" message) on invalid JSON, for both install and remove.
  Other top-level keys of the file are kept, as before.
- The store is a separate instance on purpose, not McpHub's: the hub's write guard hides its own writes from its
  file watcher, and the watcher is what connects the newly installed server. With a separate store the watcher
  still sees the change, exactly as with the old plain write.
- `installMode` always goes through `CustomModesManager.importModeWithRules`; without a manager it throws
  "CustomModesManager is not available", like `removeMode` already did.
- `MarketplaceManager` has one helper, `collectInstalled(filePath, "mode" | "mcp", metadata)`. A missing file adds
  nothing silently; any other read or parse error is logged with the file path (`console.error`, as the surrounding
  code does today) and the remaining files are still checked, so the marketplace view keeps working.

## Tests

- `SimpleInstaller.mcpWrites.spec.ts` (real temp directory): install goes through `McpConfigStore.write` and keeps the
  existing servers; a rename failure in the middle of the write leaves the original file byte-for-byte and no temp
  file; remove goes through the store; remove on a corrupt file throws and leaves it untouched. All four fail on the
  old code.
- `MarketplaceManager.installedMetadata.spec.ts` (real temp directory): all four files collected; a corrupt
  `mcp.json` is reported (console.error with the path and the SyntaxError) while the modes file is still listed
  (fails on the old code); missing files are not reported.
- `SimpleInstaller.spec.ts`: MCP tests now assert the write goes through the store; the fallback test is replaced by
  "refuses to write the modes file itself without CustomModesManager"; the mode install test asserts no direct
  `fs.writeFile`.

## Notes and caveats

- `McpConfigStore.write` pretty-prints with tabs (safeWriteJson); the marketplace used two spaces. The hub already
  writes the same files with tabs, so this only changes whitespace. The returned line number is computed from the
  tab-indented text, which has the same line layout.
- The parse error is logged, not shown in the webview: `fetchMarketplaceData` posts an `errors` field, but the
  webview never displays it, and surfacing it would be a webview change outside this item.
- `CustomModesManager` itself still writes the modes file with a plain `fs.writeFile` inside its queue
  (`CustomModesManager.ts:531`); making that atomic is the manager's own concern and is not part of this item.
