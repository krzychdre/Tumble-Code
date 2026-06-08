# Plan — per-mode MCP allowlist for **all** modes (extends Zoo #453)

> Follow-up to `ai_plans/2026-06-08_zoo-453-per-mode-mcp-allowlist.md`. That port made the
> `allowedMcpServers` allowlist work for **custom** modes (backend Phase A + webview Phase B).
> This extends it to **built-in** modes (code, architect, ask, debug) using the existing
> built-in-mode override channel (`customModePrompts`). Tumble Code rules apply: no new
> "Roo"/"Zoo" user-facing strings; internal ids unchanged.

## Context / why

Built-in modes can't be expressed as an editable `ModeConfig`; they're customized through
`customModePrompts` — a per-slug `PromptComponent` override carrying `roleDefinition` /
`whenToUse` / `description` / `customInstructions`. The #453 allowlist lives only on
`ModeConfig`, and every backend read-site resolves it via
`getModeBySlug(slug, customModes)?.allowedMcpServers`, which for a built-in mode returns the
frozen `DEFAULT_MODES` entry (`allowedMcpServers === undefined` → never restricted). The
webview editor is likewise gated on `findModeBySlug(visualMode, customModes)`.

Goal: let built-in modes scope MCP servers exactly like custom modes, reusing the override
channel that already exists for them.

**Also fixes a pre-existing leak (custom modes too):** `getDeferredToolsSection`
(`src/core/prompts/sections/deferred-tools.ts`) lists MCP tools with
`getMcpServerTools(mcpHub)` — **no allowlist** — so with the `deferredTools` experiment on, the
deferred catalog in the system prompt advertises every server regardless of the allowlist.

## Storage + precedence

- Extend `promptComponentSchema` with optional `allowedMcpServers: string[]`. Custom modes keep
  their allowlist on `ModeConfig`; built-in modes get it via `customModePrompts[slug]`. Opt-in /
  backward compatible (`undefined` = unrestricted, `[]` = none).
- One precedence rule in `src/shared/modes.ts`:

    ```ts
    export function getModeAllowedMcpServers(
    	slug: string,
    	customModes?: ModeConfig[],
    	customModePrompts?: CustomModePrompts,
    ): string[] | undefined {
    	const override = customModePrompts?.[slug]?.allowedMcpServers
    	return override ?? getModeBySlug(slug, customModes)?.allowedMcpServers
    }
    ```

    `??` (not `||`) preserves `[]`-means-none. Recomputed from state at build/exec time — never
    persisted onto the Task (keeps mid-task mode switching correct).

## Backend edits

| #   | File                                          | Change                                                                                                                      |
| --- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 1   | `packages/types/src/mode.ts`                  | add `allowedMcpServers: z.array(z.string()).optional()` to `promptComponentSchema`                                          |
| 2   | `src/shared/modes.ts`                         | add `getModeAllowedMcpServers` (above); import `CustomModePrompts`                                                          |
| 3   | `src/core/task/build-tools.ts`                | add `customModePrompts?` to `BuildToolsOptions`; resolve allowlist via the helper                                           |
| 4   | `src/core/task/ApiRequestBuilder.ts`          | pass `customModePrompts: state?.customModePrompts` into `buildNativeToolsArrayWithRestrictions`                             |
| 5   | `src/core/prompts/system.ts`                  | `allowedMcpServers = promptComponent?.allowedMcpServers ?? modeConfig.allowedMcpServers` (promptComponent already resolved) |
| 6   | `src/core/prompts/sections/deferred-tools.ts` | add `allowedMcpServers?` option → `getMcpServerTools(mcpHub, allowedMcpServers)`; forward from `system.ts`                  |
| 7   | `src/core/tools/mcpServerRestriction.ts`      | `getAllowedMcpServersForTask` resolves via the helper with `state?.customModePrompts`                                       |

## UI edits (`webview-ui/src/components/modes/ModesView.tsx` + `McpServerRestriction.tsx`)

- Generalize `McpServerRestriction` to value/identity props (`{ slug, value, mcpServers, onChange }`),
  preserving its debounce + reseed-on-slug-change + external-edit reconcile (the mode-switch safety).
  Custom-mode site wires `onChange` → `updateCustomMode`; built-in site wires `onChange` →
  `updateAgentPrompt` (existing `updatePrompt` path — no new message type).
- Render the editor in the built-in `else` branch, gated on `getCurrentMode()?.groups` containing
  `mcp` (shows for code/architect/ask/debug; not orchestrator). Seed from
  `customModePrompts?.[visualMode]?.allowedMcpServers`.

## Tests (extend existing specs)

- types: `promptComponentSchema` accepts array/undefined/empty, rejects non-string.
- `shared/modes`: `getModeAllowedMcpServers` — override precedence, `[]` override beats built-in
  `undefined`, fallthrough to config, undefined when neither.
- `mcpServerRestriction.spec.ts`: built-in mode + `customModePrompts` override drives the guard.
- `system-prompt.spec.ts`: built-in mode override filters CAPABILITIES **and** the deferred-tools
  section (leak closed with `deferredTools` on).

## Verify

- root: `pnpm --filter @roo-code/types test`
- `src/`: `npx vitest run core/tools/__tests__/mcpServerRestriction.spec.ts core/prompts/__tests__/system-prompt.spec.ts core/prompts/tools core/task/__tests__`; `npx tsc --noEmit`
- `webview-ui/`: `npx tsc --noEmit`; `npx eslint src/components/modes`
- Manual: Modes → built-in Code → "Restrict to specific MCP servers" appears; pick a server;
  system-prompt preview shows only that server; switch modes + back persists; disallowed
  `use_mcp_tool` rejected.

## Out of scope

- Don't make built-in tool **groups** editable — only the MCP allowlist.
- Don't port the upstream "Flicker A guard"; don't add `@vitejs/plugin-react` blindly.
- No `.roomodes` changes (the dev host's rewrite that stripped the translate fileRegex was reverted).

Credit (extends #453): `Co-authored-by: simurg79 <84179478+simurg79@users.noreply.github.com>` /
`Co-authored-by: Bertan Ari <bertanari@microsoft.com>`.
