# Claude Code — Tool Registry & Context Loading

**Source on disk:** `/home/krzych/Projekty/QUB-IT/claude-code-src-leaked/`
(Leaked Claude Code CLI source; git branch `main`, commit `7bf233a`.)

---

## 1. Registry model — static, not autodiscovered

There is **no filesystem scan** for tools. Three different artifacts use three
different registration strategies:

| Artifact             | Discovery                                                                      | File                                    |
| -------------------- | ------------------------------------------------------------------------------ | --------------------------------------- |
| **Tools**            | Static hand-maintained array in `getAllBaseTools()`                            | `tools.ts:193`                          |
| **Slash commands**   | Static imports + `feature()` gating                                            | `commands.ts:476` (`getCommands(cwd)`)  |
| **Skills**           | Filesystem walk of project/user/plugin `/skills` dirs (markdown + frontmatter) | `skills/loadSkillsDir.ts`               |
| **Built-in plugins** | `Map` populated by `registerBuiltinPlugin()` at startup                        | `plugins/builtinPlugins.ts:21`          |
| **MCP servers**      | Dynamic at runtime via `MCPConnectionManager`                                  | `services/mcp/MCPConnectionManager.tsx` |

### Why the tools list is static

The big clue is the comment at `tools.ts:191`:

> NOTE: This MUST stay in sync with the Statsig dynamic config
> `claude_code_global_system_caching`, in order to cache the system prompt
> across users.

…and at `tools.ts:354-360`:

> The server's `claude_code_system_cache_policy` places a global cache
> breakpoint after the last prefix-matched built-in tool; a flat sort would
> interleave MCP tools into built-ins and invalidate all downstream cache keys
> whenever an MCP tool sorts between existing built-ins. `uniqBy` preserves
> insertion order, so built-ins win on name conflict.

Tool order has to be deterministic across every user on the planet so the
provider-side prompt cache key matches. A filesystem walk would break that.

### Gating mechanisms (instead of discovery)

- **Build-time:** `feature('FLAG')` from `bun:bundle` — dead-code elimination
  at bundle time. ~20 tools and ~10 commands are gated this way.
- **Runtime env:** `process.env.USER_TYPE === 'ant'`, `CLAUDE_CODE_SIMPLE`,
  `NODE_ENV === 'test'`, `CLAUDE_CODE_VERIFY_PLAN`, etc.
- **Runtime helpers:** `isTodoV2Enabled()`, `isAgentSwarmsEnabled()`,
  `isWorktreeModeEnabled()`, `isPowerShellToolEnabled()`,
  `isToolSearchEnabledOptimistic()`, `isReplModeEnabled()`.
- **Per-tool `isEnabled()`:** every Tool implements this; result is filtered
  in `getTools()` (`tools.ts:325`).
- **Deny rules:** `filterToolsByDenyRules()` strips tools matching user
  permission deny rules **before** the model sees them (`tools.ts:262`).

### Assembly pipeline

```
getAllBaseTools()                         // tools.ts:193 — static universe
  → getTools(permissionContext)           // tools.ts:271 — deny + isEnabled
    → assembleToolPool(ctx, mcpTools)     // tools.ts:345 — merge MCP, sort, dedupe
      → getMergedTools(...)               // tools.ts:383 — final array for the request
```

### Tool interface (relevant fields)

Defined at `Tool.ts:456`:

```ts
{
  name: string
  inputSchema: ZodSchema | inputJSONSchema
  prompt(opts): Promise<string>       // ← description sent to the model
  isEnabled(): boolean
  isReadOnly(input): boolean
  isDestructive?(input): boolean
  isConcurrencySafe(input): boolean
  call(args, ctx, ...): Promise<ToolResult>
  // …plus ~20 optional UI / hook / permission methods
  shouldDefer?: boolean               // ← opt-in to deferred loading
  alwaysLoad?: boolean                // ← opt-out (always send full schema)
  isMcp?: boolean                     // ← MCP tools default to deferred
}
```

---

## 2. How tool descriptions get into the model's context

### The base case — every active tool, every request

For each request, `claude.ts` maps every active tool through
`toolToAPISchema(tool, …)` (`utils/api.ts:119`). The result is:

```ts
{
  name: tool.name,
  description: await tool.prompt({ ... }),                  // full markdown prompt
  input_schema: zodToJsonSchema(tool.inputSchema),          // or tool.inputJSONSchema
  strict?, eager_input_streaming?, defer_loading?, cache_control?
}
```

This whole array goes into the `tools` field of the Messages API request.
**So yes — by default every active tool's name + description + JSON schema
is sent on every request.**

### Cost control — three layers of caching

