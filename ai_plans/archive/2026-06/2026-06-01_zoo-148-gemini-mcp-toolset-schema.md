# Zoo PR #148 — Gemini requests fail when user enables the full MCP tool set

- **Upstream:** Zoo-Code #148, commit `7d1394e67`, merged 2026-05-21 21:52:45Z, authors Roomote + Elliott de Launay.
- **Branch:** `feature/zoo-148-gemini-mcp-toolset-schema` (off `main`).
- **Credit:**
    - `Co-authored-by: Roomote <roomote@roocode.com>`
    - `Co-authored-by: Elliott de Launay <edelauna@gmail.com>`

## Problem

When a user enables a large MCP tool set, Gemini requests fail with an opaque
`INVALID_ARGUMENT` (HTTP 400). Two independent root causes:

1. **`allowedFunctionNames` overflow.** Live testing showed Gemini returns a generic
   400 once `allowedFunctionNames` carries ≥26 entries, and it also rejects prior
   function calls whose names are absent from the current allowed list. Our handler
   was passing `metadata.allowedFunctionNames` straight through to `toolConfig`.
2. **Broad JSON Schema in MCP tool params.** Third-party MCP servers emit full JSON
   Schema (`$schema`, `$defs`/`$ref`, `additionalProperties`, `default`,
   `anyOf`/`oneOf`/`allOf`, `type` arrays). Gemini only accepts a narrow OpenAPI-style
   subset (single-value `type` + `nullable`), so the raw schema is rejected.

## Fix (product — `src/api/providers/gemini.ts`)

1. Add `sanitizeSchemaForGemini(schema, defs?, activeRefs?)` + a
   `GEMINI_SCHEMA_COMPATIBILITY_DROP_KEYS` set. It:
    - drops `$schema`, `$id`, `$defs`, `additionalProperties`, `default`, `definitions`;
    - resolves local `#/$defs/...` / `#/definitions/...` `$ref` against the root defs
      **before** dropping defs (else dangling refs remain);
    - guards recursive refs via an `activeRefs` set — returns `{}` at the recursive edge
      so the output stays finite and serializable;
    - collapses `anyOf`/`oneOf` to the first non-`null` variant, marking `nullable`;
    - deep-merges `allOf` fragments (properties + required) instead of last-write-wins;
    - collapses `type: [..., "null"]` arrays to the first non-null type + `nullable`;
    - iterates the `properties` map directly so property names colliding with schema
      keywords (`default`, `additionalProperties`, `$schema`) are preserved.
2. Run every tool's `function.parameters` through `sanitizeSchemaForGemini` when
   building `functionDeclarations`; capture the declared names into
   `availableFunctionNameSet`.
3. Stop passing `metadata.allowedFunctionNames` to Gemini entirely. All declarations
   are still sent (history compatibility); mode restriction is enforced by the tool
   execution layer (`validateToolUse`), not the provider. For a `tool_choice` of a
   specific function, only force `ANY`+allowed-name when that name is actually in the
   declared set, else fall back to `AUTO`.

## Tests

- `src/api/providers/__tests__/gemini-handler.spec.ts`: rewrite the 5
  `allowedFunctionNames` expectations (now `toolConfig` undefined / `AUTO`), add 2 new
  large-list tests, and append a `describe("Gemini schema compatibility")` block (7
  tests: metadata strip, composition/type-array collapse, multi-fragment allOf merge,
  $ref resolution, top-level+allOf preservation, recursive-ref guard, keyword-named
  params).
- `src/core/tools/__tests__/validateToolUse.spec.ts`: +1 test — execution-time
  validation still blocks a mode-disallowed tool even if the provider declared it.

## Scope / skip (aimock e2e — deliberately absent from fork)

Skip the aimock parts of the upstream PR: `apps/vscode-e2e/AGENTS.md`,
`apps/vscode-e2e/fixtures/gemini.json`, `apps/vscode-e2e/src/runTest.ts` aimock wiring,
`apps/vscode-e2e/src/suite/providers/gemini.test.ts`. These depend on the
`@copilotkit/aimock`/`LLMock` replay harness that this fork does not ship. The product
fix and unit specs are fully independent of them.

## Compatibility note

Our fork's `gemini.ts` matches the upstream pre-image byte-for-byte at both edit regions
(the `functionDeclarations` map and the `allowedFunctionNames`/`tool_choice` block), so
the product diff applies cleanly. Our `gemini-handler.spec.ts` lacks an upstream
telemetry mock at the top of file; the modified tests are ported by hand against our
actual file rather than via `git apply`.

## Verification

- `npx vitest run api/providers/__tests__/gemini-handler.spec.ts` (from `src/`).
- `npx vitest run core/tools/__tests__/validateToolUse.spec.ts` (from `src/`).
- Build gate: `pnpm install:vsix -y --editor=code` must be green before push.
