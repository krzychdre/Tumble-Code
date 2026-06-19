# Port plan — Zoo PR #453 → `feature/zoo-453-per-mode-mcp-allowlist`

> **For the executor (read first).** Do the steps **in order**. Do **not**
> improvise, refactor beyond what is written, or add anything not listed
> (YAGNI). Every code block below is **already adapted to this repo** — paste it
> as-is unless a step says otherwise. If any precondition is false or a step
> doesn't behave as described, **STOP and report** — do not guess. This repo is
> **Tumble Code**: never introduce the strings "Roo" or "Zoo" in user-facing
> text. Internal ids (file names like `roomodes.json`, package id `Roo-Code`)
> **stay** — only user-visible strings are "Tumble".

> **This is a large, multi-file feature (23 files upstream).** It is split into
> two phases that can land independently:
>
> - **Phase A — backend (REQUIRED).** Schema + prompt/tool filtering + the
>   execution-time guard. This is the entire functional feature: once it lands,
>   a mode can restrict MCP servers via its `allowedMcpServers` list (set in the
>   custom-mode JSON / `.roomodes`), and disallowed servers are kept out of the
>   prompt, out of the native tool list, and rejected at call time. **Land Phase
>   A first and verify it green before touching Phase B.**
> - **Phase B — webview editor UI (OPTIONAL follow-up).** A checkbox editor in
>   the Modes view so users can set the allowlist from the GUI instead of editing
>   JSON. It pulls in heavier, brittle test scaffolding (a toolkit mock + a vitest
>   react plugin). The feature is **fully usable without Phase B** because the
>   schema accepts `allowedMcpServers` directly. Do Phase B only if asked, and as
>   a separate commit.

---

## 0. Context (read once, write no code)

- **Upstream:** Zoo PR #453 — "feat(modes): per-mode MCP server restrictions (allowlist)" (commit `c7f1d1933`).
- **What it does, one paragraph:** Adds an optional `allowedMcpServers: string[]`
  to a mode's config. When **undefined** (the default), every connected MCP
  server is available, exactly as today (fully backward compatible). When **set**
  to a list, only the named servers are injected into the system prompt and
  exposed as tools; an **empty `[]`** means _no_ MCP servers. The point is to keep
  specialized modes lean — a mode that only needs one MCP server no longer pays
  the context/token cost of every other server's tool schemas. There are three
  enforcement layers, all driven by the same allowlist: (1) the **system prompt**
  (CAPABILITIES line + MCP availability), (2) the **native tool list**
  (`getMcpServerTools` + `access_mcp_resource` gating), and (3) an
  **execution-time guard** that rejects a call to a disallowed server even if the
  model hallucinated it or pulled it from conversation history.
