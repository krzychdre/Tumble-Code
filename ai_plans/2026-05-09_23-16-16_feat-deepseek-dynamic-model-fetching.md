# Feature: DeepSeek dynamic model fetching

**Source:** Zoo-Code commits
[c358bd77e](https://github.com/Zoo-Code-Org/Zoo-Code/commit/c358bd77e) (core),
[a2d19daac](https://github.com/Zoo-Code-Org/Zoo-Code/commit/a2d19daac) (test fix),
[91c979877](https://github.com/Zoo-Code-Org/Zoo-Code/commit/91c979877) (UI cleanup),
[221dfc90d](https://github.com/Zoo-Code-Org/Zoo-Code/commit/221dfc90d) (validation hardening), all by Derek Robertson
**Type:** Feature — wires DeepSeek into the dynamic router-model cache.
**Risk:** Moderate — touches 7 files, adds one new file. Behavior degrades gracefully
to the existing static model list if the network call fails.

## What this delivers

Today, the DeepSeek provider only knows the two models hard-coded in
`packages/types/src/providers/deepseek.ts` (`deepseek-chat`, `deepseek-reasoner`).
After this change, on extension startup (and whenever the user clicks Refresh in
Settings) we hit `https://api.deepseek.com/models` and merge the live list with the
static specs. Known models keep their pricing/context-window data; unknown models get
sensible 128K/8K-output defaults and become selectable in the generic model picker.

## Files touched

| File                                                                                                             | Change                                           |
| ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| [packages/types/src/provider-settings.ts](packages/types/src/provider-settings.ts)                               | Add `"deepseek"` to `dynamicProviders`           |
| [src/api/providers/fetchers/deepseek.ts](src/api/providers/fetchers/deepseek.ts)                                 | **New file** — fetcher implementation            |
| [src/api/providers/fetchers/modelCache.ts](src/api/providers/fetchers/modelCache.ts)                             | Import + `case "deepseek"`                       |
| [src/core/webview/webviewMessageHandler.ts](src/core/webview/webviewMessageHandler.ts)                           | `routerModels` map + conditional candidate       |
| [src/shared/api.ts](src/shared/api.ts)                                                                           | Add `deepseek` entry to `dynamicProviderExtras`  |
| [webview-ui/src/components/ui/hooks/useSelectedModel.ts](webview-ui/src/components/ui/hooks/useSelectedModel.ts) | Use `routerModels.deepseek` with static fallback |
| [webview-ui/src/utils/**tests**/validate.spec.ts](webview-ui/src/utils/__tests__/validate.spec.ts)               | Add `deepseek: {}` to `mockRouterModels`         |

The existing [webview-ui/src/components/settings/providers/DeepSeek.tsx](webview-ui/src/components/settings/providers/DeepSeek.tsx) is **not** modified. The
generic model picker is rendered automatically by `ApiOptions.tsx` because `deepseek`
is _not_ in `PROVIDERS_WITH_CUSTOM_MODEL_UI` — and we keep it that way.

---

## Step 1 — Add `deepseek` to the dynamic-provider tuple

[packages/types/src/provider-settings.ts](packages/types/src/provider-settings.ts), around line 37–45.

**Before:**

```ts
export const dynamicProviders = [
	"openrouter",
	"vercel-ai-gateway",
	"litellm",
	"poe",
	"requesty",
	"roo",
	"unbound",
] as const
```

**After:**

```ts
export const dynamicProviders = [
	"openrouter",
	"vercel-ai-gateway",
	"litellm",
	"poe",
	"requesty",
	"roo",
	"unbound",
	"deepseek",
] as const
```

This single change drives a chain of compile errors that the rest of the steps
resolve — it's a useful checkpoint because it makes TypeScript point you at every
remaining file.

---

## Step 2 — Create the DeepSeek fetcher

**New file:** [src/api/providers/fetchers/deepseek.ts](src/api/providers/fetchers/deepseek.ts) — full contents:

```ts
import type { ModelRecord } from "@roo-code/types"
import { deepSeekModels, DEEP_SEEK_DEFAULT_TEMPERATURE } from "@roo-code/types"

import { DEFAULT_HEADERS } from "../constants"

/**
 * Fetches available models from the DeepSeek API and merges them with known specs.
 *
 * The DeepSeek /models endpoint only returns basic model IDs without pricing
 * or context window info, so we merge the API response with the static
 * `deepSeekModels` map for known models. Unknown models get sensible defaults.
 */
export async function getDeepSeekModels(baseUrl?: string, apiKey?: string): Promise<ModelRecord> {
	const normalizedBase = (baseUrl || "https://api.deepseek.com").replace(/\/?v1\/?$/, "")
	const url = `${normalizedBase}/models`

	const headers: Record<string, string> = {
		"Content-Type": "application/json",
		...DEFAULT_HEADERS,
	}

	if (apiKey) {
		headers["Authorization"] = `Bearer ${apiKey}`
	}

	const controller = new AbortController()
	const timeoutId = setTimeout(() => controller.abort(), 10000)

	try {
		const response = await fetch(url, {
			headers,
			signal: controller.signal,
		})

		if (!response.ok) {
			let errorBody = ""
			try {
				errorBody = await response.text()
			} catch {
				errorBody = "(unable to read response body)"
			}

			console.error(`[getDeepSeekModels] HTTP error:`, {
				status: response.status,
				statusText: response.statusText,
				url,
				body: errorBody,
			})

			throw new Error(`HTTP ${response.status}: ${response.statusText}`)
		}

		const data = await response.json()

		if (!data?.data || !Array.isArray(data.data)) {
			console.error("[getDeepSeekModels] Unexpected response format:", data)
			throw new Error("Failed to fetch DeepSeek models: Unexpected response format.")
		}

		// Use null-prototype object to prevent prototype pollution
		const models: ModelRecord = Object.create(null)

		for (const model of data.data) {
			const modelId = typeof model.id === "string" && model.id ? model.id : null
			if (!modelId) continue

			const knownSpecs = deepSeekModels[modelId as keyof typeof deepSeekModels]

			if (knownSpecs) {
				models[modelId] = { ...knownSpecs }
			} else {
				models[modelId] = {
					maxTokens: 8192,
					contextWindow: 128_000,
					supportsImages: false,
					supportsPromptCache: true,
					inputPrice: 0.28,
					outputPrice: 0.42,
					cacheWritesPrice: 0.28,
					cacheReadsPrice: 0.028,
					defaultTemperature: DEEP_SEEK_DEFAULT_TEMPERATURE,
					description: `DeepSeek model: ${modelId}`,
				}
			}
		}

		return models
	} finally {
		clearTimeout(timeoutId)
	}
}
```

Verification of upstream symbols (already present in the fork):

- `DEEP_SEEK_DEFAULT_TEMPERATURE` is exported from `packages/types/src/providers/deepseek.ts:38`.
- `deepSeekModels` and `deepSeekDefaultModelId` are exported from the same file.
- `DEFAULT_HEADERS` is exported from `src/api/providers/constants.ts:3`.
- `ModelRecord` and `ModelInfo` come from `packages/types/src/model.ts` — already re-exported from `@roo-code/types`.

---

## Step 3 — Register the fetcher in `modelCache`

[src/api/providers/fetchers/modelCache.ts](src/api/providers/fetchers/modelCache.ts).

**a)** Add the import alongside the other fetchers (around line 28):

```diff
 import { getOllamaModels } from "./ollama"
 import { getLMStudioModels } from "./lmstudio"
 import { getRooModels } from "./roo"
+import { getDeepSeekModels } from "./deepseek"
```

**b)** Add the case to `fetchModelsFromProvider`'s `switch (provider)` block, _before_
the `default:` arm (after the `case "poe":` branch around line 89–91):

```diff
 		case "poe":
 			models = await getPoeModels(options.apiKey, options.baseUrl)
 			break
+		case "deepseek":
+			models = await getDeepSeekModels(options.baseUrl, options.apiKey)
+			break
 		case "roo": {
```

Note: in your fork the `roo` case follows `poe` directly. The `deepseek` case can sit
between them — order within the switch doesn't matter, but keep it grouped with the
other dynamic-provider arms to ease future review.

---

## Step 4 — Wire the webview-side aggregator

[src/core/webview/webviewMessageHandler.ts](src/core/webview/webviewMessageHandler.ts).

**a)** Add `deepseek: {}` to the `routerModels` initialization map inside
`case "requestRouterModels":` (your fork's lines ~947–959 — the object passed to the
_non_-`providerFilter` branch):

```diff
 				const routerModels: Record<RouterName, ModelRecord> = providerFilter
 					? ({} as Record<RouterName, ModelRecord>)
 					: {
 							openrouter: {},
 							"vercel-ai-gateway": {},
 							litellm: {},
 							poe: {},
 							requesty: {},
 							unbound: {},
 							ollama: {},
 							lmstudio: {},
 							roo: {},
+							deepseek: {},
 						}
```

**b)** Append a conditional `candidates.push(...)` block that mirrors the existing Poe
block. Place this directly _after_ the existing Poe candidate logic (lines ~1022–1035)
and _before_ the `// Apply single provider filter if specified` comment:

