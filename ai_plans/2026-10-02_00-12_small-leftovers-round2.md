# Small leftovers, round 2 (Qdrant host:port, read_file past the end, custom mode rules folder)

Status: done on `fix/small-leftovers-round2` (one commit per item), PR open, not merged.

## Touched files

- a: `src/services/code-index/vector-store/qdrant-client.ts`, `.../vector-store/__tests__/qdrant-url.spec.ts`,
  `.changeset/qdrant-url-host-port-starting-with-http.md`
- b: `src/core/tools/ReadFileTool.ts`, `src/core/tools/__tests__/readFileTool.spec.ts`,
  `.changeset/read-file-offset-past-end.md`
- c: `src/core/webview/messageHandlers/customModes.ts`, `src/core/webview/__tests__/webviewMessageHandler.spec.ts`,
  `src/core/webview/__tests__/__snapshots__/webviewMessageHandler.routing.spec.ts.snap`,
  `src/core/config/__tests__/CustomModesManager.spec.ts`, `src/i18n/locales/*/common.json` (18 locales),
  `.changeset/delete-custom-mode-rules-once.md`

## a. Qdrant `host:port` whose host starts with "http"

Problem: `resolveQdrantUrl` (`qdrant-client.ts`) returned any input that started with "http" and had a colon
unchanged, so `httpbin.org:8080` was parsed as a URL with the scheme `httpbin:`, an empty host and the path `8080`.
The table spec pinned this as a "known quirk" (kept on purpose in #687).

Fix: input without `://` is always a bare host or `host:port` and gets `http://`. Input with `://` is kept as typed
(an unparsable one like `http://` still goes to the client as a raw URL, as before).

Tests: the table row now expects `http://httpbin.org:8080` (host `httpbin.org`, port 8080); a new row pins
`http-qdrant`. All five vector-store specs green.

## b. read_file offset past the end

Problem: `ReadFileTool.readSlice` turned every slice with no returned lines into "Note: File is empty".
`readWithSlice` returns no lines for an offset past the last line, so asking a 10-line file for offset 50 told the model
the file was empty (seen during #675).

Fix: when no lines come back and the file is not empty, the result is
"Note: offset 50 is past the end of the file, which has 10 lines. Use an offset from 1 to 10." The empty-file note
stays for empty content. The line count is `readWithSlice`'s `totalLines` (a trailing newline counts as one more
line, as everywhere else in the tool).

Tests: regression test in `readFileTool.spec.ts`, verified to fail on the old code
("expected 'File: ten.ts\nNote: File is empty' to contain 'offset 50 is past the end ...'").

## c. Custom mode rules folder deleted twice

Problem: on delete, the webview handler (`messageHandlers/customModes.ts`) checked the rules folder, called
`CustomModesManager.deleteCustomMode` (which already removes the folder in `deleteRulesFolder`) and then removed the
same folder again with `fs.rm` (a no-op, or a second failure with a second message: the manager warns with
`customModes.errors.rulesCleanupFailed`, the handler then showed `common:errors.delete_rules_folder_failed`).

Fix: the manager is the only place that deletes the folder. The handler keeps the check-only request (it names the
folder in the webview's confirmation dialog) and the switch to the default mode; it only looks the folder up for a
check request. The now unused `common:errors.delete_rules_folder_failed` string is removed from all 18 locales.

Tests: the routing characterization snapshot for `deleteCustomMode` was updated deliberately: the
`getWorkspacePath`, `getRooDirectoriesForCwd` and `fileExistsAtPath` events are gone from the delete request (the
`#checkOnly` snapshot is unchanged). Handler specs now assert that the handler itself never calls `fs.rm`, plus a new
check-only test with an existing folder; the handler's rm-failure test moved to the manager
(`CustomModesManager.spec.ts`, "rules folder": deletes once; warns and still deletes the mode on failure).

## Notes

- Gates: the specs above, `tsc --noEmit -p src`, eslint and prettier on touched files, `pnpm knip` exit 0.