- **Why we want it, with evidence in OUR code:** Our fork targets weak/local
  models and already does deferred tool loading to fight context bloat; a
  per-mode MCP allowlist is the same direction. Today there is no way to scope
  MCP per mode: [`src/core/prompts/tools/native-tools/mcp_server.ts:14`](../src/core/prompts/tools/native-tools/mcp_server.ts#L14)
  (`getMcpServerTools(mcpHub)`) emits **every** server's tools, and
  [`src/core/prompts/tools/filter-tools-for-mode.ts:305`](../src/core/prompts/tools/filter-tools-for-mode.ts#L305)
  gates `access_mcp_resource` on the **whole** hub. A code-only mode that wants
  just one MCP server is forced to advertise all of them. This change is additive
  and opt-in — no existing mode behavior changes unless `allowedMcpServers` is set.
- **What we deliberately leave out (YAGNI):**
    - The upstream PR bundles an **unrelated flicker fix** in `ModesView.tsx` (a
      `visualModeRef` guard around the `setVisualMode(mode)` sync effect, commented
      "Flicker A guard"). It is **not** part of the allowlist feature. **Do NOT port
      it.** Keep our existing simple sync effect untouched.
    - We do not port the upstream's `eslint-disable` churn in `handleCreateMode`
      (the comment removal); we only add the one new dependency.
    - Phase B's component test (`McpServerRestriction.spec.tsx`, 458 lines, uses a
      React `<Profiler>` + a custom toolkit mock) is **optional**; land the two
      component files and the integration first, add that spec only if Phase B is
      being done thoroughly.
- **Original author(s) — credit them.** simurg79 and Bertan Ari. When you create
  the port commit (only if asked), include both trailers, one per line, at the
  end of the commit message:

    ```text
    Co-authored-by: simurg79 <84179478+simurg79@users.noreply.github.com>
    Co-authored-by: Bertan Ari <bertanari@microsoft.com>
    ```

## 1. Preconditions — verify before touching anything

- [ ] Current branch is `feature/zoo-453-per-mode-mcp-allowlist` (stacked on
      `feature/zoo-255-parse-json-string-mcp-args` because both touch
      `src/core/tools/UseMcpToolTool.ts`). Confirm with `git branch --show-current`.
- [ ] These files exist (the edits below depend on them):
    - `packages/types/src/mode.ts`
    - `schemas/roomodes.json`
    - `src/core/prompts/tools/native-tools/mcp_server.ts`
    - `src/core/prompts/tools/filter-tools-for-mode.ts`
    - `src/core/task/build-tools.ts`
    - `src/core/prompts/system.ts`
    - `src/core/prompts/sections/capabilities.ts`
    - `src/core/tools/UseMcpToolTool.ts`
    - `src/core/tools/accessMcpResourceTool.ts`
    - `src/shared/modes.ts` (exports `getModeBySlug`, `defaultModeSlug`)
- [ ] Run these and confirm each prints the quoted line **unchanged** (if any
      differs, STOP — the plan is stale):

```bash
sed -n '102,104p' packages/types/src/mode.ts
#   source: z.enum(["global", "project"]).optional(),
# })

grep -n 'export function getMcpServerTools(mcpHub?: McpHub)' src/core/prompts/tools/native-tools/mcp_server.ts
grep -n 'function hasAnyMcpResources(mcpHub: McpHub): boolean' src/core/prompts/tools/filter-tools-for-mode.ts
grep -n 'const mcpTools = getMcpServerTools(mcpHub)$' src/core/task/build-tools.ts
grep -n 'const hasMcpServers = mcpHub && mcpHub.getServers().length > 0' src/core/prompts/system.ts
grep -n 'export function getCapabilitiesSection(cwd: string, mcpHub?: McpHub): string' src/core/prompts/sections/capabilities.ts
```

---

# PHASE A — backend (required)

## A2. Write the failing tests FIRST (TDD)

Add all three test files, then run them and confirm they are **red** before
writing any production code.

### Test A — schema accepts `allowedMcpServers`

- **File (create):** `packages/types/src/__tests__/mode-allowedMcpServers.spec.ts`

```ts
import { modeConfigSchema } from "../mode.js"

describe("modeConfigSchema allowedMcpServers", () => {
	const baseModeConfig = {
		slug: "test-mode",
		name: "Test Mode",
		roleDefinition: "A test mode",
		groups: ["read" as const],
	}

	it("should accept valid allowedMcpServers array of strings", () => {
		const result = modeConfigSchema.safeParse({
			...baseModeConfig,
			allowedMcpServers: ["server1", "server2"],
		})
		expect(result.success).toBe(true)
		if (result.success) {
			expect(result.data.allowedMcpServers).toEqual(["server1", "server2"])
		}
	})

	it("should accept missing/undefined allowedMcpServers", () => {
		const result = modeConfigSchema.safeParse(baseModeConfig)
		expect(result.success).toBe(true)
		if (result.success) {
			expect(result.data.allowedMcpServers).toBeUndefined()
		}
	})

	it("should accept empty allowedMcpServers array", () => {
		const result = modeConfigSchema.safeParse({
			...baseModeConfig,
			allowedMcpServers: [],
		})
		expect(result.success).toBe(true)
		if (result.success) {
			expect(result.data.allowedMcpServers).toEqual([])
		}
	})

	it("should reject non-string array items", () => {
		const result = modeConfigSchema.safeParse({
			...baseModeConfig,
			allowedMcpServers: [123, 456],
		})
		expect(result.success).toBe(false)
	})

	it("should reject non-array value", () => {
		const result = modeConfigSchema.safeParse({
			...baseModeConfig,
			allowedMcpServers: "server1",
		})
		expect(result.success).toBe(false)
	})
})
```

- **Run (from repo root):** `pnpm --filter @roo-code/types test -- mode-allowedMcpServers`
  (or, from `packages/types/`: `npx vitest run src/__tests__/mode-allowedMcpServers.spec.ts`).
- **Expect it to FAIL:** Zod's default `.object()` **strips** unknown keys, so
  before the schema edit `allowedMcpServers` is dropped — the "array of strings"
  test sees `undefined` (not the array), and the two `reject` tests see
  `result.success === true` instead of `false`.

### Test B — native tool list honors the allowlist

- **File (create):** `src/core/prompts/tools/native-tools/__tests__/mcp_server.spec.ts`
- Paste the full spec from the upstream file (it already uses our paths
  `@roo-code/types`, `../../../../../services/mcp/McpHub`, `../mcp_server`). The
  **new** behavior is the final `describe("allowedServers filtering", …)` block;
  the earlier blocks document existing behavior and must also pass. Full file:

```ts
import type OpenAI from "openai"

import type { McpServer, McpTool } from "@roo-code/types"

import type { McpHub } from "../../../../../services/mcp/McpHub"

import { getMcpServerTools } from "../mcp_server"

// Helper type to access function tools
type FunctionTool = OpenAI.Chat.ChatCompletionTool & { type: "function" }

// Helper to get the function property from a tool
const getFunction = (tool: OpenAI.Chat.ChatCompletionTool) => (tool as FunctionTool).function

describe("getMcpServerTools", () => {
	const createMockTool = (name: string, description = "Test tool"): McpTool => ({
		name,
		description,
		inputSchema: {
			type: "object",
			properties: {},
		},
	})

	const createMockServer = (name: string, tools: McpTool[], source: "global" | "project" = "global"): McpServer => ({
		name,
		config: JSON.stringify({ type: "stdio", command: "test" }),
		status: "connected",
		source,
		tools,
	})

	const createMockMcpHub = (servers: McpServer[]): Partial<McpHub> => ({
		getServers: vi.fn().mockReturnValue(servers),
	})

	it("should return empty array when mcpHub is undefined", () => {
		const result = getMcpServerTools(undefined)
		expect(result).toEqual([])
	})

	it("should return empty array when no servers are available", () => {
		const mockHub = createMockMcpHub([])
		const result = getMcpServerTools(mockHub as McpHub)
		expect(result).toEqual([])
	})

	it("should generate tool definitions for server tools", () => {
		const server = createMockServer("testServer", [createMockTool("testTool")])
		const mockHub = createMockMcpHub([server])

		const result = getMcpServerTools(mockHub as McpHub)

		expect(result).toHaveLength(1)
		expect(result[0].type).toBe("function")
		expect(getFunction(result[0]).name).toBe("mcp--testServer--testTool")
		expect(getFunction(result[0]).description).toBe("Test tool")
	})

	it("should filter out tools with enabledForPrompt set to false", () => {
		const enabledTool = createMockTool("enabledTool")
		const disabledTool = { ...createMockTool("disabledTool"), enabledForPrompt: false }
		const server = createMockServer("testServer", [enabledTool, disabledTool])
		const mockHub = createMockMcpHub([server])

		const result = getMcpServerTools(mockHub as McpHub)

		expect(result).toHaveLength(1)
		expect(getFunction(result[0]).name).toBe("mcp--testServer--enabledTool")
	})

	it("should deduplicate tools when same server exists in both global and project configs", () => {
		const projectServer = createMockServer(
			"context7",
			[createMockTool("resolve-library-id", "Project description")],
			"project",
		)

		const mockHub = createMockMcpHub([projectServer])

		const result = getMcpServerTools(mockHub as McpHub)

		expect(result).toHaveLength(1)
		expect(getFunction(result[0]).name).toBe("mcp--context7--resolve-library-id")
		expect(getFunction(result[0]).description).toBe("Project description")
	})

	it("should allow tools with different names from the same server", () => {
		const server = createMockServer("testServer", [
			createMockTool("tool1"),
			createMockTool("tool2"),
			createMockTool("tool3"),
		])
		const mockHub = createMockMcpHub([server])

		const result = getMcpServerTools(mockHub as McpHub)

		expect(result).toHaveLength(3)
		const toolNames = result.map((t) => getFunction(t).name)
		expect(toolNames).toContain("mcp--testServer--tool1")
		expect(toolNames).toContain("mcp--testServer--tool2")
		expect(toolNames).toContain("mcp--testServer--tool3")
	})

	it("should allow tools with same name from different servers", () => {
		const server1 = createMockServer("server1", [createMockTool("commonTool")])
		const server2 = createMockServer("server2", [createMockTool("commonTool")])
		const mockHub = createMockMcpHub([server1, server2])

		const result = getMcpServerTools(mockHub as McpHub)

		expect(result).toHaveLength(2)
		const toolNames = result.map((t) => getFunction(t).name)
		expect(toolNames).toContain("mcp--server1--commonTool")
		expect(toolNames).toContain("mcp--server2--commonTool")
	})

	it("should skip servers without tools", () => {
		const serverWithTools = createMockServer("withTools", [createMockTool("tool1")])
		const serverWithoutTools = createMockServer("withoutTools", [])
		const serverWithUndefinedTools: McpServer = {
			...createMockServer("undefinedTools", []),
			tools: undefined,
		}
		const mockHub = createMockMcpHub([serverWithTools, serverWithoutTools, serverWithUndefinedTools])

		const result = getMcpServerTools(mockHub as McpHub)

		expect(result).toHaveLength(1)
		expect(getFunction(result[0]).name).toBe("mcp--withTools--tool1")
	})

	describe("allowedServers filtering", () => {
		it("should return all tools when allowedServers is undefined", () => {
			const server1 = createMockServer("server1", [createMockTool("tool1")])
			const server2 = createMockServer("server2", [createMockTool("tool2")])
			const mockHub = createMockMcpHub([server1, server2])

			const result = getMcpServerTools(mockHub as McpHub, undefined)

			expect(result).toHaveLength(2)
			const toolNames = result.map((t) => getFunction(t).name)
			expect(toolNames).toContain("mcp--server1--tool1")
			expect(toolNames).toContain("mcp--server2--tool2")
		})

		it("should return only tools from allowed servers when allowedServers is provided", () => {
			const server1 = createMockServer("server1", [createMockTool("tool1")])
			const server2 = createMockServer("server2", [createMockTool("tool2")])
			const server3 = createMockServer("server3", [createMockTool("tool3")])
			const mockHub = createMockMcpHub([server1, server2, server3])

			const result = getMcpServerTools(mockHub as McpHub, ["server1", "server3"])

			expect(result).toHaveLength(2)
			const toolNames = result.map((t) => getFunction(t).name)
			expect(toolNames).toContain("mcp--server1--tool1")
			expect(toolNames).toContain("mcp--server3--tool3")
			expect(toolNames).not.toContain("mcp--server2--tool2")
		})

		it("should return empty array when allowedServers is empty array", () => {
			const server1 = createMockServer("server1", [createMockTool("tool1")])
			const server2 = createMockServer("server2", [createMockTool("tool2")])
			const mockHub = createMockMcpHub([server1, server2])

			const result = getMcpServerTools(mockHub as McpHub, [])

			expect(result).toEqual([])
		})

		it("should ignore server names in allowedServers not found in hub", () => {
			const server1 = createMockServer("server1", [createMockTool("tool1")])
			const mockHub = createMockMcpHub([server1])

			const result = getMcpServerTools(mockHub as McpHub, ["server1", "nonexistent-server"])

			expect(result).toHaveLength(1)
			expect(getFunction(result[0]).name).toBe("mcp--server1--tool1")
		})
	})
})
```

- **Run (from `src/`):** `npx vitest run core/prompts/tools/native-tools/__tests__/mcp_server.spec.ts`
- **Expect it to FAIL** in the `allowedServers filtering` block: pre-edit,
  `getMcpServerTools` ignores the second argument, so the empty-array case returns
  2 tools instead of `[]`, and the `["server1","server3"]` case returns all 3.
  (TS may also error because the function takes only one parameter — that is an
  acceptable form of red.)

### Test C — execution-time guard

- **File (create):** `src/core/tools/__tests__/mcpServerRestriction.spec.ts`

```ts
// npx vitest run core/tools/__tests__/mcpServerRestriction.spec.ts

import type { Task } from "../../task/Task"
import { isMcpServerAllowed, getAllowedMcpServersForTask, ensureMcpServerAllowed } from "../mcpServerRestriction"

vi.mock("../../../shared/modes", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../../shared/modes")>()
	return {
		...actual,
		defaultModeSlug: "code",
		getModeBySlug: vi.fn(),
	}
})

import { getModeBySlug } from "../../../shared/modes"

const toolError = (error: string) => `ERR:${error}`

function makeTask(state: any): Task {
	return {
		providerRef: {
			deref: () => ({
				getState: vi.fn().mockResolvedValue(state),
			}),
		},
		consecutiveMistakeCount: 0,
		didToolFailInCurrentTurn: false,
		recordToolError: vi.fn(),
	} as unknown as Task
}

describe("isMcpServerAllowed", () => {
	it("allows all servers when allowlist is undefined (backward compatible)", () => {
		expect(isMcpServerAllowed("any-server", undefined)).toBe(true)
	})

	it("rejects all servers when allowlist is empty", () => {
		expect(isMcpServerAllowed("any-server", [])).toBe(false)
	})

	it("allows a server present in a populated allowlist", () => {
		expect(isMcpServerAllowed("allowed", ["allowed", "other"])).toBe(true)
	})

	it("rejects a server absent from a populated allowlist", () => {
		expect(isMcpServerAllowed("disallowed", ["allowed", "other"])).toBe(false)
	})
})

describe("getAllowedMcpServersForTask", () => {
	beforeEach(() => {
		vi.mocked(getModeBySlug).mockReset()
	})

	it("returns the mode's allowedMcpServers when defined", async () => {
		vi.mocked(getModeBySlug).mockReturnValue({
			slug: "code",
			name: "Code",
			roleDefinition: "",
			groups: ["mcp"],
			allowedMcpServers: ["srv-a"],
		} as any)
		const task = makeTask({ mode: "code", customModes: [] })
		await expect(getAllowedMcpServersForTask(task)).resolves.toEqual(["srv-a"])
	})

	it("returns undefined when the mode does not restrict servers", async () => {
		vi.mocked(getModeBySlug).mockReturnValue({
			slug: "code",
			name: "Code",
			roleDefinition: "",
			groups: ["mcp"],
		} as any)
		const task = makeTask({ mode: "code", customModes: [] })
		await expect(getAllowedMcpServersForTask(task)).resolves.toBeUndefined()
	})

	it("returns undefined when the mode cannot be resolved", async () => {
		vi.mocked(getModeBySlug).mockReturnValue(undefined as any)
		const task = makeTask({ mode: "missing", customModes: [] })
		await expect(getAllowedMcpServersForTask(task)).resolves.toBeUndefined()
	})
})

describe("ensureMcpServerAllowed", () => {
	beforeEach(() => {
		vi.mocked(getModeBySlug).mockReset()
	})

	function mockModeAllowlist(allowedMcpServers?: string[]) {
		vi.mocked(getModeBySlug).mockReturnValue({
			slug: "code",
			name: "Code",
			roleDefinition: "",
			groups: ["mcp"],
			...(allowedMcpServers !== undefined ? { allowedMcpServers } : {}),
		} as any)
	}

	it("allows invocation when allowlist is undefined (allows all)", async () => {
		mockModeAllowlist(undefined)
		const task = makeTask({ mode: "code", customModes: [] })
		const pushToolResult = vi.fn()

		const result = await ensureMcpServerAllowed(task, "use_mcp_tool", "anything", pushToolResult, toolError)

		expect(result).toBe(true)
		expect(pushToolResult).not.toHaveBeenCalled()
		expect(task.recordToolError).not.toHaveBeenCalled()
	})

	it("allows invocation when server is in the populated allowlist", async () => {
		mockModeAllowlist(["allowed-server"])
		const task = makeTask({ mode: "code", customModes: [] })
		const pushToolResult = vi.fn()

		const result = await ensureMcpServerAllowed(task, "use_mcp_tool", "allowed-server", pushToolResult, toolError)

		expect(result).toBe(true)
		expect(pushToolResult).not.toHaveBeenCalled()
	})

	it("rejects invocation when server is NOT in the populated allowlist", async () => {
		mockModeAllowlist(["allowed-server"])
		const task = makeTask({ mode: "code", customModes: [] })
		const pushToolResult = vi.fn()

		const result = await ensureMcpServerAllowed(
			task,
			"use_mcp_tool",
			"disallowed-server",
			pushToolResult,
			toolError,
		)

		expect(result).toBe(false)
		expect(task.consecutiveMistakeCount).toBe(1)
		expect(task.didToolFailInCurrentTurn).toBe(true)
		expect(task.recordToolError).toHaveBeenCalledWith("use_mcp_tool")
		expect(pushToolResult).toHaveBeenCalledTimes(1)
		const message = (pushToolResult as any).mock.calls[0][0] as string
		expect(message).toContain("disallowed-server")
		expect(message).toContain("not allowed")
		expect(message).toContain("allowed-server")
	})

	it("rejects all invocations when allowlist is empty", async () => {
		mockModeAllowlist([])
		const task = makeTask({ mode: "code", customModes: [] })
		const pushToolResult = vi.fn()

		const result = await ensureMcpServerAllowed(
			task,
			"access_mcp_resource",
			"any-server",
			pushToolResult,
			toolError,
		)

		expect(result).toBe(false)
		expect(task.recordToolError).toHaveBeenCalledWith("access_mcp_resource")
		const message = (pushToolResult as any).mock.calls[0][0] as string
		expect(message).toContain("No MCP servers are allowed")
	})
})
```

- **Run (from `src/`):** `npx vitest run core/tools/__tests__/mcpServerRestriction.spec.ts`
- **Expect it to FAIL** at import: `../mcpServerRestriction` does not exist yet
  (module-not-found). That is the red.

## A3. Implement — backend edits

Do these in order. Re-run the matching test after each related group.

### Edit A1 — `packages/types/src/mode.ts` (schema)

Replace:

```ts
	source: z.enum(["global", "project"]).optional(),
})
```

With:

```ts
	source: z.enum(["global", "project"]).optional(),
	allowedMcpServers: z
		.array(z.string())
		.describe(
			"Optional list of MCP server names to include. When omitted, all servers are available. When set, only the listed servers are injected.",
		)
		.optional(),
})
```

> Make sure you replace the `source:` line **inside `modeConfigSchema`** (around
> line 102), not a different schema. The `})` immediately after `source:` is the
> close of `modeConfigSchema`.

### Edit A2 — `schemas/roomodes.json` (generated JSON schema, keep filename)

Replace:

```json
					"type": "string",
						"enum": ["global", "project"]
					},
					"groups": {
```

> The exact indentation in the file is tabs; match it. The `source` property
> block looks like this in context — insert `allowedMcpServers` **between** > `source` and `groups`. Find:

```json
					"source": {
						"type": "string",
						"enum": ["global", "project"]
					},
					"groups": {
```

With:

```json
					"source": {
						"type": "string",
						"enum": ["global", "project"]
					},
					"allowedMcpServers": {
						"type": "array",
						"items": {
							"type": "string"
						},
						"description": "Optional list of MCP server names to include. When omitted, all servers are available. When set, only the listed servers are injected."
					},
					"groups": {
```

### Edit A3 — create `src/core/tools/mcpServerRestriction.ts` (new helper)

Create the file with **exactly** this content (no Roo/Zoo user-facing strings;
internal imports already match our paths):

```ts
import { getModeBySlug, defaultModeSlug } from "../../shared/modes"
import { Task } from "../task/Task"

/**
 * Pure predicate: is `serverName` permitted by the (optional) per-mode allowlist?
 *
 * Semantics (mirrors the listing/filtering layer):
 *   - `undefined` allowlist → ALL servers allowed (backward compatible, feature opt-in)
 *   - empty `[]` allowlist   → NO servers allowed (every invocation rejected)
 *   - populated allowlist    → only listed server names allowed
 *
 * @param serverName The server the model is attempting to invoke.
 * @param allowedMcpServers The mode's allowlist, or `undefined` when the mode does not restrict MCP.
 * @returns true if the invocation should be permitted.
 */
export function isMcpServerAllowed(serverName: string, allowedMcpServers?: string[]): boolean {
	// No allowlist defined → unrestricted (backward compatible).
	if (allowedMcpServers === undefined) {
		return true
	}
	// Defined allowlist (including empty) → membership test. Empty array rejects everything.
	return new Set(allowedMcpServers).has(serverName)
}

/**
 * Resolves the current mode's MCP server allowlist from provider state.
 *
 * Returns `undefined` when the mode does not restrict MCP servers (or when the mode/state
 * cannot be resolved), which the predicate treats as "unrestricted".
 *
 * @param task The current task, used to reach provider state.
 * @returns The mode's `allowedMcpServers` allowlist, or `undefined` when unrestricted.
 */
export async function getAllowedMcpServersForTask(task: Task): Promise<string[] | undefined> {
	const provider = task.providerRef.deref()

	// Be defensive: provider may be gone, or `getState` may be unavailable (e.g. in tests).
	// In those cases we cannot determine an allowlist, so treat the mode as unrestricted to
	// avoid breaking tool execution — the listing/filtering layer remains the primary control.
	if (!provider || typeof provider.getState !== "function") {
		return undefined
	}

	try {
		const state = await provider.getState()
		const modeSlug = state?.mode ?? defaultModeSlug
		const modeConfig = getModeBySlug(modeSlug, state?.customModes)
		return modeConfig?.allowedMcpServers
	} catch {
		return undefined
	}
}

/**
 * Execution-time defense layer for per-mode MCP server restrictions.
 *
 * The listing/filtering layer (build-tools / filter-tools-for-mode / system prompt) only
 * controls which tools are *advertised* to the model. A model may still emit a tool call that
 * references a disallowed server (e.g. from earlier conversation history or hallucination). This
 * guard rejects such invocations at execution time so a disallowed server can never be reached.
 *
 * On rejection it records the tool error and pushes a clear, model-facing error message via
 * `pushToolResult` (consistent with other tool-validation failures) rather than throwing.
 *
 * @param task The current task.
 * @param toolName The MCP tool being invoked (for error reporting).
 * @param serverName The server name the model is attempting to use.
 * @param pushToolResult Callback used to surface the rejection to the model.
 * @param toolError Formatter to wrap the message as a tool error result.
 * @returns true if the invocation is allowed; false if it was rejected (caller must return).
 */
export async function ensureMcpServerAllowed(
	task: Task,
	toolName: "use_mcp_tool" | "access_mcp_resource",
	serverName: string,
	pushToolResult: (content: string) => void,
	toolError: (error: string) => string,
): Promise<boolean> {
	const allowedMcpServers = await getAllowedMcpServersForTask(task)

	if (isMcpServerAllowed(serverName, allowedMcpServers)) {
		return true
	}

	task.consecutiveMistakeCount++
	task.recordToolError(toolName)
	task.didToolFailInCurrentTurn = true

	const allowList = allowedMcpServers ?? []
	const allowedDescription =
		allowList.length > 0
			? `Allowed servers for this mode: ${allowList.join(", ")}.`
			: "No MCP servers are allowed in this mode."

	pushToolResult(
		toolError(
			`The MCP server "${serverName}" is not allowed in the current mode. ${allowedDescription} ` +
				`Do not attempt to use this server; choose an allowed server or a different approach.`,
		),
	)

	return false
}
```

> Run Test C now — it should go green.

### Edit A4 — `src/core/prompts/tools/native-tools/mcp_server.ts`

Replace:

```ts
export function getMcpServerTools(mcpHub?: McpHub): OpenAI.Chat.ChatCompletionTool[] {
	if (!mcpHub) {
		return []
	}

	const servers = mcpHub.getServers()
```

With:

```ts
export function getMcpServerTools(mcpHub?: McpHub, allowedServers?: string[]): OpenAI.Chat.ChatCompletionTool[] {
	if (!mcpHub) {
		return []
	}

	let servers = mcpHub.getServers()

	// Filter servers by allowlist if provided
	if (allowedServers) {
		const allowSet = new Set(allowedServers)
		servers = servers.filter((s) => allowSet.has(s.name))
	}
```

> Run Test B now — it should go green.

### Edit A5 — `src/core/prompts/tools/filter-tools-for-mode.ts`

**A5a — add the parameter.** Replace:

```ts
	codeIndexManager?: CodeIndexManager,
	settings?: Record<string, any>,
	mcpHub?: McpHub,
): OpenAI.Chat.ChatCompletionTool[] {
```

With:

```ts
	codeIndexManager?: CodeIndexManager,
	settings?: Record<string, any>,
	mcpHub?: McpHub,
	allowedMcpServers?: string[],
): OpenAI.Chat.ChatCompletionTool[] {
```

**A5b — gate `access_mcp_resource` on the allowlist.** Replace:

```ts
// Conditionally exclude access_mcp_resource if MCP is not enabled or there are no resources
if (!mcpHub || !hasAnyMcpResources(mcpHub)) {
	allowedToolNames.delete("access_mcp_resource")
}
```

With:

```ts
// Conditionally exclude access_mcp_resource if MCP is not enabled or there are no resources.
// When the mode restricts MCP servers via allowedMcpServers, only resources from allowed
// servers count — otherwise a restricted mode could still read resources from disallowed servers.
// Fall back to the mode config's own allowlist when the caller omits the parameter, so the
// restriction is enforced regardless of call site (defense in depth).
const effectiveAllowedMcpServers = allowedMcpServers ?? modeConfig.allowedMcpServers
if (!mcpHub || !hasAnyMcpResources(mcpHub, effectiveAllowedMcpServers)) {
	allowedToolNames.delete("access_mcp_resource")
}
```

> `modeConfig` is already in scope at this point in the function (declared near
> the top as `let modeConfig = getModeBySlug(...)`). If your grep in §1 showed it,
> this compiles.

**A5c — filter inside `hasAnyMcpResources`.** Replace:

```ts
function hasAnyMcpResources(mcpHub: McpHub): boolean {
	const servers = mcpHub.getServers()
	return servers.some((server) => server.resources && server.resources.length > 0)
}
```

With:

```ts
function hasAnyMcpResources(mcpHub: McpHub, allowedServers?: string[]): boolean {
	let servers = mcpHub.getServers()
	if (allowedServers) {
		const allowSet = new Set(allowedServers)
		servers = servers.filter((server) => allowSet.has(server.name))
	}
	return servers.some((server) => server.resources && server.resources.length > 0)
}
```

### Edit A6 — `src/core/task/build-tools.ts`

**A6a — import the mode resolvers.** Replace:

```ts
import { getRooDirectoriesForCwd } from "../../services/roo-config/index.js"
```

With:

```ts
import { getRooDirectoriesForCwd } from "../../services/roo-config/index.js"
import { getModeBySlug, defaultModeSlug } from "../../shared/modes"
```

**A6b — resolve the allowlist and forward it to both filters.** Replace:

```ts
// Filter native tools based on mode restrictions.
const filteredNativeTools = filterNativeToolsForMode(
	nativeTools,
	mode,
	customModes,
	experiments,
	codeIndexManager,
	filterSettings,
	mcpHub,
)

// Filter MCP tools based on mode restrictions.
const mcpTools = getMcpServerTools(mcpHub)
```

With:

```ts
// Resolve mode config to get allowedMcpServers for MCP server filtering.
const modeConfig = getModeBySlug(mode ?? defaultModeSlug, customModes)
const allowedMcpServers = modeConfig?.allowedMcpServers

// Filter native tools based on mode restrictions. The allowlist is forwarded so the
// access_mcp_resource availability check only considers resources from allowed servers;
// otherwise a restricted mode could still read resources from disallowed servers.
const filteredNativeTools = filterNativeToolsForMode(
	nativeTools,
	mode,
	customModes,
	experiments,
	codeIndexManager,
	filterSettings,
	mcpHub,
	allowedMcpServers,
)

// Filter MCP tools based on mode restrictions.
const mcpTools = getMcpServerTools(mcpHub, allowedMcpServers)
```

> If `mode` and `customModes` are not in scope at this point, STOP — they should
> be: they are already passed to `filterNativeToolsForMode` two lines below in the
> original. Use the same identifiers.

### Edit A7 — `src/core/prompts/sections/capabilities.ts`

Replace:

```ts
export function getCapabilitiesSection(cwd: string, mcpHub?: McpHub): string {
	return `====
```

With:

```ts
/**
 * Builds the CAPABILITIES section of the system prompt.
 *
 * The MCP availability line is only emitted when at least one MCP server is actually
 * exposed to the current mode. When `allowedMcpServers` is provided, the hub's server
 * list is filtered by that allowlist BEFORE deciding whether to advertise MCP, so the
 * capability text matches the per-mode tool exposure:
 *   - `undefined` allowlist  → all connected servers count (backward compatible)
 *   - empty `[]` allowlist   → no servers count ⇒ MCP line omitted
 *   - populated allowlist    → only listed servers count
 */
export function getCapabilitiesSection(cwd: string, mcpHub?: McpHub, allowedMcpServers?: string[]): string {
	// Determine whether any MCP server is actually available to the current mode.
	let hasMcpServers = false
	if (mcpHub) {
		let servers = mcpHub.getServers()
		if (allowedMcpServers) {
			const allowSet = new Set(allowedMcpServers)
			servers = servers.filter((server) => allowSet.has(server.name))
		}
		hasMcpServers = servers.length > 0
	}

	return `====
```

Then, **in the same file**, find the MCP conditional inside the returned
template (it gates the "You have access to MCP servers…" line). Replace the
conditional test `mcpHub` with `hasMcpServers`:

```ts
	}${
		mcpHub
			? `
```

With:

```ts
	}${
		hasMcpServers
			? `
```

> There is exactly **one** occurrence of `${\n\t\tmcpHub\n\t\t\t? \`` in this
file. If `grep -c 'mcpHub' src/core/prompts/sections/capabilities.ts` shows more
> than the signature + this conditional, re-read before editing.

### Edit A8 — `src/core/prompts/system.ts`

**A8a — compute MCP availability through the allowlist.** Replace:

```ts
const hasMcpServers = mcpHub && mcpHub.getServers().length > 0
const shouldIncludeMcp = hasMcpGroup && hasMcpServers
```

With:

```ts
const allowedMcpServers = modeConfig.allowedMcpServers

// Hoist the allowlist Set once (matches the sibling call sites, e.g. mcp_server.ts) instead
// of constructing a new Set on every `.filter` iteration.
const allowSet = allowedMcpServers ? new Set(allowedMcpServers) : undefined

let hasMcpServers = false
if (mcpHub) {
	const servers = allowSet ? mcpHub.getServers().filter((s) => allowSet.has(s.name)) : mcpHub.getServers()
	hasMcpServers = servers.length > 0
}
const shouldIncludeMcp = hasMcpGroup && hasMcpServers
```

**A8b — forward the allowlist to the capabilities section.** Replace:

```ts
${getCapabilitiesSection(cwd, shouldIncludeMcp ? mcpHub : undefined)}
```

With:

```ts
${
	// Forward the hub only when the mode actually exposes the MCP group, and pass the per-mode
	// allowlist through so the capabilities section filters servers using the SAME convention as
	// the tool-listing layer (a single source of truth for which servers are visible).
	getCapabilitiesSection(cwd, hasMcpGroup ? mcpHub : undefined, allowedMcpServers)
}
```

> NOTE: leave the other `mcpHub: shouldIncludeMcp ? mcpHub : undefined` line in
> this file (the one passed into the tools-catalog options) **unchanged** — Zoo
> did not touch it, and `shouldIncludeMcp` now already accounts for the allowlist.

### Edit A9 — `src/core/tools/UseMcpToolTool.ts` (invocation guard)

> This file was already modified by the #255 port (JSON-string arg parsing). The
> guard added here is independent and sits later in `execute()`.

**A9a — import the guard.** Replace:

```ts
import { BaseTool, ToolCallbacks } from "./BaseTool"

interface UseMcpToolParams {
```

With:

```ts
import { BaseTool, ToolCallbacks } from "./BaseTool"
import { ensureMcpServerAllowed } from "./mcpServerRestriction"

interface UseMcpToolParams {
```

**A9b — reject disallowed servers before execution.** In `execute()`, find the
block right after `validateToolExists` returns and before the resolved-tool-name
comment. Replace:

```ts
const toolValidation = await this.validateToolExists(task, serverName, toolName, pushToolResult)
if (!toolValidation.isValid) {
	return
}

// Use the resolved tool name (original name from the server) for MCP calls
```

With:

```ts
const toolValidation = await this.validateToolExists(task, serverName, toolName, pushToolResult)
if (!toolValidation.isValid) {
	return
}

// Execution-time defense: reject invocation of a server not permitted by the mode's
// allowedMcpServers allowlist, even if the model referenced it from history. This runs
// before approval/execution so a disallowed server can never be reached.
const serverAllowed = await ensureMcpServerAllowed(
	task,
	"use_mcp_tool",
	serverName,
	pushToolResult,
	formatResponse.toolError,
)
if (!serverAllowed) {
	return
}

// Use the resolved tool name (original name from the server) for MCP calls
```

> `formatResponse` is already imported at the top of this file
> (`import { formatResponse } from "../prompts/responses"`). Confirm before
> editing; do not add a duplicate import.

### Edit A10 — `src/core/tools/accessMcpResourceTool.ts` (invocation guard)

**A10a — import the guard.** Replace:

```ts
import { BaseTool, ToolCallbacks } from "./BaseTool"

interface AccessMcpResourceParams {
```

With:

```ts
import { BaseTool, ToolCallbacks } from "./BaseTool"
import { ensureMcpServerAllowed } from "./mcpServerRestriction"

interface AccessMcpResourceParams {
```

**A10b — reject disallowed servers.** Find the `uri` missing-param check and the
`task.consecutiveMistakeCount = 0` that follows it. Replace:

```ts
if (!uri) {
	task.consecutiveMistakeCount++
	task.recordToolError("access_mcp_resource")
	pushToolResult(await task.sayAndCreateMissingParamError("access_mcp_resource", "uri"))
	return
}

task.consecutiveMistakeCount = 0
```

With:

```ts
if (!uri) {
	task.consecutiveMistakeCount++
	task.recordToolError("access_mcp_resource")
	pushToolResult(await task.sayAndCreateMissingParamError("access_mcp_resource", "uri"))
	return
}

// Execution-time defense: reject access to a server not permitted by the mode's
// allowedMcpServers allowlist, even if the model referenced it from history.
const serverAllowed = await ensureMcpServerAllowed(
	task,
	"access_mcp_resource",
	server_name,
	pushToolResult,
	formatResponse.toolError,
)
if (!serverAllowed) {
	return
}

task.consecutiveMistakeCount = 0
```

> `formatResponse` and `server_name` are already in scope (top import +
> destructured `const { server_name, uri } = params`). Confirm; add nothing extra.

## A4. (Optional but recommended) port the remaining backend test files

The upstream PR also adds/extends these specs. They are pure unit tests in the
`src/` and `packages/types` vitest projects (no webview infra) and are worth
porting verbatim-with-path-adaptation. Pull each from
`git -C "$ZOO_CODE_PATH" show c7f1d1933:<path>` and adapt only import paths:

- `src/core/prompts/tools/__tests__/filter-tools-for-mode.spec.ts` (+138):
  param-omitted fallback to `modeConfig.allowedMcpServers`, explicit-param
  precedence, empty-list drops `access_mcp_resource`.
- `src/core/prompts/__tests__/system-prompt.spec.ts` (+64) and
  `src/core/prompts/__tests__/sections.spec.ts` (±37): MCP CAPABILITIES line is
  filtered by the allowlist. **Heads-up landmine:** the sections spec change
  exists because `getCapabilitiesSection` now calls `mcpHub.getServers()`; any
  pre-existing `{} as McpHub` mock in OUR `sections.spec.ts` will now throw
  `mcpHub.getServers is not a function`. If our copy of that test uses an empty
  hub mock, give it a `getServers: () => []` stub (do **not** delete the test).

These are coverage, not gating; if time-boxed, ship Phase A with Tests A/B/C
green and add these next.

## A5. Verify Phase A — paste real output, don't claim success without it

- From repo root: `pnpm --filter @roo-code/types test -- mode-allowedMcpServers` → green.
- From `src/`:
    - `npx vitest run core/tools/__tests__/mcpServerRestriction.spec.ts` → green.
    - `npx vitest run core/prompts/tools/native-tools/__tests__/mcp_server.spec.ts` → green.
    - `npx vitest run core/prompts core/tools core/task/__tests__` → no new failures
      in the touched areas.
    - `npx tsc --noEmit` → no errors referencing the files above.

## A6. Acceptance criteria — Phase A (binary, all must hold)

- [ ] Tests A, B, C pass; touched suites green.
- [ ] A mode with `allowedMcpServers: []` exposes **no** MCP tools and emits no
      MCP CAPABILITIES line; a call to any server is rejected with a clear message.
- [ ] A mode with `allowedMcpServers: undefined` behaves **exactly** as before
      (all servers available) — backward compatible.
- [ ] Only the files listed in §A3 (+ §A2/§A4 tests) changed (`git status`).
- [ ] No new "Roo"/"Zoo" user-facing strings; no internal id renamed.
- [ ] No removed feature (TTS / router / cloud) reintroduced.
- [ ] The upstream "Flicker A guard" `ModesView.tsx` refactor was **NOT** ported.

---

# PHASE B — webview editor UI (optional follow-up)

> Only do this if explicitly asked. Land it as a **separate commit** on top of a
> green Phase A. The feature already works without it (set `allowedMcpServers` in
> the mode JSON). This phase adds a GUI editor in the Modes view.

## B1. Preconditions

- [ ] Phase A is merged/green.
- [ ] `webview-ui/src/components/modes/ModesView.tsx` still matches the anchors
      quoted in §B3 (run the greps there first; if any differs, STOP).
- [ ] `mcpServers` is available from `useExtensionState()` (it is — see
      `webview-ui/src/context/ExtensionStateContext.tsx`).

## B2. New components (create verbatim)

### `webview-ui/src/components/modes/McpServerChecklist.tsx`

```tsx
import React from "react"
import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import type { McpServer } from "@roo-code/types"

export interface McpServerChecklistProps {
	/** The currently-allowed server names. */
	allowedMcpServers: string[]
	/** All currently-connected MCP servers. */
	mcpServers: McpServer[]
	/** Toggle handler for a given server name. */
	onServerToggle: (serverName: string) => (e: Event | React.FormEvent<HTMLElement>) => void
	/**
	 * Prefix for the rendered `data-testid` attributes. The list container is
	 * `${testIdPrefix}-list` and each checkbox is `${testIdPrefix}-checkbox-${name}`.
	 */
	testIdPrefix: string
}

/**
 * Shared presentational component that renders the per-server checkboxes and a
 * warning for any allowlisted server that is not currently connected.
 *
 * Used by both the edit panel (`McpServerRestriction`) and the create-mode
 * dialog (`ModesView`) so the two stay behaviorally identical.
 */
const McpServerChecklist: React.FC<McpServerChecklistProps> = ({
	allowedMcpServers,
	mcpServers,
	onServerToggle,
	testIdPrefix,
}) => {
	return (
		<div className="ml-6 mt-2 flex flex-col gap-1" data-testid={`${testIdPrefix}-list`}>
			{mcpServers && mcpServers.length > 0 ? (
				mcpServers.map((server) => (
					<VSCodeCheckbox
						key={server.name}
						checked={allowedMcpServers.includes(server.name)}
						data-testid={`${testIdPrefix}-checkbox-${server.name}`}
						onChange={onServerToggle(server.name)}>
						{server.name}
					</VSCodeCheckbox>
				))
			) : (
				<div className="text-xs text-vscode-descriptionForeground">No MCP servers connected</div>
			)}
			{/* Warning for servers in the allowlist that aren't currently connected */}
			{allowedMcpServers
				.filter((s) => !mcpServers?.some((ms) => ms.name === s))
				.map((missingServer) => (
					<div key={missingServer} className="text-xs text-vscode-errorForeground flex items-center gap-1">
						<span className="codicon codicon-warning" />
						{missingServer} (not connected)
					</div>
				))}
		</div>
	)
}

export default React.memo(McpServerChecklist)
```

### `webview-ui/src/components/modes/McpServerRestriction.tsx`

```tsx
import React, { useState, useEffect, useRef, useCallback } from "react"
import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import type { ModeConfig, McpServer } from "@roo-code/types"
import McpServerChecklist from "./McpServerChecklist"

export interface McpServerRestrictionProps {
	customMode: ModeConfig
	mcpServers: McpServer[]
	onCommit: (slug: string, updates: ModeConfig) => void
}

/**
 * Returns true when both inputs are undefined OR both are arrays containing
 * the same set of strings (order-insensitive). Used to decide whether the local
 * cached state and the host-side `customMode.allowedMcpServers` are already in
 * sync, so we can skip redundant `updateCustomMode` postMessages and
 * external-edit overwrites.
 */
function arraysEqualOrBothUndefined(a: string[] | undefined, b: string[] | undefined): boolean {
	if (a === b) return true
	if (a === undefined || b === undefined) return false
	if (a.length !== b.length) return false
	const aSorted = [...a].sort()
	const bSorted = [...b].sort()
	for (let i = 0; i < aSorted.length; i++) {
		if (aSorted[i] !== bSorted[i]) return false
	}
	return true
}

/**
 * Edit-panel UI for the per-mode MCP server restriction list.
 *
 * Implements the cached-state pattern (see AGENTS.md): inputs bind to a local
 * `cachedAllowedMcpServers` buffer rather than the live prop, flushed to the host
 * via `onCommit` after a 150 ms debounce. This isolates user edits from the host
 * round-trip so the toggle and per-server checkboxes don't snap back / flicker.
 *
 * Reconciliation rules:
 *  - When `customMode.slug` changes (mode switch), reseed from props.
 *  - When `customMode.allowedMcpServers` changes externally (not our own most
 *    recent flush — tracked via `lastFlushedRef`), overwrite the cache.
 */
const McpServerRestriction: React.FC<McpServerRestrictionProps> = ({ customMode, mcpServers, onCommit }) => {
	const [cachedAllowedMcpServers, setCachedAllowedMcpServers] = useState<string[] | undefined>(
		customMode.allowedMcpServers,
	)

	const lastFlushedRef = useRef<string[] | undefined>(customMode.allowedMcpServers)
	const isInitialMountRef = useRef(true)
	const lastSlugRef = useRef(customMode.slug)

	// Always hold the latest `customMode` and `onCommit` so the debounced flush
	// merges `allowedMcpServers` into the freshest mode snapshot instead of a
	// stale one captured when the timeout was scheduled.
	const latestCustomModeRef = useRef(customMode)
	const latestOnCommitRef = useRef(onCommit)
	useEffect(() => {
		latestCustomModeRef.current = customMode
		latestOnCommitRef.current = onCommit
	})

	// Reseed when the user switches to a different mode.
	useEffect(() => {
		if (lastSlugRef.current !== customMode.slug) {
			lastSlugRef.current = customMode.slug
			setCachedAllowedMcpServers(customMode.allowedMcpServers)
			lastFlushedRef.current = customMode.allowedMcpServers
			isInitialMountRef.current = true
		}
	}, [customMode.slug, customMode.allowedMcpServers])

	// External-edit reconciliation.
	useEffect(() => {
		if (lastSlugRef.current !== customMode.slug) return
		if (arraysEqualOrBothUndefined(customMode.allowedMcpServers, cachedAllowedMcpServers)) return
		if (arraysEqualOrBothUndefined(customMode.allowedMcpServers, lastFlushedRef.current)) return
		setCachedAllowedMcpServers(customMode.allowedMcpServers)
		lastFlushedRef.current = customMode.allowedMcpServers
		isInitialMountRef.current = true
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [customMode.allowedMcpServers, customMode.slug])

	// Debounced flush: 150 ms after the last local edit, postMessage to host.
	useEffect(() => {
		if (isInitialMountRef.current) {
			isInitialMountRef.current = false
			return
		}
		if (arraysEqualOrBothUndefined(cachedAllowedMcpServers, customMode.allowedMcpServers)) {
			return
		}
		const handle = setTimeout(() => {
			lastFlushedRef.current = cachedAllowedMcpServers
			const latestCustomMode = latestCustomModeRef.current
			latestOnCommitRef.current(latestCustomMode.slug, {
				...latestCustomMode,
				allowedMcpServers: cachedAllowedMcpServers,
				source: latestCustomMode.source || "global",
			})
		}, 150)
		return () => clearTimeout(handle)
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [cachedAllowedMcpServers])

	const isRestricted = cachedAllowedMcpServers !== undefined

	const handleToggle = useCallback((e: Event | React.FormEvent<HTMLElement>) => {
		const target = (e as CustomEvent)?.detail?.target || (e.target as HTMLInputElement)
		const checked = target.checked
		setCachedAllowedMcpServers(checked ? [] : undefined)
	}, [])

	const handleServerToggle = useCallback(
		(serverName: string) => (e: Event | React.FormEvent<HTMLElement>) => {
			const target = (e as CustomEvent)?.detail?.target || (e.target as HTMLInputElement)
			const checked = target.checked
			setCachedAllowedMcpServers((prev) => {
				const current = prev || []
				if (checked) {
					return current.includes(serverName) ? current : [...current, serverName]
				}
				return current.filter((s) => s !== serverName)
			})
		},
		[],
	)

	return (
		<div className="mt-3 ml-1" data-testid="mcp-server-restriction">
			<VSCodeCheckbox checked={isRestricted} data-testid="restrict-mcp-servers-toggle" onChange={handleToggle}>
				Restrict to specific MCP servers
			</VSCodeCheckbox>
			{isRestricted && (
				<McpServerChecklist
					allowedMcpServers={cachedAllowedMcpServers ?? []}
					mcpServers={mcpServers}
					onServerToggle={handleServerToggle}
					testIdPrefix="mcp-server"
				/>
			)}
		</div>
	)
}

export default React.memo(McpServerRestriction)
export { McpServerRestriction as McpServerRestrictionImpl, arraysEqualOrBothUndefined }
```

## B3. Integrate into `ModesView.tsx`

All five edits below are anchored to OUR current code (verified 2026-06-08). Do
**not** port the upstream "Flicker A guard" sync-effect refactor.

**B3a — imports.** After the `DeleteModeDialog` import (our line ~51), add:

```tsx
import { DeleteModeDialog } from "@src/components/modes/DeleteModeDialog"
import McpServerRestriction from "@src/components/modes/McpServerRestriction"
import McpServerChecklist from "@src/components/modes/McpServerChecklist"
import { useEscapeKey } from "@src/hooks/useEscapeKey"
```

**B3b — pull `mcpServers` from state.** Replace:

```tsx
		customInstructions,
		setCustomInstructions,
		customModes,
	} = useExtensionState()
```

With:

```tsx
		customInstructions,
		setCustomInstructions,
		customModes,
		mcpServers,
	} = useExtensionState()
```

**B3c — create-mode form state + reset + payload.** Three small edits:

1. After `const [newModeSource, setNewModeSource] = useState<ModeSource>("global")`, add:

```tsx
const [newModeAllowedMcpServers, setNewModeAllowedMcpServers] = useState<string[] | undefined>(undefined)
```

2. In `resetFormState`, after `setNewModeSource("global")`, add:

```tsx
setNewModeAllowedMcpServers(undefined)
```

3. In `handleCreateMode`, in the `newMode` object literal, after `groups: newModeGroups,` and `source,` add `allowedMcpServers`:

```tsx
			groups: newModeGroups,
			source,
			allowedMcpServers: newModeAllowedMcpServers,
		}
```

4. Add `newModeAllowedMcpServers` to the `handleCreateMode` `useCallback` dependency array (next to `newModeSource`). Keep the existing `// eslint-disable-next-line react-hooks/exhaustive-deps` line as-is (do not delete it — that is the YAGNI cut from §0).

**B3d — edit-panel: wrap the groups grid in a fragment and append the restriction editor.** Replace (our lines ~1128–1163):

```tsx
						{isToolsEditMode && findModeBySlug(visualMode, customModes) ? (
							<div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-2">
								{availableGroups.map((group) => {
									const currentMode = getCurrentMode()
									const isCustomMode = findModeBySlug(visualMode, customModes)
									const customMode = isCustomMode
									const isGroupEnabled = isCustomMode
										? customMode?.groups?.some((g) => getGroupName(g) === group)
										: currentMode?.groups?.some((g) => getGroupName(g) === group)

									return (
										<VSCodeCheckbox
											key={group}
											checked={isGroupEnabled}
											onChange={handleGroupChange(group, Boolean(isCustomMode), customMode)}
											disabled={!isCustomMode}>
											{t(`prompts:tools.toolNames.${group}`)}
											{group === "edit" && (
												<div className="text-xs text-vscode-descriptionForeground mt-0.5">
													{t("prompts:tools.allowedFiles")}{" "}
													{(() => {
														const currentMode = getCurrentMode()
														const editGroup = currentMode?.groups?.find(
															(g) =>
																Array.isArray(g) && g[0] === "edit" && g[1]?.fileRegex,
														)
														if (!Array.isArray(editGroup)) return t("prompts:allFiles")
														return editGroup[1].description || `/${editGroup[1].fileRegex}/`
													})()}
												</div>
											)}
										</VSCodeCheckbox>
									)
								})}
							</div>
						) : (
```

With:

```tsx
						{isToolsEditMode && findModeBySlug(visualMode, customModes) ? (
							<>
								<div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-2">
									{availableGroups.map((group) => {
										const currentMode = getCurrentMode()
										const isCustomMode = findModeBySlug(visualMode, customModes)
										const customMode = isCustomMode
										const isGroupEnabled = isCustomMode
											? customMode?.groups?.some((g) => getGroupName(g) === group)
											: currentMode?.groups?.some((g) => getGroupName(g) === group)

										return (
											<VSCodeCheckbox
												key={group}
												checked={isGroupEnabled}
												onChange={handleGroupChange(group, Boolean(isCustomMode), customMode)}
												disabled={!isCustomMode}>
												{t(`prompts:tools.toolNames.${group}`)}
												{group === "edit" && (
													<div className="text-xs text-vscode-descriptionForeground mt-0.5">
														{t("prompts:tools.allowedFiles")}{" "}
														{(() => {
															const currentMode = getCurrentMode()
															const editGroup = currentMode?.groups?.find(
																(g) =>
																	Array.isArray(g) &&
																	g[0] === "edit" &&
																	g[1]?.fileRegex,
															)
															if (!Array.isArray(editGroup)) return t("prompts:allFiles")
															return (
																editGroup[1].description ||
																`/${editGroup[1].fileRegex}/`
															)
														})()}
													</div>
												)}
											</VSCodeCheckbox>
										)
									})}
								</div>
								{/* MCP Server Restriction — shown when the mcp group is enabled. Uses a
								    local cached-state buffer + 150 ms debounced flush to avoid host
								    round-trip flicker. See McpServerRestriction.tsx. */}
								{(() => {
									const customMode = findModeBySlug(visualMode, customModes)
									const isMcpEnabled = customMode?.groups?.some((g) => getGroupName(g) === "mcp")
									if (!customMode || !isMcpEnabled) return null
									return (
										<McpServerRestriction
											customMode={customMode}
											mcpServers={mcpServers}
											onCommit={updateCustomMode}
										/>
									)
								})()}
							</>
						) : (
```

**B3e — create dialog: add the restriction editor after the groups error.** Find
(our lines ~1553–1557):

```tsx
								</div>
								{groupsError && (
									<div className="text-xs text-vscode-errorForeground mt-1">{groupsError}</div>
								)}
							</div>
```

Replace with:

```tsx
								</div>
								{groupsError && (
									<div className="text-xs text-vscode-errorForeground mt-1">{groupsError}</div>
								)}
								{/* MCP Server Restriction in create dialog */}
								{newModeGroups.some((g) => getGroupName(g) === "mcp") && (
									<div className="mt-3 ml-1" data-testid="create-mcp-server-restriction">
										<VSCodeCheckbox
											checked={newModeAllowedMcpServers !== undefined}
											data-testid="create-restrict-mcp-servers-toggle"
											onChange={(e: Event | React.FormEvent<HTMLElement>) => {
												const target =
													(e as CustomEvent)?.detail?.target || (e.target as HTMLInputElement)
												const checked = target.checked
												setNewModeAllowedMcpServers(checked ? [] : undefined)
											}}>
											Restrict to specific MCP servers
										</VSCodeCheckbox>
										{newModeAllowedMcpServers !== undefined && (
											<McpServerChecklist
												allowedMcpServers={newModeAllowedMcpServers}
												mcpServers={mcpServers}
												testIdPrefix="create-mcp-server"
												onServerToggle={(serverName) => (e) => {
													const target =
														(e as CustomEvent)?.detail?.target ||
														(e.target as HTMLInputElement)
													const checked = target.checked
													setNewModeAllowedMcpServers((prev) => {
														const current = prev ?? []
														return checked
															? current.includes(serverName)
																? current
																: [...current, serverName]
															: current.filter((s) => s !== serverName)
													})
												}}
											/>
										)}
									</div>
								)}
							</div>
```

## B4. Test infrastructure (only if porting the component spec)

The upstream component spec (`McpServerRestriction.spec.tsx`, 458 lines) needs a
toolkit mock + a React vitest plugin. Our webview currently has **neither**
(`webview-ui/src/__mocks__/@vscode/webview-ui-toolkit/react.tsx` is absent and
`vitest.config.ts` has no `@vitejs/plugin-react`). This is the brittle part — if
you are not porting that spec, **skip this section**; the components work in the
real extension regardless.

If you do port it:

1. Create `webview-ui/src/__mocks__/@vscode/webview-ui-toolkit/react.tsx` from
   `git -C "$ZOO_CODE_PATH" show c7f1d1933:webview-ui/src/__mocks__/@vscode/webview-ui-toolkit/react.tsx`
   (88 lines; forwards `data-testid` onto the inner `<input type="checkbox">`).
2. `webview-ui/vitest.setup.ts` — add at the top (after the jest-dom imports) the
   `vi.mock("@vscode/webview-ui-toolkit/react", …)` block that re-exports the
   `@/__mocks__/...` file (our `@` alias already resolves to `./src`).
3. `webview-ui/vitest.config.ts` — add `import react from "@vitejs/plugin-react"`
   and `plugins: [react()]`. **First confirm `@vitejs/plugin-react` is a
   devDependency of `webview-ui`** (`grep plugin-react webview-ui/package.json`);
   if it is not, STOP and report — adding the dep is a separate decision, and the
   non-component backend tests do not need it.
4. Then port `webview-ui/src/components/modes/__tests__/McpServerRestriction.spec.tsx`
   verbatim. Note the upstream caveat already baked into that file: Test 3's
   `<Profiler>` assertion is `<= 1`, not `=== 0`.

## B5. Verify Phase B

- From `webview-ui/`: `npx vitest run src/components/modes` → green (or, if the
  component spec was skipped, at least the existing ModesView tests still pass).
- From repo root: `pnpm lint` (or `cd webview-ui && npx eslint src/components/modes`)
  → clean; `npx tsc --noEmit` in `webview-ui` → clean.
- Manual smoke (if running the extension): open Modes → a custom mode with the
  **MCP** tool group → a "Restrict to specific MCP servers" checkbox appears;
  toggling it on shows the connected servers; selections persist after a mode
  switch and round-trip.

## B6. Acceptance criteria — Phase B

- [ ] The edit panel and the create dialog both show the restriction editor only
      when the mode has the `mcp` group.
- [ ] Toggling servers persists to the mode's `allowedMcpServers` (and, with Phase
      A, actually filters tools/prompt for that mode).
- [ ] No new "Roo"/"Zoo" user-facing strings; the upstream Flicker-A refactor was
      not ported.
- [ ] `webview-ui` types + lint clean.

---

## Out of scope — do NOT do these (both phases)

- Do **not** port the upstream `ModesView.tsx` "Flicker A guard" (`visualModeRef`)
  sync-effect refactor — it is unrelated to the allowlist.
- Do **not** re-add or re-wire: **TTS**, the **router / cloud provider**, **cloud
  upsell** UI, or **Roo/Zoo branding**.
- Do **not** rename internal ids (`Roo-Code`, `schemas/roomodes.json`); only
  user-visible strings are "Tumble".
- Do **not** add `@vitejs/plugin-react` blindly — gate it behind the dep check in
  §B4.3.

## Record in the ledger

```bash
node .claude/skills/zoo-port/scripts/zoo-prs.mjs record \
  --pr 453 --status ported \
  --branch feature/zoo-453-per-mode-mcp-allowlist \
  --plan ai_plans/2026-06-08_zoo-453-per-mode-mcp-allowlist.md
```

When you commit (only if asked), append both `Co-authored-by:` trailers from §0.