```ts
// DeepSeek is conditional on apiKey
const deepSeekApiKey = apiConfiguration.deepSeekApiKey || message?.values?.deepSeekApiKey
const deepSeekBaseUrl = apiConfiguration.deepSeekBaseUrl || message?.values?.deepSeekBaseUrl

if (deepSeekApiKey) {
	if (message?.values?.deepSeekApiKey || message?.values?.deepSeekBaseUrl) {
		await flushModels({ provider: "deepseek", apiKey: deepSeekApiKey, baseUrl: deepSeekBaseUrl }, true)
	}

	candidates.push({
		key: "deepseek",
		options: { provider: "deepseek", apiKey: deepSeekApiKey, baseUrl: deepSeekBaseUrl },
	})
}
```

`apiConfiguration.deepSeekApiKey` and `deepSeekBaseUrl` are already valid fields on
`ProviderSettings` (the schema declares them via `deepSeekSchema`), so no type
additions are needed.

---

## Step 5 — Allow DeepSeek extras in the dynamic-options union

[src/shared/api.ts](src/shared/api.ts), around line 171–181.

**Before:**

```ts
const dynamicProviderExtras = {
	openrouter: {} as {},
	"vercel-ai-gateway": {} as {},
	litellm: {} as { apiKey: string; baseUrl: string },
	poe: {} as { apiKey?: string; baseUrl?: string },
	requesty: {} as { apiKey?: string; baseUrl?: string },
	unbound: {} as { apiKey?: string },
	ollama: {} as {},
	lmstudio: {} as {},
	roo: {} as { apiKey?: string; baseUrl?: string },
} as const satisfies Record<RouterName, object>
```

