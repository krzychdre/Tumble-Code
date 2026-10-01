# Port Zoo PR #351 — update @modelcontextprotocol/sdk to v1.26.0 [security] + MCP resource_link support

## §0 Credit & provenance

- Upstream: Zoo-Code-Org/Zoo-Code PR #351, commit `09fedd62c`, merged 2026-06-06.
- Original author(s): Elliott de Launay, edelauna (renovate[bot] dropped as a bot).
- Commit trailers to add:
    ```
    Co-authored-by: Elliott de Launay <edelauna@gmail.com>
    Co-authored-by: edelauna <54631123+edelauna@users.noreply.github.com>
    ```

## §1 What & why

Two coupled changes:

1. **Security bump** of `@modelcontextprotocol/sdk` `1.12.0 → 1.26.0` in `src/package.json` (+ lockfile).
2. **MCP `resource_link` content type** (MCP spec 2025-06-18): add the `McpResourceLink`
   type to `packages/types/src/mcp.ts` and render it in `UseMcpToolTool`.

Our fork is at the exact pre-PR state (sdk 1.12.0; no `McpResourceLink`; no `resource_link`
branch in `UseMcpToolTool.processToolContent`). MCP code paths exist here (McpHub, UseMcpToolTool),
so this is in-scope. No Roo/TTS/router/cloud entanglement.

## §2 Edits (exact, adapted to our code)

### 2a. `packages/types/src/mcp.ts` — add types before `McpToolCallResponse`, add to union

Insert the `McpResourceLinkAnnotations` + `McpResourceLink` types and add `| McpResourceLink`
to the `McpToolCallResponse.content` union. (Keep our existing multi-line union formatting;
only add the new arm — do NOT reflow the existing arms to one-liners like upstream did; that's
churn with no behavior change.)

### 2b. `src/core/tools/UseMcpToolTool.ts`

- Add `McpResourceLink` to the type import from `@roo-code/types`.
- In `processToolContent`'s `.map`, after the `image` branch and before the trailing `return ""`,
  add a `resource_link` branch rendering a markdown link.

### 2c. `src/package.json`

- `"@modelcontextprotocol/sdk": "1.12.0"` → `"1.26.0"`.

### 2d. Lockfile

- `pnpm install --lockfile-only` (or filtered install) to refresh `pnpm-lock.yaml`.

## §3 Scope cuts (YAGNI)

- Do NOT reflow the existing `McpToolCallResponse` union arms (upstream cosmetic change).
- Do NOT re-add TTS / router / cloud / Roo branding.
- No new tests required by upstream; add a focused type/render check only if cheap.

## §4 Verify (binary acceptance)

- `pnpm --filter @roo-code/types check-types` → passes.
- `cd src && npx tsc --noEmit` (or repo typecheck) → passes; `McpResourceLink` resolves.
- `grep '@modelcontextprotocol/sdk' src/package.json` shows `1.26.0`.
- `grep '@modelcontextprotocol/sdk@1.26.0' pnpm-lock.yaml` present; no `@1.12.0` left.
- Existing MCP tests (`UseMcpToolTool`, `McpHub`) still pass.

## §5 Co-authors — see §0.
