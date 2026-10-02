# WP-P3: Post webviewDidLaunch once, from the state provider only

Status: ready
Effort: S      Risk: low      Depends on: none
Branch name: fix/p3-single-webview-did-launch      Base: origin/main

## 1. Goal (2-4 sentences, plain words)

At startup the webview sends `webviewDidLaunch` twice: once from `App` (`webview-ui/src/App.tsx`) and once from
`ExtensionStateContextProvider` (`webview-ui/src/context/ExtensionStateContext.tsx`). Each one makes the extension
host run its whole launch routine. Remove the copy in `App.tsx` and keep the provider's.

## 2. Why it matters (user-visible effect, 2-4 sentences)

The host handler for `webviewDidLaunch` reads custom modes, writes them to global state, builds and posts the full
state (with the whole task history), reads the theme, posts the MCP server list, lists provider profiles and
more. Doing it twice at every panel open or reload doubles that work and sends the full state and history twice,
which slows the first paint on large histories.

## 3. Read these first (exact paths, and the symbol to look for in each)

- `webview-ui/src/App.tsx`: the effect `useEffect(() => vscode.postMessage(WEBVIEW_DID_LAUNCH_MESSAGE), [])` and
  the import of `WEBVIEW_DID_LAUNCH_MESSAGE`; `AppWithProviders` (the provider wraps `App`).
- `webview-ui/src/context/ExtensionStateContext.tsx`: the effect posting `WEBVIEW_DID_LAUNCH_MESSAGE`.
- `webview-ui/src/context/webviewDidLaunchMessage.ts` (the message constant).
- `src/core/webview/messageHandlers/taskLifecycle.ts`: `webviewDidLaunch` handler (what the host does per launch).
- `webview-ui/src/__tests__/App.spec.tsx` (mocks `ExtensionStateContext` and `@src/utils/vscode`).
- `webview-ui/src/context/__tests__/ExtensionStateContext.messages.spec.tsx` (asserts the provider's launch post).

## 4. Current code (verbatim excerpts, each headed by path and symbol name; line numbers only as a hint "near line N")

`webview-ui/src/App.tsx` (near line 14):

```ts
import { WEBVIEW_DID_LAUNCH_MESSAGE } from "./context/webviewDidLaunchMessage"
```

`webview-ui/src/App.tsx`, `App` (near line 203):

```ts
	// Tell the extension that we are ready to receive messages.
	useEffect(() => vscode.postMessage(WEBVIEW_DID_LAUNCH_MESSAGE), [])
```

`webview-ui/src/context/ExtensionStateContext.tsx`, `ExtensionStateContextProvider` (near line 171):

```ts
	useEffect(() => {
		vscode.postMessage(WEBVIEW_DID_LAUNCH_MESSAGE)
	}, [])
```

`src/core/webview/messageHandlers/taskLifecycle.ts`, `webviewDidLaunch` (near line 14, start):

```ts
	webviewDidLaunch: async (ctx, message) => {
		const { provider, getGlobalState, updateGlobalState } = ctx
		// A (re)loaded webview starts without the task history and without any
		// chat message: the state push below must carry both in full. Before any
		// await, so no push that started earlier can be taken for having
		// delivered them. The view also declares whether it applies messageAdded.
		provider.forgetWebviewTaskHistory()
		provider.setWebviewAcceptsMessageAdded(message.acceptsMessageAdded === true)
		// Load custom modes first
		const customModes = await provider.customModesManager.getCustomModes()
		await updateGlobalState("customModes", customModes)

		provider.postStateToWebview()
```

## 5. Root cause / analysis

VERIFIED (read): both effects run on mount with `[]` dependencies. `AppWithProviders` renders
`<ExtensionStateContextProvider> ... <App /> ...`, so both components mount once per webview load and each posts the
same message (`App`'s effect first, since child effects run before parent effects). `grep -rn webviewDidLaunch webview-ui/src`
shows no other sender. Both posts carry `acceptsMessageAdded: true` (same constant), so keeping one loses nothing.

VERIFIED: the host handler is not idempotent-cheap: it calls `forgetWebviewTaskHistory()`, awaits
`getCustomModes()`, writes global state, calls `postStateToWebview()` (full state, history included because it was
just forgotten), `workspaceTracker.initializeFilePaths()`, `getTheme()`, posts `mcpServers`, and
`providerSettingsManager.listConfig()`. The second launch repeats all of it. The CLI
(`apps/cli/src/agent/extension-host.ts:532`) sends its own single launch and is not affected.

Keeping the provider's copy (as the roadmap says) is right: the provider owns the extension-state lifecycle, and its
test (`ExtensionStateContext.messages.spec.tsx`) already asserts the launch message as the provider's first post.

Note: `webview-ui/src/index.tsx` renders inside `<StrictMode>`, so in a DEV build React runs mount effects twice and the
provider's launch is still sent twice in development. That is React's dev-only double invoke, not this bug; the
production build sends it once after this WP.

## 6. Step-by-step changes

1. `webview-ui/src/App.tsx`: delete the import line

```ts
import { WEBVIEW_DID_LAUNCH_MESSAGE } from "./context/webviewDidLaunchMessage"
```

2. `webview-ui/src/App.tsx`: delete these two lines (and the blank line after them, so no double blank line remains):

```ts
	// Tell the extension that we are ready to receive messages.
	useEffect(() => vscode.postMessage(WEBVIEW_DID_LAUNCH_MESSAGE), [])
```

   `useEffect` and `vscode` stay imported: `App.tsx` still uses both (other effects near lines 174, 185, 197, 207, 230
   and `vscode.postMessage` near lines 103, 177, 225).

3. `webview-ui/src/context/ExtensionStateContext.tsx`: add a comment above the kept effect. Find

```ts
	useEffect(() => {
		vscode.postMessage(WEBVIEW_DID_LAUNCH_MESSAGE)
	}, [])
```

   replace with

```ts
	// The one launch message of this view: the host answers it with the full
	// state. Only this provider sends it (App used to send a second one).
	useEffect(() => {
		vscode.postMessage(WEBVIEW_DID_LAUNCH_MESSAGE)
	}, [])
```

4. Add the test in section 7.

## 7. Tests to add or change

Add to `webview-ui/src/__tests__/App.spec.tsx`.

a) Add an import below `import AppWithProviders from "../App"`:

```ts
import { vscode } from "@src/utils/vscode"
```

(`@src/utils/vscode` is already mocked at the top of this file with `postMessage: vi.fn()`.)

b) Add this test inside `describe("App", () => { ... })`, after the first test (`"shows chat view by default"`):