**After:**

```ts
const dynamicProviderExtras = {
	openrouter: {} as {},
	"vercel-ai-gateway": {} as {},
	litellm: {} as { apiKey: string; baseUrl: string },
	poe: {} as { apiKey?: string; baseUrl?: string },
	requesty: {} as { apiKey?: string; baseUrl?: string },
	unbound: {} as { apiKey?: string },
	ollama: {} as {},
	lmstudio: {} as {},
	roo: {} as { apiKey?: string; baseUrl?: string },
	deepseek: {} as { apiKey?: string; baseUrl?: string },
} as const satisfies Record<RouterName, object>
```

The `satisfies Record<RouterName, object>` constraint will fail to compile until this
entry is added — that's the type system enforcing exhaustiveness.

(Preserve the eslint-disable comments on the empty-object rows; only the new line is
shown above.)

---

## Step 6 — Use the dynamic list in `useSelectedModel`

[webview-ui/src/components/ui/hooks/useSelectedModel.ts](webview-ui/src/components/ui/hooks/useSelectedModel.ts), lines 239–243.

**Before:**

```ts
		case "deepseek": {
			const id = apiConfiguration.apiModelId ?? defaultModelId
			const info = deepSeekModels[id as keyof typeof deepSeekModels]
			return { id, info }
		}
```

**After (combines the c358bd77e and 221dfc90d versions — the second commit hardens
validation by including static models in the allow-list):**

```ts
		case "deepseek": {
			const availableModels = routerModels.deepseek
				? { ...deepSeekModels, ...routerModels.deepseek }
				: deepSeekModels
			const id = getValidatedModelId(apiConfiguration.apiModelId, availableModels, defaultModelId)
			const routerInfo = routerModels.deepseek?.[id]
			const staticInfo = deepSeekModels[id as keyof typeof deepSeekModels]
			return { id, info: routerInfo ?? staticInfo }
		}
```

