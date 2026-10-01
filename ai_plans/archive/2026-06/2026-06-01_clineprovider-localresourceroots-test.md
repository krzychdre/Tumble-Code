# Fix: ClineProvider webview test missing custom-sounds resource root

## Problem

CI job **Code QA / platform-unit-test** (`pnpm test`, package `tumble-code`)
fails with 2 failing tests in
`src/core/webview/__tests__/ClineProvider.spec.ts`:

- `resolveWebviewView sets up webview correctly`
- `resolveWebviewView sets up webview correctly in development mode even if local server is not running`

## Evidence

```
FAIL  core/webview/__tests__/ClineProvider.spec.ts > ClineProvider > resolveWebviewView sets up webview correctly
AssertionError: expected { enableScripts: true, …(1) } to deeply equal { enableScripts: true, …(1) }
  {
    "enableScripts": true,
    "localResourceRoots": [
      {},
+     undefined,
    ],
  }
 ❯ core/webview/__tests__/ClineProvider.spec.ts:454:43
```

## Root cause

The custom notification sounds feature (commit `fca87d3a0`, #29) added a third
webview resource root in `src/core/webview/ClineProvider.ts:876`:

```ts
// Allow webview to load user-uploaded custom sound files (notification settings).
resourceRoots.push(vscode.Uri.file(getCustomSoundsDir(this.contextProxy.globalStorageUri.fsPath)))
```

The production change is correct — the webview must be allowed to load
user-uploaded sound files from global storage. But the test was not updated. In
the test, `vscode.Uri.file` is an implementation-less `vi.fn()` that returns
`undefined`, so the new root appears as a trailing `undefined`, and the two
assertions still expect only `[extensionUri]`.

So this is a stale test, not a product bug.

## Fix

In both failing tests, stub `vscode.Uri.file` to return a recognizable sentinel
for the single call made by `resolveWebviewView`, and assert the custom-sounds
root is present:

```ts
const customSoundsUri = { fsPath: "/test/storage/path/custom-sounds" } as vscode.Uri
;(vscode.Uri.file as any).mockReturnValueOnce(customSoundsUri)
// ...
localResourceRoots: [mockContext.extensionUri, customSoundsUri]
```

`mockReturnValueOnce` is used so the stub is consumed by the single
`resolveWebviewView` call and does not leak into other tests.

## Verification

```
$ npx vitest run core/webview/__tests__/ClineProvider.spec.ts
 Test Files  1 passed (1)
      Tests  87 passed | 6 skipped (93)
```

Full `pnpm test` previously failed only on these two tests; with the fix the
`tumble-code` package test suite is green.

## Scope / notes

- Touches only `src/core/webview/__tests__/ClineProvider.spec.ts`.
- Independent of the i18n translation fix (separate branch) — that addresses the
  other failing CI job from the same incomplete custom-sounds merge.