```ts
	it("does not post webviewDidLaunch itself: the ExtensionStateContextProvider sends the only one", () => {
		render(<AppWithProviders />)

		const launches = vi
			.mocked(vscode.postMessage)
			.mock.calls.filter(([message]) => (message as { type?: string }).type === "webviewDidLaunch")
		expect(launches).toEqual([])
	})
```

VERIFIED in a scratch copy of `App.spec.tsx`: this test fails on the current `App.tsx` ("expected [ [ { ... } ] ] to
deeply equal []") and passes with the effect removed (the other 18 App tests keep passing).

Why it fails without the fix: in this spec `ExtensionStateContextProvider` is mocked to a pass-through, so the only
`webviewDidLaunch` post comes from `App`'s own effect; before the change `launches` has one entry.

The provider side is already covered: `webview-ui/src/context/__tests__/ExtensionStateContext.messages.spec.tsx`
(`"posts one host update per toggle when auto-approval is toggled twice"`) asserts the exact post list starting with
exactly one `{ type: "webviewDidLaunch", acceptsMessageAdded: true }`. Leave it unchanged.

No host-side test change: `src/core/webview/__tests__/webviewMessageHandler.routing.spec.ts` (types
`webviewDidLaunch` and `webviewDidLaunch#acceptsMessageAdded`) and `ClineProvider.spec.ts` /
`ClineProvider.taskHistory.spec.ts` test the handler per message, which does not change.

## 8. Commands to run (exact, from which directory) and the expected result

1. Add the test only, then `cd /home/user/Tumble-Code/webview-ui && npx vitest run src/__tests__/App.spec.tsx -t "does not post webviewDidLaunch"`
   -> fails (1 launch found).
2. Apply section 6, re-run -> passes.
3. `cd /home/user/Tumble-Code/webview-ui && npx vitest run src/__tests__/App.spec.tsx src/context` -> all pass.
4. `cd /home/user/Tumble-Code/webview-ui && pnpm check-types` -> no errors.
5. `cd /home/user/Tumble-Code/webview-ui && pnpm lint` (eslint + React compiler bail-out check) -> clean.
6. `cd /home/user/Tumble-Code && npx prettier --check webview-ui/src/App.tsx webview-ui/src/context/ExtensionStateContext.tsx webview-ui/src/__tests__/App.spec.tsx`.
7. Optional manual check (real extension host): open the Tumble Code panel with the extension's output channel open
   and confirm the launch is handled once (one "state" push with history at startup). The e2e suite is not needed
   for this (AGENTS.md: lowest layer that proves it).

## 9. Do not touch / pitfalls

- Do not change `WEBVIEW_DID_LAUNCH_MESSAGE` or the `webviewDidLaunch` shape (`WebviewMessage` is a public shape;
  the CLI sends it without `acceptsMessageAdded`).
- Do not change the host handler (`taskLifecycle.ts`) or `forgetWebviewTaskHistory` / `setWebviewAcceptsMessageAdded`
  (state delivery to the webview is on the do-not-touch list).
- Keep the provider's effect; removing that one instead would break `ExtensionStateContext.messages.spec.tsx` and
  any view that renders the provider without `App`.
- Do not remove `<StrictMode>` to "fix" the dev-only double effect.

## 10. Acceptance checklist (checkboxes)

- [ ] `grep -rn "WEBVIEW_DID_LAUNCH_MESSAGE" webview-ui/src --include=*.tsx --include=*.ts | grep -v __tests__` lists only
      `context/webviewDidLaunchMessage.ts` and `context/ExtensionStateContext.tsx`.
- [ ] New App.spec test failed before, passes after; `src/context` specs pass.
- [ ] check-types, lint, prettier clean.

## 11. Commit, changeset and PR text

Commit title: `perf(webview): send webviewDidLaunch once at startup (P3)`

Body:

```
Both App and ExtensionStateContextProvider posted webviewDidLaunch on mount,
so the host ran its launch routine twice: custom modes, a full state push
with the whole task history, theme, MCP servers, profile sync. Only the
provider sends it now.

<the commit attribution trailers your harness requires>
```

`.changeset/p3-single-webview-did-launch.md`:

```
---
"tumble-code": patch
---

Opening or reloading the Tumble Code panel no longer makes the extension build and send the full state and task
history twice, so the panel is ready sooner when the task history is large.
```

`ai_plans/2026-MM-DD_p3-single-webview-did-launch.md`:

```
# P3: webviewDidLaunch once

Item P3 of `2026-09-27_simplification-roadmap.md`.

## Problem
App.tsx and ExtensionStateContextProvider both posted webviewDidLaunch on mount; the host ran its whole launch
routine (custom modes, full state push with history, theme, MCP list, profile sync) twice.

## Change
Removed the App.tsx effect; the provider's is the only sender. (Dev builds still double it through StrictMode.)

## Tests
App.spec.tsx: App itself posts no webviewDidLaunch. ExtensionStateContext.messages.spec.tsx already pins the
provider's single launch.
```

PR body outline: Summary; what the host does per launch (why it matters); tests; StrictMode note; end with
the PR attribution footer your harness requires (see 00-README.md, section 3).

## 12. If stuck

- If another spec renders `App` without the provider and expects a `webviewDidLaunch` post, report its name; do not
  add the post back to `App`.
- If `pnpm lint` reports a React compiler bail-out in `App.tsx` after the edit, report the message.
