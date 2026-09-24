# Zoo #1484 port: match the x.ai host exactly in the OpenAI-compatible handler

**Status:** ported, one commit.
**Upstream:** Zoo-Code PR #1484, commit `77e422faf`, merged 2026-09-17, authors BambinoSK and Elliott de Launay.
**Touched:** `src/api/providers/openai.ts`, `src/api/providers/__tests__/openai.spec.ts`.

## Symptom

With the OpenAI Compatible provider, any base URL whose host merely contains `x.ai` (for example
`https://box.ai/v1` or `https://inbox.ai/v1`) was treated as xAI Grok. The request then went out
without `stream_options: { include_usage: true }`, the server sent no usage, and the context and
cost figures stayed at zero. Separately, an Azure AI Inference base URL with an explicit port (for
example `https://x.services.ai.azure.com:8443`) was not recognized, so the Azure AI Inference path
was not used.

## Root cause in our code

- `src/api/providers/openai.ts:664` (before the fix): `_isGrokXAI` returned
  `urlHost.includes("x.ai")`, a substring test. It gates `stream_options` at `:234` (main path)
  and `:473` (O3 path).
- `src/api/providers/openai.ts:656`: `_getUrlHost` returned `URL.host`, which includes a non-default
  port, so every `endsWith(...)` host check (`_isAzureAiInference`, the Azure OpenAI check at `:96`,
  also used by `deepseek.ts:131`) failed when the base URL had a port.

## Fix

- `_getUrlHost` returns `URL.hostname` (no port).
- `_isGrokXAI` matches `x.ai` or a subdomain of it (`hostname === "x.ai" || hostname.endsWith(".x.ai")`),
  the same shape as the existing Azure check.

## Tests

New cases in `openai.spec.ts`:

- `box.ai`, `inbox.ai`, `x.ai.example.com` are not Grok: failed before (returned true), pass now;
  a query string containing `x.ai` on localhost is not Grok (already passed, kept as a guard);
- `api.x.ai`, `custom.x.ai`, `api.x.ai:8443` are Grok (passed before and after);
- streaming to `box.ai` keeps `stream_options.include_usage`, on the main path and on the O3 path:
  both failed before (`stream_options` was undefined), pass now;
- `_isAzureAiInference` accepts `...services.ai.azure.com:8443`: failed before, passes now.

Whole `src/api` suite: 79 files, 1608 passed, 2 skipped. `tsc --noEmit`, eslint and prettier are clean.

## Not ported

Nothing functional. Zoo's tests were rewritten more compactly (`it.each`).
