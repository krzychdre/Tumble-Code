# WP-P4: Smaller webview startup bundle (lazy posthog-js and rarely used views)

Status: ready (KaTeX CSS part dropped, see section 5)
Effort: S      Risk: low      Depends on: P3 only textually (both edit `webview-ui/src/App.tsx`; rebase whichever lands second)
Branch name: fix/p4-lazy-webview-startup      Base: origin/main

## 1. Goal (2-4 sentences, plain words)

Keep code that most sessions never run out of the webview's entry chunk (`assets/index.js`, 2.96 MB today):
import `posthog-js` only when telemetry is turned on, load the Marketplace and Cloud views with `React.lazy` when
their tab opens (in `App.tsx`), and load `ModesView` and `McpView` lazily inside `SettingsView` (where they are
imported, not in `App.tsx`). Measured gain: about 270 KB (9 %) of the entry chunk.

## 2. Why it matters (user-visible effect, 2-4 sentences)

The chat panel parses and runs the entry chunk every time it opens or reloads. Removing about 270 KB of JavaScript
that the first screen never uses shortens the time until the chat is usable, most on slow machines and remote
(SSH/WSL) setups. Users with telemetry off (the default is "unset", which never initializes PostHog without a key)
never download posthog-js at all.

## 3. Read these first (exact paths, and the symbol to look for in each)

- `webview-ui/src/utils/TelemetryClient.ts` (whole file) and `webview-ui/src/__tests__/TelemetryClient.spec.ts`.
- `webview-ui/src/App.tsx`: imports of `MarketplaceView` and `CloudView`, the `tab === "marketplace"` and
  `tab === "cloud"` render blocks, `AppWithProviders`.
- `webview-ui/src/components/settings/SettingsView.tsx`: imports of `ModesView` and `McpView`, the
  `renderTab === "modes"` and `renderTab === "mcp"` blocks, the indexing loop (`indexingTabIndex`, `renderTab`).
- `webview-ui/src/index.tsx`: the existing `lazy(() => import("./components/plan-review/PlanReviewApp"))` with
  `<Suspense fallback={null}>` (the pattern to copy).
- `webview-ui/src/components/common/MarkdownBlock.tsx`: `loadRehypeKatex` (already lazy).
- `webview-ui/vite.config.ts`: `build.cssCodeSplit: false` and `rolldownOptions.output`.

## 4. Current code (verbatim excerpts, each headed by path and symbol name; line numbers only as a hint "near line N")

`webview-ui/src/utils/TelemetryClient.ts` (whole file):

```ts
import posthog from "posthog-js"

import type { TelemetrySetting } from "@roo-code/types"

class TelemetryClient {
	private static instance: TelemetryClient
	private static telemetryEnabled: boolean = false

	public updateTelemetryState(telemetrySetting: TelemetrySetting, apiKey?: string, distinctId?: string) {
		posthog.reset()

		if (telemetrySetting !== "disabled" && apiKey && distinctId) {
			TelemetryClient.telemetryEnabled = true

			posthog.init(apiKey, {
				api_host: "https://ph.roocode.com",
				ui_host: "https://us.posthog.com",
				persistence: "localStorage",
				loaded: () => posthog.identify(distinctId),
				capture_pageview: false,
				capture_pageleave: false,
				autocapture: false,
			})
		} else {
			TelemetryClient.telemetryEnabled = false
		}
	}

	public static getInstance(): TelemetryClient {
		if (!TelemetryClient.instance) {
			TelemetryClient.instance = new TelemetryClient()
		}

		return TelemetryClient.instance
	}

	public capture(eventName: string, properties?: Record<string, any>) {
		if (TelemetryClient.telemetryEnabled) {
			try {
				posthog.capture(eventName, properties)
			} catch (_error) {
				// Silently fail if there's an error capturing an event.
			}
		}
	}
}

export const telemetryClient = TelemetryClient.getInstance()
```

`webview-ui/src/App.tsx` (line 1, lines 19 and 23):

```ts
import React, { useCallback, useEffect, useRef, useState, useMemo } from "react"
```

```ts
import { MarketplaceView } from "./components/marketplace/MarketplaceView"
```

```ts
import { CloudView } from "./components/cloud/CloudView"
```