1. **Per-tool schema cache** (`utils/api.ts:147-208`, `toolSchemaCache.ts`):
   computes name/description/input_schema once per session, keyed by
   `name` (or `name + jsonStringify(inputJSONSchema)` for MCP/StructuredOutput).
   Prevents mid-session GrowthBook flips from churning the bytes.
2. **Provider prompt cache:** the tool array is laid out as a stable
   contiguous prefix (built-ins sorted, MCP sorted after, see comments at
   `tools.ts:354-360`) so the API's cache hits across turns and across users.
3. **Global system caching:** the order of `getAllBaseTools()` is mirrored
   in a Statsig config so the cache key is identical across every Claude
   Code install in the world.

### The escape hatch — `defer_loading` / ToolSearch

For installs with many MCP tools / large plugin sets, sending every
description on every turn is wasteful. `defer_loading` solves this:

- **Selection** — `isDeferredTool(tool)` at `tools/ToolSearchTool/prompt.ts:62`:
    - `alwaysLoad: true` → never deferred (checked first).
    - `isMcp: true` → deferred (workflow-specific).
    - Hardcoded "always available turn 1": `ToolSearch` itself,
      `Agent` (under `FORK_SUBAGENT`), `Brief` (under `KAIROS_*`),
      `SendUserFile`.
    - Otherwise: `tool.shouldDefer === true`.
- **Serialization** — `toolToAPISchema()` sets `defer_loading: true` on
  the tool entry (`utils/api.ts:223-226`). The API then **sends only
  the name** to the model — no `description`, no `input_schema`.
- **Discovery on the model side** — deferred tool names are advertised
  in a `<system-reminder>` block (or the legacy `<available-deferred-tools>`
  block; gated by `tengu_glacier_2xr`). The model knows the names but
  cannot call them.
- **Materialization** — the model calls **`ToolSearch`** with one of:

    - `select:Name1,Name2` — fetch these exact tools by name
    - keyword query — keyword search, top N matches
    - `+slack send` — require "slack" in the name, rank by remaining terms

    ToolSearch returns each matched tool's full schema as
    `<function>{"description": "...", "name": "...", "parameters": {...}}</function>`
    lines inside a `<functions>` block. After that, the tool is callable
    exactly like a turn-1 tool.

- **Cache interaction** — deferred tools are excluded from the per-tool
  prompt-cache hash (`services/api/claude.ts:1461-1466`) because the API
  strips them from cached prefixes anyway.

- **Beta gating** — `defer_loading` only works behind the `advanced-tool-use`
  (1P/Foundry) or `tool-search-tool` (Vertex/Bedrock) beta header. If
  `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1`, every tool schema is reduced
  to `{name, description, input_schema, cache_control?}` and **all** tools
  go back to being fully loaded (`utils/api.ts:243-260`).

### Where the description text comes from

