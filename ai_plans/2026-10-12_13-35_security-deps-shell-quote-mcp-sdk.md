# Security deps 2026-10-12: shell-quote and the MCP SDK

Status: done on `fix/ci-audit-shell-quote-mcp-sdk`

## Problem (evidence)

The `Dependency audit` CI job (`pnpm audit --prod --json | node scripts/audit-gate.mjs`) failed on:

- critical GHSA-pqg4-j6r4-53mv in shell-quote (>=1.8.4 <1.11.0). `webview-ui/package.json` asked for
  `^1.10.0`, the lockfile resolved 1.10.0. Used by `webview-ui/src/utils/command-parser.ts` (and by
  launch-editor transitively).
- high GHSA-6qxp-vccf-f47h in @modelcontextprotocol/sdk (>=1.12.0 <1.31.0). Pinned to `1.30.1` in
  `src/package.json` and `packages/agent-interchange/package.json`.

GHSA-6qxp-vccf-f47h is about the SDK's OAuth client sending stored refresh tokens and client secrets to an
authorization server named by the MCP server. We do not use `authProvider`, `OAuthClientProvider` or the
bundled providers anywhere, so the advisory was not exploitable here; the bump clears the gate.

## Fix

- `webview-ui/package.json`: `shell-quote ^1.12.0` (latest).
- `src/package.json`, `packages/agent-interchange/package.json`: `@modelcontextprotocol/sdk 1.32.1`
  (exact pin kept; 1.31.0 is the first fixed version, 1.32.1 is the current 1.x).
- `pnpm-lock.yaml`: only the entries of these two packages (plus the `@google/genai` peer key) change.
  A plain `pnpm install` also deduplicated side-channel 1.1.0 into 1.1.1; that unrelated hunk was left out.
  `pnpm install --frozen-lockfile` accepts the lockfile and `pnpm install --lockfile-only` leaves it unchanged.

## SDK changes 1.30.1 -> 1.32.1 that matter

- 1.31.0: stored OAuth credentials carry an `issuer` field (we store none).
- 1.32.0: `StreamableHTTPClientTransport` and `SSEClientTransport` follow redirects only within the same
  origin (http to https on the same host is allowed). `McpConnectionManager.createTransport` does not set
  `redirectPolicy`, so a remote MCP server whose URL redirects to another host or port now fails to connect;
  the user has to configure the final URL. Also new opt-in server options (`maxToolInputElements`,
  `expectedResource`), and `tools/call` without `arguments` is now accepted by servers.
- 1.32.1: docs only.

## Tests

- `pnpm audit --prod --json | node scripts/audit-gate.mjs` exits 0.
- `tsc --noEmit` in `src` and `packages/agent-interchange` is clean.
- `src/services/mcp` specs (9 files, 201 tests), `packages/agent-interchange` specs (8 files, 117 tests),
  `webview-ui` `command-parser.spec.ts` (29) and `CommandExecution.spec.tsx` (42) pass.
- `pnpm knip` exits 0.