`webview-ui/src/App.tsx`, `App` render (near line 252):

```tsx
			{tab === "marketplace" && (
				<MarketplaceView
					stateManager={marketplaceStateManager}
					onDone={() => switchTab("chat")}
					targetTab={currentMarketplaceTab as "mcp" | "mode" | undefined}
				/>
			)}
			{tab === "cloud" && (
				<CloudView
					userInfo={cloudUserInfo}
					isAuthenticated={cloudIsAuthenticated}
					cloudApiUrl={cloudApiUrl}
					organizations={cloudOrganizations}
				/>
			)}
```

`webview-ui/src/components/settings/SettingsView.tsx` (lines 1-11, 66-67, near 653-664):

```ts
import React, {
	forwardRef,
	memo,
	useCallback,
	useEffect,
	useImperativeHandle,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react"
```

```ts
import ModesView from "../modes/ModesView"
import McpView from "../mcp/McpView"
```

```tsx
						{renderTab === "modes" && (
							<ModesView
								onSelectApiConfiguration={(configName: string) =>
									checkUnsaveChanges(() =>
										vscode.postMessage({ type: "loadApiConfiguration", text: configName }),
									)
								}
							/>
						)}

						{/* MCP Section */}
						{renderTab === "mcp" && <McpView />}
```

## 5. Root cause / analysis

VERIFIED by a production build of the current tree into a scratch folder
(`npx vite build --outDir <scratch> --emptyOutDir` from `webview-ui`, 25 s) and a source-map attribution script
(section 8): `assets/index.js` = 2,959,484 bytes, `assets/index.css` = 157,533 bytes. Bytes of the entry chunk by
origin: posthog-js 154.4 KB, components/modes 51.0 KB, components/marketplace 34.0 KB, components/mcp 16.9 KB,
components/cloud 15.1 KB (settings 305 KB and chat 291 KB stay, they are needed at startup). The marker string
`__PosthogExtensions__` (posthog-js internals) occurs 30 times in `index.js`.

Claims checked:
- "posthog-js imported statically by utils/TelemetryClient.ts": correct (the only importer in `webview-ui/src`).
- "MarketplaceView, CloudView, ModesView, McpView imported statically in App.tsx": PARTLY WRONG. `App.tsx` imports
  `MarketplaceView` and `CloudView`. `ModesView` and `McpView` are imported by
  `components/settings/SettingsView.tsx` (lines 66-67), which `App.tsx` imports statically. So the lazy boundary for
  those two goes into `SettingsView`. `SettingsView` itself stays static: `App` calls
  `settingsRef.current?.checkUnsaveChanges(...)` through its ref on every tab switch.
