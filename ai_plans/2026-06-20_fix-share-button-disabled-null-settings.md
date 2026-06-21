# Fix: Share button stays disabled — extension-settings emits JSON `null`, client Zod rejects it

Date: 2026-06-20
Branch: feature/self-hosted-web-task-viewer
Area: self-hosted-cloudapi (settings serialization)

## Symptom

In the extension Task header the Share (Share2) icon is rendered **disabled** (greyed
out, not clickable). Tooltip would read "sharingDisabledByOrganization".

## Root cause (proven with evidence)

The Share button is disabled in exactly one branch of `ShareButton.tsx`:

```
cloudIsAuthenticated && !sharingEnabled  ->  disabled
```

`sharingEnabled` comes from `CloudService.canShareTask()`, which returns
`settingsService.getSettings()?.cloudSettings?.enableTaskSharing`. That value is
populated by `CloudSettingsService.fetchSettings()` from `GET /api/extension-settings`.

Evidence collected:

1. **Backend returns the right value over HTTP (200):** for the real user
   `user_2c8fdf212b024808aa7a1ba1a`, `organization.cloudSettings.enableTaskSharing`
   is `true`. So the data is correct.

2. **But the client never stores it.** The extension's VS Code `globalState`
   (`QUB-IT.tumble-code` → key `organization-settings`) is **`null`**. The fetch
   never populated the cache.

3. **Why the cache is null — schema parse fails.** The backend (Pydantic) serializes
   _unset_ `Optional` fields as JSON `null`:
   `features:null, hiddenMcps:null, hideMarketplaceMcps:null, mcps:null,
providerProfiles:null, cloudSettings.recordTaskMessages:null, ...` and on the user
   side `settings.taskSyncEnabled:null`.

    The client schemas (`packages/types/src/cloud.ts`) declare these as `.optional()`,
    which accepts `undefined` but **rejects `null`**. Running the real
    `organizationSettingsSchema` / `userSettingsDataSchema` against the live response:

    ```
    ORG parse success: false
      cloudSettings.recordTaskMessages: Expected boolean, received null
      features: Expected object, received null
      hiddenMcps: Expected array, received null
      ... (10 issues)
    USER parse success: false
      settings.taskSyncEnabled: Expected boolean, received null
    ```

    `parseExtensionSettingsResponse` therefore returns `{success:false}`,
    `fetchSettings()` logs "Invalid extension settings format" and returns without
    assigning `this.settings`. Cache stays `null` → `canShareTask()` → `false` →
    button disabled.

4. **Fix verified:** stripping nulls (what `exclude_none=True` does) makes both
   schemas parse, and `enableTaskSharing === true`.

This is a backend contract bug: "optional" in the client means _may be absent_, not
_may be explicit null_. The backend must omit unset optionals rather than emit `null`.

## Fix

Serialize the settings responses with nulls omitted. Add
`response_model_exclude_none=True` to both routes in
`self-hosted-cloudapi/src/routers/settings.py`:

- `GET /api/extension-settings`
- `PATCH /api/user-settings` (same model family, parsed by the same strict client
  schema in `CloudSettingsService.updateUserSettings`)

`exclude_none` only drops `null` values; required non-null fields (`version`,
`defaultSettings: {}`, `allowList`, `cloudSettings.enableTaskSharing: true`,
`features: {}`) are preserved.

## Post-fix activation

The running uvicorn has no `--reload`, and the client already cached `null`:

1. Restart the backend so the new serialization takes effect.
2. Reload the extension host window (or sign out/in). On the next fetch the response
   parses, `organization-settings` is cached, and the Share button enables.

## Tests

Extend `self-hosted-cloudapi/tests/test_web_and_share.py` (or settings tests) to
assert the `/api/extension-settings` response contains **no `null` values** at any
nesting level, and that `organization.cloudSettings.enableTaskSharing` is present.