Each tool's async `prompt({ getToolPermissionContext, tools, agents,
allowedAgentTypes })` (`Tool.ts:518`):

- **Static tools** — return a string from a co-located `prompt.ts` (e.g.
  `tools/BashTool/prompt.ts`).
- **Context-aware tools** — build the prompt dynamically from the current
  tools/agents list:
    - `AgentTool` lists all available subagent types.
    - `SkillTool` lists all currently loaded skills.
    - `ToolSearchTool` adapts its own copy depending on whether the
      "delta announcement" feature is on.
- **MCP tools** — description comes from the MCP server's
  `tools/list` response; `input_schema` is the server's JSON schema verbatim.

---

## 3. TL;DR

- Tools are **explicitly listed** in `tools.ts` — no autodiscovery, by design,
  for prompt-cache stability across all users.
- Skills, plugins, and MCP **are** discovered (filesystem / runtime).
- Every active tool's full `{name, description, input_schema}` is sent on
  every request by default. Multiple cache layers make this cheap.
- For large tool sets, `defer_loading: true` + the `ToolSearch` tool lets
  the model see only **tool names** up front, then materialize full schemas
  on demand. MCP tools are deferred by default.

---

# Roo Code — Tool Registry & Context Loading

**Source on disk:** `/home/krzych/Projekty/QUB-IT/Roo-Code/`

## 4. How Roo Code does it today

### Registration

| Artifact            | Discovery                                                                          | File                                                                               |
| ------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| **Native tools**    | Static array returned by `getNativeTools()`                                        | `src/core/prompts/tools/native-tools/index.ts:42`                                  |
| **Tool groups**     | Static `TOOL_GROUPS` constant (`read`, `edit`, `command`, `mcp`, `modes`)          | `src/shared/tools.ts:296`                                                          |
| **Always-on tools** | Static `ALWAYS_AVAILABLE_TOOLS` constant                                           | `src/shared/tools.ts:317`                                                          |
| **Aliases**         | Static `TOOL_ALIASES` map (`edit_file → apply_diff`, `write_file → write_to_file`) | `src/shared/tools.ts:337`                                                          |
| **MCP tools**       | Runtime — `getMcpServerTools(mcpHub)`                                              | `src/core/prompts/tools/native-tools/mcp_server.ts`                                |
| **Custom tools**    | **Filesystem autodiscovery** — walks `<roo-config-dir>/tools/*.{ts,js}`            | `packages/core/src/custom-tools/custom-tool-registry.ts:31` (`CustomToolRegistry`) |

So Roo Code does have one piece of autodiscovery that Claude Code does _not_:
the `CustomToolRegistry.loadFromDirectoriesIfStale()` walks user tool dirs,
type-checks/bundles each `*.ts` via esbuild, validates the export, and
registers it. Gated by `experiments.customTools`.

### Per-request assembly

`src/core/task/build-tools.ts:82` — `buildNativeToolsArrayWithRestrictions()`:

1. `getNativeTools({ supportsImages })` — static list, with a `read_file`
   variant depending on `supportsImages`.
2. `filterNativeToolsForMode(...)` — applies the current Mode (`code`,
   `architect`, `ask`, `debug`, `orchestrator`, custom), the model's
   `excludedTools` / `includedTools`, settings like `todoListEnabled`, and
   experiment gates (`imageGeneration`, `runSlashCommand`).
3. `getMcpServerTools(mcpHub)` + `filterMcpToolsForMode(...)`.
4. `customToolRegistry.loadFromDirectoriesIfStale(toolDirs)` →
   `getAllSerialized().map(formatNative)`.
5. Concatenate `[native, mcp, custom]`, return.

Each provider (`anthropic.ts`, `openai.ts`, `bedrock.ts`, `gemini.ts`, …)
takes that array via `metadata.tools` and **converts it to its native
format** before calling its SDK. Roo Code is multi-provider, so it can't
rely on a single provider's prompt-cache layout.

### What goes into context

**Every** filtered tool's full `{name, description, JSON-Schema parameters}`
is sent in every request, in every provider. There is **no deferred-loading
mechanism** — `grep -r "defer_loading\|shouldDefer\|alwaysLoad\|ToolSearch"
src/` returns nothing.

The cache-stability discipline isn't there either:

- No equivalent of `toolSchemaCache` (cached `{name, description,
input_schema}` triples keyed by tool identity). `RENAMED_TOOL_CACHE` only
  caches alias rewrites.
- Tool array order is `[native, mcp, custom]` — stable, but no explicit
  cache-breakpoint placement and no documented invariant.

---

## 5. Could Roo Code benefit from the same ideas?

Yes — three different ideas, with very different value.

### A. ToolSearch-style deferred loading for MCP + custom tools ★★★ high value

**The problem in Roo Code.** A user with 4 MCP servers × 12 tools each =
**~48 tool entries** going in every system prompt, on every turn. The
typical native-tool description is ~300–800 tokens including the JSON
schema. That's 15k–40k tokens of tools alone, every request, every turn,
across every provider. Many MCP tools are workflow-specific and only used
once per session.

**The proposed mechanism (port from Claude Code).**

- Add `shouldDefer?: boolean` and `alwaysLoad?: boolean` to the tool
  metadata (extend the per-tool object in `getNativeTools()` and the MCP
  tool list returned by `getMcpServerTools()`).
- Default MCP tools to `shouldDefer: true` (mirroring
  `isDeferredTool` at `tools/ToolSearchTool/prompt.ts:62`).
- In `build-tools.ts`, when a tool would be deferred:
    - For **Anthropic provider** with the `advanced-tool-use` beta enabled,
      emit `defer_loading: true` on the tool entry. (Provider-side.)
    - For **OpenAI/Bedrock/etc.** that don't support `defer_loading`: replace
      the deferred tool with a single virtual `tools_load` (or `search_tools`)
      entry whose `description` enumerates the deferred names. The model
      calls `tools_load({ names: [...] })`, Roo Code injects the resolved
      schemas into the next assistant turn as a system message (similar to
      Roo's existing `say()` mechanism for environment details).
- The `ALWAYS_AVAILABLE_TOOLS` constant becomes a natural `alwaysLoad`
  whitelist.

**Why this is the highest-value port.** Roo Code's biggest token sink is
the MCP tool list; this is also the area where most MCP tools are
unused on any given turn. Even without provider-level `defer_loading`
support, the userland-emulation version (a meta-`search_tools`) saves
substantial tokens whenever the user keeps >10 MCP tools enabled.

**Where to land it.**

1. Add `shouldDefer`/`alwaysLoad` columns to `ToolGroupConfig` in
   `src/shared/tools.ts:262`.
2. Implement an `applyDeferralStrategy(tools, providerCapabilities)`
   pass at the bottom of `buildNativeToolsArrayWithRestrictions`.
3. Add a new native tool `tools_load` (or alias `search_tools`) in
   `src/core/prompts/tools/native-tools/` whose handler lives in
   `src/core/tools/ToolsLoadTool.ts`. Its result blob is the same
   `<functions>{"name":..,"description":..,"parameters":..}</functions>`
   shape Claude Code uses, so the model's prior on the format transfers.
4. Provider-specific opt-in: `AnthropicHandler` sets the
   `advanced-tool-use` beta header and emits `defer_loading`; other
   providers use the userland emulation.

### B. A schema/prompt cache for tool definitions ★★ medium value

**The problem.** `getNativeTools(options)` rebuilds the tool array on
every `buildNativeToolsArrayWithRestrictions` call. Each tool's
description string lives in its module so the _strings_ aren't rebuilt,
but the per-provider conversion (`convertToolsForOpenAI`,
`convertOpenAIToolsToAnthropic`, etc.) is run fresh every request, and
produces the same bytes 99 % of the time.

**The proposed mechanism.** Mirror `utils/api.ts:147-208`
(`getToolSchemaCache()`):

- Key by `(toolName, providerId, modelInfo.flags)`.
- Memoize `{ name, description, input_schema }` per session.
- Per-request overlay only for things that genuinely change per call
  (`cache_control`, `allowedFunctionNames`).

**Why "medium".** Anthropic's prompt cache is the high-value reason for
Claude Code to be obsessive about byte stability. Roo Code's multi-provider
fan-out means only the Anthropic path actually benefits, and the saving is
CPU-time (sub-ms per request) more than tokens.

### C. Per-tool `prompt({ tools, ... })` async builder ★★ medium value

**The problem.** Roo Code's tool descriptions are static strings. Meta-tools
that _describe_ other tools — Roo's `skill`, `run_slash_command`,
`use_mcp_tool`, `new_task`, `switch_mode` — would benefit from describing
exactly which skills/commands/MCP servers/modes are currently available, the
way Claude Code's `AgentTool.prompt()` does.

Roo Code partially does this already (the `skill` tool prompt mentions
specific skills; the MCP wrapper enumerates servers). But the pattern is
ad-hoc: every meta-tool reinvents how it queries state.

**The proposed mechanism.** Add an optional `prompt(ctx)` method to the
native-tool definitions where `ctx` carries `{ tools, mcpHub, mode,
codeIndexManager }`. The static `description` field becomes a fallback
when `prompt` isn't defined. `build-tools.ts` calls `prompt(ctx)` for each
tool that has one, populating the description before the array is handed
to the provider.

**Why "medium".** Roo Code already has working ad-hoc versions of this.
The refactor pays back mostly in maintainability, less in capability.

### D. What NOT to port

- **Statsig-pinned tool order.** That serves _one_ shared provider-side
  cache across all of Anthropic's users. Roo Code's multi-provider model
  has no equivalent infrastructure and gets no benefit.
- **`feature()` build-time DCE.** Roo Code uses runtime experiment flags
  (`experiments.imageGeneration`) and `excludedTools`. Build-time DCE would
  trade dynamic config for shipping multiple `.vsix` builds — not worth
  it for a VS Code extension.
- **The Statsig dynamic-config-mirror discipline.** Same reason: there's
  no provider-side cache to protect.

---

## 6. Recommendation

If only one change ships: **port idea A — deferred MCP/custom tool loading
with a `tools_load`/`search_tools` meta-tool**. Concrete starting points:

1. `src/shared/tools.ts` — extend `ToolGroupConfig` and add the
   `shouldDefer`/`alwaysLoad` markers.
2. `src/core/prompts/tools/native-tools/index.ts` — new `tools_load`
   tool definition.
3. `src/core/tools/ToolsLoadTool.ts` — implementation that pulls schemas
   from the in-memory tool array (`buildNativeToolsArrayWithRestrictions`'s
   full pool, cached on the `Task`).
4. `src/core/task/build-tools.ts` — at the end of the function, run a
   `deferralPass` that replaces deferred tools' full definitions with a
   names-only attachment (a `system`-message announcement Roo Code already
   uses for environment details).
5. `src/api/providers/anthropic.ts` — opt-in beta header and emit
   `defer_loading: true` on deferred entries (skipping the userland
   emulation when the API supports it natively).

Expected effect on a heavy-MCP user: 30–60% reduction in the tools
section of the prompt, no change to behavior (deferred tools materialize
on demand via `tools_load`).
