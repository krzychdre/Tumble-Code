# fix: MCP schema characterization snapshot leaks the Windows temp path

- date: 2026-09-26
- branch: `fix/mcp-schema-snapshot-windows-path`
- trigger: `platform-unit-test (windows-latest)` red on main (run 36263995037), failing
  `packages/agent-interchange/src/__tests__/mcp-tool-schemas.characterization.spec.ts` —
  both snapshot tests of the agent-interchange MCP tool schemas.

## Root cause (proven from the CI log)

`createInterchangeServer(workspaceDir)` interpolates the real startup workspace
path into every tool's `workspace` description
(`packages/agent-interchange/src/mcp/server.ts:76-77`). The characterization test
must strip that path out of the serialized schemas before snapshotting, and it
did so with raw substring replaces:

```ts
text.split(fs.realpathSync.native(workspaceDir)).join("<workspace>")
text.split(workspaceDir).join("<workspace>")
```

On Windows the path inside the JSON-serialized text is **JSON-escaped** — every
backslash is doubled (`C:\\Users\\RUNNER~1\\...`). A raw substring of the
unescaped path (`C:\Users\...`) therefore never matches, so the snapshot
received the literal temp path
(`agent-interchange-mcp-schema-workspace-eDSJFk`) and mismatched. On Linux
forward slashes need no escaping, which is why the test is always green
locally — a platform-blind assertion.

CI evidence: job log shows `- ...<workspace>.` vs
`+ ...C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\agent-interchange-mcp-schema-workspace-eDSJFk.`
in both `allowCrossWorkspace: false` and `: true` snapshots.

## Fix

Also strip the JSON-escaped form of the path (and of its realpaths) from the
serialized text before snapshotting:

```ts
const jsonEscaped = JSON.stringify(workspaceDir).slice(1, -1)
```

applied to both the raw dir and `fs.realpathSync.native(workspaceDir)`. The
order matters only for safety (longest/most-escaped form first); the raw
replaces stay as a fallback for platforms where the JSON-escaped form equals
the raw one.

## Verification

- `cd packages/agent-interchange && npx vitest run
src/__tests__/mcp-tool-schemas.characterization.spec.ts` — 2 passed, snapshot
  file unchanged (Linux snapshots contain `<workspace>` already).
- Windows proof is by construction: the JSON-escaped form is exactly what
  `JSON.stringify` produces for a Windows path (double backslashes), which is
  the substring seen in the CI diff.

## Residual risks

- `RUNNER~1` short-name: irrelevant to the fix — the whole path is stripped,
  whatever form it takes, because the replace input comes from the same
  `workspaceDir` string the server was constructed with.
- If a future tool description JSON-escapes the path differently (e.g. via
  forward slashes), the raw replace already covers that form.
