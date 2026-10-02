# MCP view: last English-only strings and the native timeout select

Status: done on `fix/webview-mcp-leftovers` (follow-up of simplification round 2).

## Touched files

- `webview-ui/src/components/mcp/ServerRow.tsx`
- `webview-ui/src/components/mcp/McpResourceRow.tsx`
- `webview-ui/src/components/chat/McpExecution.tsx`
- `webview-ui/src/i18n/locales/*/mcp.json` (18 locales)
- `webview-ui/src/components/mcp/__tests__/ServerRow.spec.tsx`, `McpResourceRow.spec.tsx` (new)
- `webview-ui/src/components/chat/__tests__/__golden__/ChatRow.golden.json`

## Problem

- `ServerRow.tsx:142` labelled the server switch with the literal `` `Toggle ${server.name} server` ``.
- `McpResourceRow.tsx:24-29` printed `"No description"`, `"Returns "` and `"Unknown"` as literals. The row is
  shown both in the MCP settings and in the chat (`AskRows.tsx`, a `use_mcp_server` resource ask).
- `ServerRow.tsx:223` used a native `<select>` for the network timeout, the only native select in the MCP view;
  every other dropdown in the settings is the shared Radix `Select` from `components/ui/select.tsx`.
- `McpExecution.tsx:314,320` passed an English default (`"Response"`) to `t()` although the key exists in all
  18 locales.

## Fix

- New keys `mcp:serverStatus.toggle` (with `{{serverName}}`), `mcp:resource.noDescription`, `mcp:resource.returns`,
  `mcp:resource.unknownType`, translated in all 18 locales.
- The timeout is per-server config sent with `updateMcpTimeout`, not a global setting, so it keeps its local state
  and message flow; only the control changes to `Select` / `SelectTrigger` (`flex-1`, labelled with
  `mcp:networkTimeout.label`) / `SelectItem`. Values are stringified for Radix and parsed back as before.
- The redundant English default in `McpExecution` is dropped.

## Tests

- `ServerRow.spec.tsx`: the Select is stubbed as a native `<select>` (Radix needs pointer events and portals);
  the timeout test is unchanged; a new test asserts the switch's accessible name is the translation key with the
  server name and that it posts `toggleMcpServer`.
- `McpResourceRow.spec.tsx` (new): the three fallbacks render through `t`.
- Golden `ChatRow.golden.json`: two cases (`use_mcp_server resource`, `use_mcp_server unknown resource`) now show
  the translation keys instead of the English literals. Markup and classes are unchanged, so no height change.

## Notes

- A config timeout that is not one of the eight listed values (hand-edited JSON) shows an empty trigger, as the
  native select showed no matching option before.
