# Webview context value frozen by the React Compiler

Branch `fix/webview-context-frozen-by-compiler`, from `origin/main` at `17a976ff6`.
Reported by the owner on the welcome screen of the VSIX built 2026-09-28 23:42:
"Can't change to anything but Anthropic".

## Symptom

On the welcome screen the API Provider list opens, but clicking another
provider (for example OpenAI Compatible) closes the list and it still shows
Anthropic. Nothing else happens.

## Root cause (verified)

- Reproduced in real Chromium (playwright-core against the webview Vite dev
  server, state pushed with `window.postMessage`). The click reaches the cmdk
  item (pointerdown, mousedown, pointerup, mouseup and click all land on it),
  and temporary logs showed the whole chain runs: `SearchableSelect.handleSelect("openai")`,
  `ApiOptions.onProviderChange("openai")`, `WelcomeViewProvider` calls
  `setApiConfiguration({ apiProvider: "openai" })`. The store changes; the
  view does not.
- `ExtensionStateContextProvider` (P1, #551, `73f19fc75`) passed
  `value={client.getValue()}` to `ExtensionStateContext.Provider` and read
  `client.getStore().clineMessagesResyncRequested` in the render body.
- The React Compiler (vite.config.ts, `reactCompilerPreset({ target: "19" })`)
  memoizes both calls on `client`, which is created once and never changes.
  The compiled provider served by Vite:

  ```js
  if ($[15] !== client) {
      t8 = client.getValue();
      $[15] = client;
      $[16] = t8;
  } else {
      t8 = $[16];
  }
  ```

  So every `useExtensionState()` consumer saw the value of the first render
  forever. `useExtensionSelector` consumers were fine (they read inside a
  `useSyncExternalStore` snapshot function), which is why most of the app
  kept working. The same freeze hit `resyncRequested`, so the
  `resyncClineMessages` request could never be sent.
- Vitest does not run the React Compiler, so a jsdom render test of the same
  flow passes (checked: switching to OpenAI Compatible works there). That is
  why no existing test caught it.

## Fix

- The provider reads both through `useSyncExternalStore`:
  `store` (`client.getStore`) drives the auto-approval echo and the resync
  effects, `value` (`client.getValue`) is the context value. Both getters are
  stable arrow properties and return a new object only when the store changed,
  so they are valid snapshots.
- `ExtensionStoreClient.getVersion` and its counter had no other reader and
  are removed.

## Regression test

`webview-ui/src/context/__tests__/ExtensionStateContext.compiler.spec.ts`
compiles `ExtensionStateContext.tsx` with the same Babel (from
`@rolldown/plugin-babel`) and compiler options as the Vite build and asserts
that no `client.getValue()` / `client.getStore()` call is memoized on
`client`. It fails on `origin/main` and passes with the fix.

## Verification

- Real Chromium, fixed build: after the click the trigger shows
  OpenAI Compatible and the webview posts `requestProviderModels`.
- `vitest run src/context src/components/welcome`: 9 files, 162 tests pass.
- `tsc --noEmit` (webview-ui), eslint on `src/context`, the compiler bailout
  check (7 known, unchanged) pass.
- knip exits 1 with the same three findings on a clean `origin/main` worktree
  set up the same way (linked node_modules), so nothing new.

## Residual

- Other render-body reads of a stable object's getter would freeze the same
  way under the compiler. A grep of `webview-ui/src` found no other
  `getStore()` / `getValue()` render reads; the general pattern is not guarded.
- The installed VSIX needs a rebuild to pick this up.
