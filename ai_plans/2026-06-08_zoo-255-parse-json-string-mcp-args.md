# Port plan — Zoo PR #255 → `feature/zoo-255-parse-json-string-mcp-args`

> **For the executor (read first).** Do the steps **in order**. Do **not**
> improvise, refactor beyond what is written, or add anything not listed
> (YAGNI). Every code block below is **already adapted to this repo** — paste it
> as-is unless a step says otherwise. If any precondition is false or a step
> doesn't behave as described, **STOP and report** — do not guess. This repo is
> **Tumble Code**: never introduce the strings "Roo" or "Zoo" in user-facing
> text.

> **Status: ALREADY IMPLEMENTED in this branch (2026-06-08).** This plan
> documents the change; the test is written, red was observed, the fix applied,
> and the suite is green (18/18). An executor re-running it from a clean `main`
> reproduces the same result.

---

## 0. Context (read once, write no code)

- **Upstream:** Zoo PR #255 — "fix: parse JSON-string MCP tool arguments before type check" (commit `98c629fbc`).
- **What it does, one paragraph:** Some LLMs (DeepSeek V4 Pro, Qwen, GLM, local
  Llamas, …) emit MCP tool-call arguments as a JSON-encoded **string**
  (e.g. `'{"headless": true}'`) instead of a structured object. The
  `validateParams()` guard in `UseMcpToolTool` only accepts a plain object, so it
  rejects these valid calls with an `invalidJsonArgument` error and burns a
  mistake count. The fix adds a single `JSON.parse()` unwrap before the existing
  type check; if parsing fails it falls through and the existing object check
  rejects the input exactly as before.
