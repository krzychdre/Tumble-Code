# Zoo PR #294 — Vertex: warn when 'Google Cloud Credentials' field receives a file path

- **Upstream:** Zoo-Code #294, commit `adf0d7246`, merged 2026-05-26 20:41:10Z, author 0xMink.
- **Branch:** `feature/zoo-294-vertex-credentials-path-warning` (off `main`).
- **Credit:** `Co-authored-by: 0xMink <260166390+0xMink@users.noreply.github.com>`.

## Problem

Pasting a filesystem path into the "Google Cloud Credentials" field (which expects
the raw JSON contents of a service-account key file) produced recurring
`Error parsing JSON: Unexpected token 'C', "C:\Users\.."` spam on every Task
creation. The sibling "Google Cloud Key File Path" field is where a path belongs,
and Google's own ecosystem uses `GOOGLE_APPLICATION_CREDENTIALS` for paths — so the
confusion is natural and the field naming doesn't disambiguate.

Secondary precedence bug: the auth-branch truthiness check was on the raw
`vertexJsonCredentials` field, so path-shaped input still entered the JSON branch
with `credentials: undefined` instead of falling through to `vertexKeyFile`.

## Fix

1. **`packages/types/src/utils/looksLikeFilePath.ts`** (new) — pure, dep-free
   predicate: true for Windows drive-letter (`C:\` / `C:/`), POSIX absolute (`/`),
   home (`~`), relative (`.`); false for nullish/empty/whitespace. Exported from
   `packages/types/src/index.ts` so the runtime and the webview share one definition.
2. **`packages/core/src/message-utils/safeJsonParse.ts`** — add optional `context`
   arg appended to the error log (`Error parsing JSON (Vertex credentials):`).
   Backward-compatible.
3. **`src/api/providers/utils/vertex-credentials.ts`** (new) — `parseVertexJsonCredentials`:
   trims input; returns undefined for empty; if `looksLikeFilePath`, logs a _static_
   warning (no PII — user value not interpolated) naming the correct field + env var
   and returns undefined; otherwise `safeJsonParse<JWTInput>(trimmed, undefined, "Vertex credentials")`.
4. **`src/api/providers/gemini.ts`** & **`anthropic-vertex.ts`** — bind
   `parseVertexJsonCredentials(...)` first and branch on the parsed result, so
   path-shaped input falls through to the keyFile / bare branch. Drop the now-unused
   `safeJsonParse` / `JWTInput` imports from both.
5. **`webview-ui/.../Vertex.tsx`** — `useMemo(looksLikeFilePath(vertexJsonCredentials))`;
   render an inline `role="status"` warning (`data-testid="vertex-credentials-path-warning"`)
   under the credentials field via `<Trans>` with `<strong>`/`<code>` components.
6. **i18n** — new `settings:providers.googleCloudCredentialsPathWarning` string in all
   18 locales (en + 17 translations copied verbatim from upstream).

## Tests

- `packages/types/src/__tests__/looksLikeFilePath.spec.ts` (new) — nullish/empty,
  path-shaped, JSON/bare-token cases.
- `packages/core/src/message-utils/__tests__/safeJsonParse.spec.ts` (new) — valid,
  default, generic-vs-context log message.
- `src/api/providers/__tests__/vertex-credentials.spec.ts` (new) — `parseVertexJsonCredentials`
  unit cases + Gemini/Vertex/AnthropicVertex wiring (parsed creds passthrough,
  path-shape fallthrough, mixed-input keyFile fallback, no-PII).
- `webview-ui/.../__tests__/Vertex.spec.tsx` — `<Trans>` mock resolving against real
  English bundle; warning render/no-render cases.

## Scope / skip

No changeset (fork port workflow omits them). All internal package ids stay `@roo-code/*`
(rebrand keeps internal IDs). i18n strings reference Google Cloud / env var only — no
brand strings to retumble.

## Verification

- `npx vitest run api/providers/__tests__/vertex-credentials.spec.ts` (from `src/`).
- Type/core/webview specs via their workspaces.
- Build gate: `pnpm install:vsix -y --editor=code` must be green before push.