- "KaTeX CSS imported eagerly in index.css while rehype-katex is lazy": correct, but moving it does NOT help with the
  current build: `vite.config.ts` sets `cssCodeSplit: false` ("Use a single combined CSS bundle so all webviews
  share styles"), so a CSS import inside the lazy loader is still extracted into the one `assets/index.css` loaded at
  startup. Loading it as `?inline` text and injecting a `<style>` would break the KaTeX font `url()`s (the CSS is
  served through `asWebviewUri` and its fonts are resolved relative to `assets/index.css`; inline CSS would resolve
  them against the webview origin). The KaTeX fonts (`assets/fonts/KaTeX_*`) are already fetched only when a formula
  uses them (browsers load `@font-face` on first use). The remaining cost is ~24 KB of CSS
  (`katex.min.css` is 24,788 bytes). NOT done in this WP; a follow-up could revisit it together with `cssCodeSplit`.

Behaviour of the new TelemetryClient (verified: the spec in section 7 passes 10/10 against the new code and fails
4/10 against the current code, run in a scratch copy with the webview's vitest):
- `posthog-js` is imported on the first enable (`setting !== "disabled"` with a key and a distinct id; the same
  condition as today).
- An update while the import is pending wins: an older enable does not initialize after a newer call (generation
  counter).
- Events captured between enable and initialization are queued (at most 50) and sent after `init`, so the first
  events after hydration are not lost.
- `reset()` is called only when posthog-js was loaded; before, `reset()` on a never-initialized client was a no-op.

HYPOTHESIS: other webview specs that render `App` or `SettingsView` and look for the marketplace, cloud, modes or MCP
view synchronously (`getByTestId`) would need `findByTestId`. Checked at `aa173b9`: `App.spec.tsx` already uses
`findByTestId("marketplace-view")`, and `SettingsView.unsaved-changes.spec.tsx` uses
`await screen.findByTestId("modes-select-profile")`. Confirm with section 8 step 5; if a spec fails only on
timing, change its `getBy...` for the lazy view to `await findBy...` and list it in the PR.

## 6. Step-by-step changes

Part A: posthog-js on demand.

1. Replace the whole content of `webview-ui/src/utils/TelemetryClient.ts` with:

```ts
import type { PostHog } from "posthog-js"

import type { TelemetrySetting } from "@roo-code/types"

/** Events captured while posthog-js is still loading; sent once it is initialized. */
const MAX_PENDING_EVENTS = 50

/**
 * Sends webview telemetry to PostHog. posthog-js (about 150 KB) is imported
 * only when telemetry is turned on, so it is not part of the startup bundle.
 */
class TelemetryClient {
	private static instance: TelemetryClient
	private static telemetryEnabled: boolean = false

	private posthog?: PostHog
	private posthogLoad?: Promise<PostHog>
	// Each updateTelemetryState call gets a number; an import that resolves
	// after a newer call must not initialize PostHog with outdated settings.
	private generation = 0
	private initialized = false
	private pending: Array<[string, Record<string, any> | undefined]> = []

	private loadPostHog(): Promise<PostHog> {
		this.posthogLoad ??= import("posthog-js").then(
			(module) => {
				this.posthog = module.default
				return module.default
			},
			(error) => {
				this.posthogLoad = undefined
				throw error
			},
		)
		return this.posthogLoad
	}

	public updateTelemetryState(telemetrySetting: TelemetrySetting, apiKey?: string, distinctId?: string) {
		const generation = ++this.generation
		this.initialized = false
		this.posthog?.reset()

		if (telemetrySetting !== "disabled" && apiKey && distinctId) {
			TelemetryClient.telemetryEnabled = true

			this.loadPostHog()
				.then((posthog) => {
					if (generation !== this.generation) {
						return
					}

					posthog.reset()
					posthog.init(apiKey, {
						api_host: "https://ph.roocode.com",
						ui_host: "https://us.posthog.com",
						persistence: "localStorage",
						loaded: () => posthog.identify(distinctId),
						capture_pageview: false,
						capture_pageleave: false,
						autocapture: false,
					})
					this.initialized = true

					const pending = this.pending
					this.pending = []
					for (const [eventName, properties] of pending) {
						this.capture(eventName, properties)
					}
				})
				.catch(() => {
					// Telemetry is best effort: a failed import only drops events.
					this.pending = []
				})
		} else {
			TelemetryClient.telemetryEnabled = false
			this.pending = []
		}
	}

	public static getInstance(): TelemetryClient {
		if (!TelemetryClient.instance) {
			TelemetryClient.instance = new TelemetryClient()
		}

		return TelemetryClient.instance
	}

	public capture(eventName: string, properties?: Record<string, any>) {
		if (!TelemetryClient.telemetryEnabled) {
			return
		}

		if (!this.initialized || !this.posthog) {
			if (this.pending.length < MAX_PENDING_EVENTS) {
				this.pending.push([eventName, properties])
			}
			return
		}

		try {
			this.posthog.capture(eventName, properties)
		} catch (_error) {
			// Silently fail if there's an error capturing an event.
		}
	}
}

export const telemetryClient = TelemetryClient.getInstance()
```

   (`api_host` stays `https://ph.roocode.com`: changing where telemetry goes is not part of this WP.)

Part B: lazy Marketplace and Cloud views in `App.tsx`.

2. `webview-ui/src/App.tsx` line 1: replace
   `import React, { useCallback, useEffect, useRef, useState, useMemo } from "react"` with
   `import React, { Suspense, lazy, useCallback, useEffect, useRef, useState, useMemo } from "react"`.
3. Delete the line `import { MarketplaceView } from "./components/marketplace/MarketplaceView"` and the line
   `import { CloudView } from "./components/cloud/CloudView"`. Keep
   `import { MarketplaceViewStateManager } from "./components/marketplace/MarketplaceViewStateManager"` (App needs it at startup).
4. Directly after the last import (`import { STANDARD_TOOLTIP_DELAY } from "./components/ui/standard-tooltip"`),
   insert:

```ts

// Rarely opened tabs: loaded the first time their tab is shown, so they stay
// out of the startup bundle. Both modules use named exports.
const MarketplaceView = lazy(() =>
	import("./components/marketplace/MarketplaceView").then((module) => ({ default: module.MarketplaceView })),
)
const CloudView = lazy(() => import("./components/cloud/CloudView").then((module) => ({ default: module.CloudView })))
```

5. Replace the two render blocks quoted in section 4 with:

```tsx
			{tab === "marketplace" && (
				<Suspense fallback={null}>
					<MarketplaceView
						stateManager={marketplaceStateManager}
						onDone={() => switchTab("chat")}
						targetTab={currentMarketplaceTab as "mcp" | "mode" | undefined}
					/>
				</Suspense>
			)}
			{tab === "cloud" && (
				<Suspense fallback={null}>
					<CloudView
						userInfo={cloudUserInfo}
						isAuthenticated={cloudIsAuthenticated}
						cloudApiUrl={cloudApiUrl}
						organizations={cloudOrganizations}
					/>
				</Suspense>
			)}
```

   The `Suspense` goes inside each `tab === ...` condition, never around `ChatView` (ChatView must stay mounted and
   must never be suspended).

Part C: lazy ModesView and McpView in `SettingsView.tsx`.

6. `webview-ui/src/components/settings/SettingsView.tsx`: in the React import list (lines 1-11) add `Suspense,` after
   `React, {` and `lazy,` after `forwardRef,`, keeping alphabetical order as the file does:

```ts
import React, {
	Suspense,
	forwardRef,
	lazy,
	memo,
	useCallback,
	useEffect,
	useImperativeHandle,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react"
```

7. Delete the two lines `import ModesView from "../modes/ModesView"` and `import McpView from "../mcp/McpView"`.
8. After the last import (`import { onExtensionMessage } from "@src/utils/extensionBus"`), insert:

```ts

// The Modes and MCP tabs are large and only needed once Settings opens.
const ModesView = lazy(() => import("../modes/ModesView"))
const McpView = lazy(() => import("../mcp/McpView"))
```

9. Replace the two render blocks quoted in section 4 with:

```tsx
						{renderTab === "modes" && (
							<Suspense fallback={null}>
								<ModesView
									onSelectApiConfiguration={(configName: string) =>
										checkUnsaveChanges(() =>
											vscode.postMessage({ type: "loadApiConfiguration", text: configName }),
										)
									}
								/>
							</Suspense>
						)}

						{/* MCP Section */}
						{renderTab === "mcp" && (
							<Suspense fallback={null}>
								<McpView />
							</Suspense>
						)}
```

   Note: the search-index loop renders every tab once when Settings opens, so opening Settings starts loading both
   chunks; the win is at panel startup. `ModesView` and `McpView` register no searchable settings
   (`grep -n "useSearchIndexContext\|registerSetting" webview-ui/src/components/modes/ModesView.tsx webview-ui/src/components/mcp/McpView.tsx`
   prints nothing), so a suspended render during indexing loses nothing from the search index.

## 7. Tests to add or change

A. Replace the whole content of `webview-ui/src/__tests__/TelemetryClient.spec.ts` with:

```ts
import posthog from "posthog-js"

vi.mock("posthog-js", () => ({
	default: {
		init: vi.fn(),
		reset: vi.fn(),
		identify: vi.fn(),
		capture: vi.fn(),
	},
}))

// A fresh module (and singleton) per test: the client remembers whether
// posthog-js was loaded.
const loadClient = async () => {
	vi.resetModules()
	return (await import("@src/utils/TelemetryClient")).telemetryClient
}

describe("TelemetryClient", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("should be a singleton", async () => {
		const telemetryClient = await loadClient()
		const constructor = Object.getPrototypeOf(telemetryClient).constructor
		expect(constructor.getInstance()).toBe(telemetryClient)
	})

	describe("updateTelemetryState", () => {
		it("initializes PostHog when telemetry is enabled with API key and distinctId", async () => {
			const telemetryClient = await loadClient()

			telemetryClient.updateTelemetryState("enabled", "test-api-key", "test-user-id")
			await vi.dynamicImportSettled()

			expect(posthog.init).toHaveBeenCalledWith(
				"test-api-key",
				expect.objectContaining({
					api_host: "https://ph.roocode.com",
					persistence: "localStorage",
					loaded: expect.any(Function),
				}),
			)
			const { loaded } = vi.mocked(posthog.init).mock.calls[0][1] as { loaded: () => void }
			loaded()
			expect(posthog.identify).toHaveBeenCalledWith("test-user-id")
		})

		it("resets PostHog on a later update once it was loaded", async () => {
			const telemetryClient = await loadClient()
			telemetryClient.updateTelemetryState("enabled", "k", "u")
			await vi.dynamicImportSettled()
			vi.mocked(posthog.reset).mockClear()

			telemetryClient.updateTelemetryState("disabled")

			expect(posthog.reset).toHaveBeenCalledTimes(1)
		})

		it.each(["disabled", "unset"] as const)(
			"does not load or initialize PostHog when telemetry is %s",
			async (setting) => {
				const telemetryClient = await loadClient()

				telemetryClient.updateTelemetryState(setting)
				await vi.dynamicImportSettled()

				expect(posthog.init).not.toHaveBeenCalled()
				expect(posthog.reset).not.toHaveBeenCalled()
			},
		)

		it("does not initialize with outdated settings when telemetry is turned off while posthog-js loads", async () => {
			const telemetryClient = await loadClient()

			telemetryClient.updateTelemetryState("enabled", "k", "u")
			telemetryClient.updateTelemetryState("disabled")
			await vi.dynamicImportSettled()

			expect(posthog.init).not.toHaveBeenCalled()
		})
	})

	describe("capture", () => {
		it("captures events when telemetry is enabled", async () => {
			const telemetryClient = await loadClient()
			telemetryClient.updateTelemetryState("enabled", "test-key", "test-user")
			await vi.dynamicImportSettled()

			telemetryClient.capture("test_event", { property: "value" })

			expect(posthog.capture).toHaveBeenCalledWith("test_event", { property: "value" })
		})

		it("sends events captured while posthog-js was loading once it is initialized", async () => {
			const telemetryClient = await loadClient()
			telemetryClient.updateTelemetryState("enabled", "test-key", "test-user")

			telemetryClient.capture("early_event", { n: 1 })
			expect(posthog.capture).not.toHaveBeenCalled()

			await vi.dynamicImportSettled()
			expect(posthog.capture).toHaveBeenCalledWith("early_event", { n: 1 })
		})

		it.each(["disabled", "unset"] as const)("doesn't capture events when telemetry is %s", async (setting) => {
			const telemetryClient = await loadClient()
			telemetryClient.updateTelemetryState(setting)
			await vi.dynamicImportSettled()

			telemetryClient.capture("test_event")

			expect(posthog.capture).not.toHaveBeenCalled()
		})
	})
})
```

   Against the current `TelemetryClient.ts`, 4 of these 10 fail (the two "does not load or initialize", "outdated
   settings", "sent once it is initialized"); against the new code all pass (both verified in a scratch copy).

B. (Passes before and after by design, like the existing marketplace tests: it guards the Suspense wiring, not a bug;
   the failing-first proof of this WP is test A.) `webview-ui/src/__tests__/App.spec.tsx`: add inside `describe("App", ...)`:

```ts
	it("shows the lazily loaded cloud view when receiving cloudButtonClicked", async () => {
		render(<AppWithProviders />)

		act(() => {
			triggerMessage("cloudButtonClicked")
		})

		expect(await screen.findByTestId("cloud-view")).toBeInTheDocument()
		expect(screen.getByTestId("chat-view").getAttribute("data-hidden")).toBe("true")
	})
```

   (It passes before and after; it pins that the Suspense boundary renders the view. The existing marketplace tests
   already `await findByTestId("marketplace-view")`. VERIFIED in a scratch copy: the whole `App.spec.tsx` plus this
   test passes (20/20) with the lazy `App.tsx` of steps 2-5 applied.)

C. No new SettingsView test: `SettingsView.unsaved-changes.spec.tsx` ("API profile picked in the Modes tab") already
   opens the Modes tab and waits with `findByTestId`; `components/ui/__tests__/panels.call-sites.spec.tsx` and
   `text-area.call-sites.spec.tsx` import `McpView`/`ModesView` directly and are unaffected.

## 8. Commands to run (exact, from which directory) and the expected result

1. Baseline bundle (before any change), from `/home/user/Tumble-Code/webview-ui`:

```sh
OUT=/tmp/p4-before && npx vite build --outDir $OUT --emptyOutDir > $OUT.log 2>&1
ls -l $OUT/assets/index.js $OUT/assets/index.css
grep -o "__PosthogExtensions__" $OUT/assets/index.js | wc -l
```

   Expected at `aa173b9`: index.js about 2,959,484 bytes, index.css about 157,533 bytes, marker count 30.
   (`--outDir` keeps the real `src/webview-ui/build` untouched.)
2. Apply section 6 and write the tests of section 7.
3. `cd /home/user/Tumble-Code/webview-ui && npx vitest run src/__tests__/TelemetryClient.spec.ts src/__tests__/App.spec.tsx` -> pass.
4. After build, same commands with `OUT=/tmp/p4-after`: expected index.js smaller by roughly 250-280 KB, marker count
   in `index.js` = 0, and `grep -l "__PosthogExtensions__" /tmp/p4-after/assets/*.js` lists one separate chunk.
   Per-module attribution (optional, prints KB of the entry chunk per origin); save as `/tmp/attr.cjs`:

```js
const fs = require("fs")
const { SourceMapConsumer } = require(process.argv[2])
const dir = process.argv[3]
const code = fs.readFileSync(dir + "/assets/index.js", "utf8")
const map = JSON.parse(fs.readFileSync(dir + "/assets/index.js.map", "utf8"))
const smc = new SourceMapConsumer(map)
const lines = code.split("\n")
const bytes = {}
const maps = []
smc.eachMapping((m) => maps.push(m))
for (let i = 0; i < maps.length; i++) {
	const m = maps[i]
	const n = maps[i + 1]
	const len =
		n && n.generatedLine === m.generatedLine
			? n.generatedColumn - m.generatedColumn
			: lines[m.generatedLine - 1].length - m.generatedColumn
	bytes[m.source || "(none)"] = (bytes[m.source || "(none)"] || 0) + len
}
const key = (s) => {
	const nm = s.match(/node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?((?:@[^/]+\/)?[^/]+)/)
	if (nm) return "npm:" + nm[1]
	const c = s.match(/src\/components\/([^/]+)/)
	return c ? "components/" + c[1] : "other"
}
const groups = {}
for (const [s, b] of Object.entries(bytes)) groups[key(s)] = (groups[key(s)] || 0) + b
for (const k of ["npm:posthog-js", "components/marketplace", "components/cloud", "components/modes", "components/mcp"])
	console.log(k.padEnd(26), ((groups[k] || 0) / 1024).toFixed(1), "KB")
```

   Run: `node /tmp/attr.cjs "$(ls -d /home/user/Tumble-Code/node_modules/.pnpm/source-map-js@*/node_modules/source-map-js | head -1)" /tmp/p4-before`
   and the same with `/tmp/p4-after`. Baseline output: posthog-js 154.4, marketplace 34.0, cloud 15.1, modes 51.0,
   mcp 16.9. After: posthog-js 0, modes near 0, marketplace and cloud near 0 except `MarketplaceViewStateManager`
   (still imported by App), mcp reduced to what the chat view shares.
5. `cd /home/user/Tumble-Code/webview-ui && npx vitest run` -> same pass/fail as origin/main.
6. `cd /home/user/Tumble-Code/webview-ui && pnpm check-types && pnpm lint` -> clean (lint includes the React
   compiler bail-out check).
7. `cd /home/user/Tumble-Code && npx prettier --check webview-ui/src/utils/TelemetryClient.ts webview-ui/src/App.tsx webview-ui/src/components/settings/SettingsView.tsx webview-ui/src/__tests__/TelemetryClient.spec.ts webview-ui/src/__tests__/App.spec.tsx`.
8. Manual smoke in VS Code (F5 extension host with a production webview build): open Marketplace, Cloud, Settings >
   Modes and Settings > MCP; each renders after a brief blank. With telemetry enabled, PostHog requests still go out
   (DevTools network tab of the webview).

## 9. Do not touch / pitfalls

- Do-not-touch: `webview-ui/src/hooks/useScrollLifecycle.ts` and the ChatRow height contract; never put `ChatView`
  under a `Suspense` boundary or make it lazy (its comment in `App.tsx` says it must stay mounted).
- Keep `SettingsView` static (the ref `settingsRef` must exist on every tab switch).
- Do not change `cssCodeSplit` or the KaTeX CSS import in this WP (see section 5).
- `TelemetryEventName` runtime values are do-not-touch; the client passes names through unchanged.
- Many specs `vi.mock("@src/utils/TelemetryClient", ...)`; the export name `telemetryClient` and its methods
  `updateTelemetryState` and `capture` must keep their signatures.
- The bundle boundary plugin (`src/vite-plugins/bundleBoundaryPlugin`) rejects chunk imports of `vscode`; none of the
  new chunks import it.

## 10. Acceptance checklist (checkboxes)

- [ ] `posthog-js` is imported only by `import("posthog-js")` in `TelemetryClient.ts`; entry chunk has 0 `__PosthogExtensions__`.
- [ ] MarketplaceView and CloudView lazy in `App.tsx`; ModesView and McpView lazy in `SettingsView.tsx`, each with its own `Suspense`.
- [ ] Before/after sizes of `assets/index.js` recorded in the PR (expect about -270 KB).
- [ ] New TelemetryClient spec (10 cases) and App cloud test pass; full webview suite as baseline.
- [ ] check-types, lint, prettier clean.

## 11. Commit, changeset and PR text

Commit title: `perf(webview): load posthog-js and rarely used views on demand (P4)`

Body:

```
posthog-js is imported only when telemetry is turned on (events captured
while it loads are queued); the Marketplace and Cloud views load when their
tab opens and the Modes and MCP views when Settings renders them. The entry
chunk shrinks from 2.96 MB by about 270 KB. The KaTeX stylesheet stays: with
cssCodeSplit off it would end up in the same startup CSS file.

<the commit attribution trailers your harness requires>
```

`.changeset/p4-lazy-webview-startup.md`:

```
---
"tumble-code": patch
---

The chat panel opens faster: the telemetry library is loaded only when telemetry is on, and the Marketplace, Cloud,
Modes and MCP screens are loaded the first time they are opened instead of at startup.
```

`ai_plans/2026-MM-DD_p4-lazy-webview-startup.md`:

```
# P4: lazy webview startup code

Item P4 of `2026-09-27_simplification-roadmap.md`.

## Problem
The entry chunk (2.96 MB) carried posthog-js (154 KB) and the Marketplace, Cloud, Modes and MCP views (~117 KB)
that the first screen never uses.

## Change
Dynamic import of posthog-js with a generation guard and a small event queue; React.lazy for MarketplaceView and
CloudView (App.tsx) and ModesView and McpView (SettingsView.tsx, where they are imported). KaTeX CSS not moved:
cssCodeSplit is off, so it would stay in the single startup stylesheet.

## Tests
TelemetryClient.spec.ts rewritten for the async load (10 cases); App.spec.tsx cloud view through Suspense. Bundle
sizes before/after in the PR.
```

PR body outline: Summary; before/after table (index.js bytes, marker counts, per-module KB); the claim corrections
(ModesView/McpView live in SettingsView; KaTeX not worth it with cssCodeSplit off); tests; end with
the PR attribution footer your harness requires (see 00-README.md, section 3).

## 12. If stuck

- If the after-build still shows `__PosthogExtensions__` in `index.js`, another module imports `posthog-js`
  statically: `grep -rn "posthog-js" webview-ui/src --include=*.ts --include=*.tsx | grep -v __tests__` and report it.
- If `vi.dynamicImportSettled` is not available in the installed vitest, replace each
  `await vi.dynamicImportSettled()` with `await new Promise((resolve) => setTimeout(resolve, 0))` twice and report.
- If a lazy view fails to load in the real webview (blank tab, console error about a chunk URL), stop and report
  the console error; do not change `base` or `cssCodeSplit`.