- **Why we want it, with evidence in OUR code:** Pre-fix,
  [`src/core/tools/UseMcpToolTool.ts`](../src/core/tools/UseMcpToolTool.ts) line
  ~114 carried the comment `// Native-only: arguments are already a structured
object.` followed directly by `if (typeof params.arguments !== "object" …)`.
  Native tool calling passes `block.nativeArgs` straight through as `params`
  ([`BaseTool.ts:133`](../src/core/tools/BaseTool.ts#L133)), so a weak model that
  serialises its arguments lands here as a string and is rejected. This is the
  single most common MCP failure for the weak/local models this fork targets — a
  direct fit for our weak-model-hardening direction.
- **What we deliberately leave out (YAGNI):** nothing extra — the upstream change
  is already minimal (one guard + one test). No new dependency, no config.
- **Original author(s) — credit them.** pajitosingh. When you create the port
  commit (only if asked), include:

    ```text
    Co-authored-by: pajitosingh <pajitosingh@gmail.com>
    ```

## 1. Preconditions — verify before touching anything

- [x] Current branch is `feature/zoo-255-parse-json-string-mcp-args`, created off `main`.
- [x] These files exist:
    - `src/core/tools/UseMcpToolTool.ts`
    - `src/core/tools/__tests__/useMcpToolTool.spec.ts`
- [x] Before the fix, the edit site looked exactly like this (if it differs, STOP — plan is stale):

```ts
		// Native-only: arguments are already a structured object.
		let parsedArguments: Record<string, unknown> | undefined
		if (params.arguments !== undefined) {
			if (typeof params.arguments !== "object" || params.arguments === null || Array.isArray(params.arguments)) {
```

## 2. Write the failing test FIRST (TDD)

- **File:** `src/core/tools/__tests__/useMcpToolTool.spec.ts` — insert inside the
  `describe("successful execution", …)` block, immediately after the
  `"should execute tool successfully with valid parameters"` test.
- Add exactly this test:

```ts
it("should parse JSON-string arguments and pass the parsed object to callTool", async () => {
	// Some weak models (DeepSeek V4, Qwen, GLM, ...) emit MCP tool arguments
	// as a JSON-encoded string instead of a structured object.
	const callToolMock = vi.fn().mockResolvedValue({
		content: [{ type: "text", text: "Browser session started" }],
		isError: false,
	})

	mockProviderRef.deref.mockReturnValue({
		getMcpHub: () => ({
			callTool: callToolMock,
			getAllServers: vi
				.fn()
				.mockReturnValue([{ name: "test_server", tools: [{ name: "test_tool", description: "Test Tool" }] }]),
		}),
		postMessageToWebview: vi.fn(),
	})

	const block: ToolUse = {
		type: "tool_use",
		name: "use_mcp_tool",
		params: {
			server_name: "test_server",
			tool_name: "test_tool",
			arguments: '{"headless": true}',
		},
		nativeArgs: {
			server_name: "test_server",
			tool_name: "test_tool",
			arguments: '{"headless": true}' as unknown as Record<string, unknown>,
		},
		partial: false,
	}

	mockAskApproval.mockResolvedValue(true)

	await useMcpToolTool.handle(mockTask as Task, block as any, {
		askApproval: mockAskApproval,
		handleError: mockHandleError,
		pushToolResult: mockPushToolResult,
	})

	expect(mockTask.consecutiveMistakeCount).toBe(0)
	expect(mockTask.recordToolError).not.toHaveBeenCalled()
	expect(callToolMock).toHaveBeenCalledWith("test_server", "test_tool", { headless: true })
	expect(mockTask.say).toHaveBeenCalledWith("mcp_server_request_started")
	expect(mockTask.say).toHaveBeenCalledWith("mcp_server_response", "Browser session started", [])
})
```

- **Run (from the `src/` directory):** `npx vitest run core/tools/__tests__/useMcpToolTool.spec.ts`
- **Expect it to FAIL** with: `expected 1 to be +0` at the
  `expect(mockTask.consecutiveMistakeCount).toBe(0)` line — pre-fix, the
  string argument is rejected, the mistake count increments, and `callTool` is
  never reached. (Observed exactly this on 2026-06-08.)
- If it **passes already**, STOP — the fix is present; report back.

## 3. Implement — minimal change to make the test pass

### Edit 1 — `src/core/tools/UseMcpToolTool.ts` (inside `validateParams`)

Replace:

```ts
// Native-only: arguments are already a structured object.
let parsedArguments: Record<string, unknown> | undefined
```

With:

```ts
// Some weak models (DeepSeek V4, Qwen, GLM, ...) emit MCP tool arguments as a
// JSON-encoded string (e.g. '{"headless": true}') rather than a structured
// object. Unwrap it before the type check below; if it is not valid JSON,
// leave it as-is and let the existing validation reject the malformed input.
if (typeof (params.arguments as unknown) === "string") {
	try {
		params.arguments = JSON.parse(params.arguments as unknown as string)
	} catch {
		// Not valid JSON — fall through to the object check, which rejects it.
	}
}

let parsedArguments: Record<string, unknown> | undefined
```

Notes on the adaptation (why this differs from the raw upstream patch):

- Our `UseMcpToolParams.arguments` is typed `Record<string, unknown> | undefined`,
  so a bare `typeof params.arguments === "string"` is a TS "no-overlap" error.
  The `as unknown` cast keeps the runtime behaviour identical while staying
  type-safe under `tsc --noEmit`.
- The empty `catch {}` is intentional (YAGNI): malformed JSON is already handled
  by the unchanged object/null/array check that follows.

## 4. Out of scope — do NOT do these

- Do **not** widen the `UseMcpToolParams.arguments` type or change any other
  call site — the localized cast is sufficient.
- Do **not** re-add or re-wire: **TTS**, the **router / cloud provider**, **cloud
  upsell** UI, or **Roo/Zoo branding**.
- Do **not** rename internal ids (those stay `Roo-Code`).

## 5. Verify — paste real output, don't claim success without it

From the `src/` directory:

- `npx vitest run core/tools/__tests__/useMcpToolTool.spec.ts` → **18 passed** (was 17 + the new one).
- `npx tsc --noEmit` → no error referencing `UseMcpToolTool`.

Observed 2026-06-08: `Test Files 1 passed (1) · Tests 18 passed (18)`.

## 6. Acceptance criteria (binary — all must hold)

- [x] The §2 test passes; the surrounding suite is green (18/18).
- [x] Only `UseMcpToolTool.ts` and its spec changed (`git status` confirms).
- [x] No new "Roo"/"Zoo" user-facing strings introduced.
- [x] No removed feature (TTS / router / cloud) reintroduced.

## 7. Record in the ledger

```bash
node .claude/skills/zoo-port/scripts/zoo-prs.mjs record \
  --pr 255 --status ported \
  --branch feature/zoo-255-parse-json-string-mcp-args \
  --plan ai_plans/2026-06-08_zoo-255-parse-json-string-mcp-args.md
```

When you commit (only if asked), append the `Co-authored-by:` trailer from §0.
