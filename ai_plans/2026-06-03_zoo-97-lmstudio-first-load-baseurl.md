# Port Zoo-Code #97 — LM Studio misses models on first load (unsaved base URL)

**Date:** 2026-06-03
**Branch:** `feature/zoo-97-lmstudio-first-load-baseurl` (off `main`)
**Upstream:** Zoo-Code PR #97 (`340f53e32`), "[Fix] Setup announcement shows the wrong origin and LM Studio misses models on first load"

## §0. Credit

Upstream PR #97 was authored entirely by `roomote[bot]` (an AI assistant; the
only `Co-authored-by` trailer is `Roomote <roomote@roocode.com>`, the same bot).
Per our credit rule, bot / AI-assistant trailers are dropped — and here no human
author remains. **No `Co-authored-by:` trailer on this commit.**

## §1. Scope — split PR, port only the bug fix

Zoo #97 bundles two unrelated changes:

| Part                              | What                                                                                                                                | Decision                                                                                                                                                                                                                            |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. LM Studio first-load**       | Refresh request now passes the _unsaved_ base URL the user just typed, so models load on first open instead of after a save+reopen. | **PORT** — webview/provider UX bug fix, not branding.                                                                                                                                                                               |
| **B. `chat.json` "wrong origin"** | Fixes Zoo's handoff announcement copy ("picks up where Zoo Code left off" → "Roo Code").                                            | **SKIP** — Zoo-specific rebrand text. Our `webview-ui/src/i18n/locales/en/chat.json:379` handoff block is already fully rebranded to Tumble Code ("From Roo Code to Tumble Code …") and never contained Zoo's bug. N/A to our fork. |

**Do NOT touch `chat.json`. Do NOT re-introduce any Roo/Zoo branding.**

### The bug (root cause, verified against our code)