Why the merge: `getValidatedModelId` rejects an `apiModelId` that isn't in the supplied
record. If the live fetch succeeded but the user previously selected a still-valid static
model the API didn't echo back (or vice versa), we want to accept either. The router
result wins for `info` because it's the freshest pricing/context data.

`getValidatedModelId` is already used by every other dynamic provider arm in this file
(see lines 142, 158, 163, 168, 173, 321) — no import needed.

---

## Step 7 — Update the validation test fixture

[webview-ui/src/utils/**tests**/validate.spec.ts](webview-ui/src/utils/__tests__/validate.spec.ts), around lines 41–49.

**Before:**

```ts
		requesty: {},
		unbound: {},
		litellm: {},
		poe: {},
		ollama: {},
		lmstudio: {},
		"vercel-ai-gateway": {},
		roo: {},
	}
```

**After:**

```ts
		requesty: {},
		unbound: {},
		litellm: {},
		poe: {},
		ollama: {},
		lmstudio: {},
		"vercel-ai-gateway": {},
		roo: {},
		deepseek: {},
	}
```

The `RouterModels` type is `Record<DynamicProvider | LocalProvider, ModelRecord>`, so
adding `deepseek` to `dynamicProviders` (Step 1) makes this entry mandatory — the test
file fails to compile without it.

---

## Verification

Run in order; each step must pass before the next:

```bash
# 1. Whole-repo type check (catches missing entries in any consumer of dynamicProviders / RouterName)
pnpm check-types

# 2. Lint (the new fetcher should pass without disables)
pnpm lint -- src/api/providers/fetchers/deepseek.ts

# 3. Unit tests for the model cache and validation
pnpm --filter roo-cline test -- modelCache
pnpm --filter webview-ui test -- validate

# 4. Build — confirms webview bundle still typechecks against the new RouterModels shape
pnpm --filter webview-ui build
```

### Manual smoke test

1. Launch the extension in the Extension Development Host.
2. Open the Roo settings, choose **DeepSeek** provider, enter your API key.
3. Click the **Refresh Models** button next to the model picker.
    - Expected: the picker repopulates with the IDs returned by `https://api.deepseek.com/models`.
    - Both `deepseek-chat` and `deepseek-reasoner` should still be selectable, and any new
      models (e.g. `deepseek-v4`-class, if released) appear automatically.
4. Pick a brand-new model and start a task. The status bar should show `128k` context and
   the streamed reply should work normally.
5. Disconnect the network and click Refresh again. The picker should fall back to the
   two static specs (no crash, just an inline error toast from the existing fetch
   wrapper).

## Rollback

Each change is local and additive. To revert:

```bash
git restore -- \
    packages/types/src/provider-settings.ts \
    src/api/providers/fetchers/modelCache.ts \
    src/core/webview/webviewMessageHandler.ts \
    src/shared/api.ts \
    webview-ui/src/components/ui/hooks/useSelectedModel.ts \
    webview-ui/src/utils/__tests__/validate.spec.ts
rm src/api/providers/fetchers/deepseek.ts
```

The static model list in `packages/types/src/providers/deepseek.ts` is untouched, so users
keep working on the original two models if anything regresses.

## Things deliberately _not_ ported

The Zoo-Code commit `91c979877` originally added `deepseek` to
`PROVIDERS_WITH_CUSTOM_MODEL_UI` in
[webview-ui/src/components/settings/utils/providerModelConfig.ts](webview-ui/src/components/settings/utils/providerModelConfig.ts) and then immediately
reverted it. End state: the constant is unchanged, and the generic model picker — which
`ApiOptions.tsx` renders for any static-model provider not in that list — handles
DeepSeek's UI for free. Don't add `deepseek` to that array.

The Zoo-Code commit `c358bd77e` also bundles unrelated changes to `ApiOptions.tsx`
(Roo provider re-introduction, balance display, "pin to top" logic) and the cloud
sharing flow. Those are Zoo-specific and have nothing to do with DeepSeek — they are
**not** in this plan.