On the LM Studio settings panel, the model list is refreshed on mount and on
provider-select by posting `{ type: "requestLmStudioModels" }` with **no
payload**. The extension handler
([webviewMessageHandler.ts:1153](../src/core/webview/webviewMessageHandler.ts#L1153))
ignores any request base URL and reads only the **persisted**
`lmStudioApiConfig.lmStudioBaseUrl` from `provider.getState()`. So when a user
first types a custom base URL (e.g. `http://127.0.0.1:4321`) but has **not yet
saved settings**, the refresh queries the old/default URL and the model list
comes back empty — "LM Studio misses models on first load". The fix threads the
in-flight base URL through the request and has the handler prefer it.

Our code matches Zoo's pre-fix state at every touch-point (verified):

- [useLmStudioModels.ts](../webview-ui/src/components/ui/hooks/useLmStudioModels.ts) — no `requestLmStudioModels` export, `getLmStudioModels()` takes no arg, posts bare message.
- [webviewMessageHandler.ts:1153-1177](../src/core/webview/webviewMessageHandler.ts#L1153) — reads only persisted `lmStudioBaseUrl`.
- [ApiOptions.tsx:237](../webview-ui/src/components/settings/ApiOptions.tsx#L237) — `vscode.postMessage({ type: "requestLmStudioModels" })`.
- [LMStudio.tsx:56](../webview-ui/src/components/settings/providers/LMStudio.tsx#L56) — refresh-on-mount posts bare message.
- Fetcher [lmstudio.ts:52](../src/api/providers/fetchers/lmstudio.ts#L52) — `getLMStudioModels(baseUrl = "http://localhost:1234")` already accepts a base URL. ✅
- `WebviewMessage.values` is `Record<string, any>` ([vscode-extension-host.ts:616](../packages/types/src/vscode-extension-host.ts#L616)) — `values.baseUrl` is already type-safe; **no type change needed**. `requestOpenAiModels` already reads `message.values.baseUrl`.

## §2. Design

A new shared helper `requestLmStudioModels(baseUrl?)` posts the message with a
`{ baseUrl }` payload **whenever `baseUrl` is a string** (including `""` — an
explicit "use the typed value" request), and posts no payload otherwise. The
handler: if `message.values?.baseUrl` is a string, call the fetcher directly
with it (preview path, no cache flush); otherwise keep the existing
flush+getModels persisted path (backward compatible — the existing test with no
`values` still hits this branch).

`""` must be preserved as a real request (not coalesced to undefined) so that
clearing the field re-queries the default rather than silently reusing stale
persisted models.

## §3. TDD — failing tests first

### 3a. Backend handler test (RED)

File: [src/core/webview/**tests**/webviewMessageHandler.spec.ts](../src/core/webview/__tests__/webviewMessageHandler.spec.ts)

Add the mock near the top (after line 6, `vi.mock("../../../api/providers/fetchers/modelCache")`):

```ts
vi.mock("../../../api/providers/fetchers/lmstudio", () => ({
	getLMStudioModels: vi.fn(),
}))
```

Add the import (after line 44, `import { getModels } …`):

```ts
import { getLMStudioModels } from "../../../api/providers/fetchers/lmstudio"
```

Add the mock handle (after line 49, `const mockGetModels …`):

```ts
const mockGetLMStudioModels = getLMStudioModels as Mock<typeof getLMStudioModels>
```

In the `requestLmStudioModels` describe `beforeEach` (line 167-175), after
`vi.clearAllMocks()` add:

```ts
mockGetLMStudioModels.mockReset()
```

Append two tests inside that describe (before its closing `})` at line 206):

```ts
it("prefers the request payload base URL over persisted settings", async () => {
	mockGetLMStudioModels.mockResolvedValue({})

	await webviewMessageHandler(mockClineProvider, {
		type: "requestLmStudioModels",
		values: { baseUrl: "http://127.0.0.1:4321" },
	})

	expect(mockGetLMStudioModels).toHaveBeenCalledWith("http://127.0.0.1:4321")
	expect(mockGetModels).not.toHaveBeenCalled()
})

it("treats an empty-string base URL as an explicit preview request", async () => {
	mockGetLMStudioModels.mockResolvedValue({})

	await webviewMessageHandler(mockClineProvider, {
		type: "requestLmStudioModels",
		values: { baseUrl: "" },
	})

	expect(mockGetLMStudioModels).toHaveBeenCalledWith("")
	expect(mockGetModels).not.toHaveBeenCalled()
})
```

Run (expect 2 RED, the existing test still green):

```
cd src && npx vitest run core/webview/__tests__/webviewMessageHandler.spec.ts
```

### 3b. UI helper test (RED — new file)

File: `webview-ui/src/components/ui/hooks/__tests__/useLmStudioModels.spec.ts` (new)

```ts
vi.mock("@src/utils/vscode", () => ({
	vscode: {
		postMessage: vi.fn(),
	},
}))

import { vscode } from "@src/utils/vscode"

import { requestLmStudioModels } from "../useLmStudioModels"

describe("requestLmStudioModels", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("includes the current unsaved base URL when requesting models", () => {
		requestLmStudioModels("http://127.0.0.1:1234")

		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "requestLmStudioModels",
			values: { baseUrl: "http://127.0.0.1:1234" },
		})
	})

	it("preserves an empty base URL so the extension can fall back to the default", () => {
		requestLmStudioModels("")

		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "requestLmStudioModels",
			values: { baseUrl: "" },
		})
	})
})
```

Run (expect RED — `requestLmStudioModels` not exported yet):

```
cd webview-ui && npx vitest run src/components/ui/hooks/__tests__/useLmStudioModels.spec.ts
```

## §4. Production edits (GREEN)

### 4a. `webview-ui/src/components/ui/hooks/useLmStudioModels.ts`

Add the exported helper above `getLmStudioModels` and have the promise use it:

```ts
export const requestLmStudioModels = (baseUrl?: string) =>
	vscode.postMessage({
		type: "requestLmStudioModels",
		values: typeof baseUrl === "string" ? { baseUrl } : undefined,
	})

const getLmStudioModels = async (baseUrl?: string) =>
	new Promise<ModelRecord>((resolve, reject) => {
		// …unchanged body…
		window.addEventListener("message", handler)
		requestLmStudioModels(baseUrl) // was: vscode.postMessage({ type: "requestLmStudioModels" })
	})
```

Leave `useLmStudioModels(modelId?)` unchanged.

### 4b. `src/core/webview/webviewMessageHandler.ts`

Add import near the other fetcher imports (the file imports `getModels, flushModels`
from `../../api/providers/fetchers/modelCache` at line 75):

```ts
import { getLMStudioModels } from "../../api/providers/fetchers/lmstudio"
```

Replace the body of `case "requestLmStudioModels":` (lines 1153-1177) inner `try`:

```ts
			try {
				const requestedBaseUrl = message.values?.baseUrl
				const hasPreviewBaseUrl = typeof requestedBaseUrl === "string"
				let lmStudioModels: ModelRecord
				if (hasPreviewBaseUrl) {
					lmStudioModels = await getLMStudioModels(requestedBaseUrl)
				} else {
					const lmStudioOptions = {
						provider: "lmstudio" as const,
						baseUrl: lmStudioApiConfig.lmStudioBaseUrl,
					}
					// Flush cache and refresh to ensure fresh models.
					await flushModels(lmStudioOptions, true)
					lmStudioModels = await getModels(lmStudioOptions)
				}

				if (Object.keys(lmStudioModels).length > 0) {
					provider.postMessageToWebview({
						type: "lmStudioModels",
						lmStudioModels: lmStudioModels,
					})
				}
			} catch (error) {
```

(`ModelRecord` is already imported in this file — used elsewhere; verify, add to
the `@roo-code/types` import if grep shows it absent.)

### 4c. `webview-ui/src/components/settings/ApiOptions.tsx`

Add import near the other hook imports (around line 49, with `useSelectedModel`):

```ts
import { requestLmStudioModels } from "@src/components/ui/hooks/useLmStudioModels"
```

At line 237 replace:

```ts
			} else if (selectedProvider === "lmstudio") {
				requestLmStudioModels(apiConfiguration?.lmStudioBaseUrl)
```

### 4d. `webview-ui/src/components/settings/providers/LMStudio.tsx`

- Add `useRef` to the `react` import (line 1).
- Add import:

```ts
import { requestLmStudioModels } from "@src/components/ui/hooks/useLmStudioModels"
```

- If `vscode` is now otherwise unused in the file, drop its import (Zoo did —
  verify with grep before removing; if still used elsewhere, keep it).
- Add a ref capturing the initial base URL (near the `lmStudioModels` state, ~line 25):

```ts
const initialBaseUrlRef = useRef(apiConfiguration?.lmStudioBaseUrl)
```

- In the refresh-on-mount `useEffect` (line 54-57) replace the post:

```ts
requestLmStudioModels(initialBaseUrlRef.current)
```

Keep the empty `[]` dep array (the ref keeps it lint-clean — no new deps).

## §5. Verification

```
cd src && npx vitest run core/webview/__tests__/webviewMessageHandler.spec.ts
cd webview-ui && npx vitest run src/components/ui/hooks/__tests__/useLmStudioModels.spec.ts
```

Then gates from repo root:

```
pnpm check-types
pnpm lint
```

### Acceptance criteria (binary)

- [ ] Both new backend tests pass; the pre-existing "successfully fetches models from LMStudio" test still passes (no-`values` → persisted flush path).
- [ ] Both new UI helper tests pass.
- [ ] `check-types` and `lint` clean.
- [ ] `chat.json` untouched; no Roo/Zoo branding introduced.
- [ ] No type-schema change (relies on existing `values: Record<string, any>`).

## §6. Landmines

- Do **not** port Part B (`chat.json` handoff copy) — our text is already rebranded and correct.
- Preserve `""` as an explicit request in both helper and handler (`typeof === "string"`, not truthiness) — a falsy-check would regress the "clear field → re-query default" path.
- Keep the no-payload persisted path intact for backward compatibility (existing test + any caller that posts the bare message).
- Don't re-add TTS / Roo router / cloud upsell. Don't rename internal ids.
