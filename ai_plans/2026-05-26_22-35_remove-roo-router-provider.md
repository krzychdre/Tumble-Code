# Remove Roo (Tumble) Router provider — investigation & plan

**Status:** In progress (stacked branches 13 → 16)
**Related plans:** [2026-05-26_rebrand-roo-to-tumble-code.md](2026-05-26_rebrand-roo-to-tumble-code.md)
**Base:** `rebrand/12-rename-manifest-ids-to-package-name` (current tip)

## Motivation

The welcome screen's "Choose your provider" step defaults users to the Roo Code Router — a meta-provider that proxies LLM calls through `app.roocode.com`. In this community fork that infra is not ours to operate, the cloud-routed model is not the direction we want users defaulting into, and we are spotlighting local-inference (per commit `f504e4bb7`). The router is the wrong shape for this fork.

This change removes the router _provider_ entirely — the API handler, schema, settings UI, welcome-screen CTA, and image-generation surface. CloudService itself (auth, task sharing, telemetry sinks, MDM) stays intact: users may still sign in to a Tumble Code Cloud if one exists, but cloud auth is no longer wired to a built-in proxy provider.

## Scope (locked)

- **In:** RooHandler + fetcher + Roo provider schema + Roo settings UI + welcome-screen router option + Roo image-generation models + RooBalanceDisplay + Roo credit-balance hook + ImageGenerationSettings "roo" option + CLI onboarding "Roo Code Cloud" choice + web-evals "roo" provider option + all tests for above + i18n strings for the above.
- **Out:** `packages/cloud/` (CloudService, WebAuthService, telemetry client) stays. `rooCloudSignIn` / `rooCloudSignOut` / `rooCloudManualUrl` webview messages stay (still used by `CloudView.tsx` and `useCloudUpsell.ts`). The internal `Roo` token in class names (`RooIgnoreController`, `RooCodeAPI`, `RooCodeEventName`, …) stays per [project_rebrand_tumble_code.md](../).

## Branch stack

| #   | Branch                                    | Cut from         | Purpose                                                                                                                                                                                                                                                                   |
| --- | ----------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `rebrand/13-remove-router-welcome-screen` | `rebrand/12-...` | Remove router CTA + `"roo"` radio from `WelcomeViewProvider`, drop welcome.json strings for it across all locales. Provider stays selectable in settings.                                                                                                                 |
| 2   | `rebrand/14-remove-router-settings-ui`    | branch 1 tip     | Remove `Roo.tsx`, `RooBalanceDisplay.tsx`, the `selectedProvider === "roo"` branch in `ApiOptions.tsx`, the PROVIDERS entry, the image-gen "roo" option, the `useRooCreditBalance` + `useRooPortal` hooks.                                                                |
| 3   | `rebrand/15-remove-router-handler-schema` | branch 2 tip     | Delete `RooHandler` + fetcher, remove `case "roo"` everywhere in `src/api/`, drop `rooSchema`/`rooDefaultModelId`/`RooModelsResponse` types, remove `extension.ts` auth-state roo-models cache + stored-model code, collapse `ImageGenerationProvider` to `"openrouter"`. |
| 4   | `rebrand/16-cleanup-router-peripherals`   | branch 3 tip     | CLI onboarding choice, web-evals `useRooCodeCloudModels`, `ExtensionStateContext` roo-auth-gate effect, settings.json `providers.roo.*` i18n keys, `requestRooModels`/`requestRooCreditBalance` webview message types, leftover tests.                                    |

Each branch is independently buildable on top of its parent.

## Touched files (per branch)

### Branch 1 — welcome screen

- `webview-ui/src/components/welcome/WelcomeViewProvider.tsx` — collapse `ProviderOption` to `"custom"` only; drop `selectedProvider === "roo"` branch, drop the `useEffect` that saves `apiProvider: "roo"` after cloud auth, drop `handleNoAccount`'s default-to-roo, drop the second radio option, drop `useProviderSignup` flow.
- `webview-ui/src/i18n/locales/{20 locales}/welcome.json` — remove `routers.roo`, `providerSignup.rooCloudProvider`, `providerSignup.rooCloudDescription`, `providerSignup.noApiKeys`, `providerSignup.backToTumble`, `providerSignup.learnMore`.
- `webview-ui/src/components/welcome/__tests__/WelcomeViewProvider.spec.tsx` — drop cases that exercise the router option.

### Branch 2 — settings UI

- `webview-ui/src/components/settings/ApiOptions.tsx` — remove `Roo` and `RooBalanceDisplay` imports, drop `rooDefaultModelId` import, drop the `selectedProvider === "roo"` request-router-models case, the `RooBalanceDisplay` render, the `selectedProvider === "roo"` render branch, `roo` in `PROVIDER_MODEL_CONFIG`, the pin-roo-to-top logic, the filter-out-roo-on-welcome-view logic.
- `webview-ui/src/components/settings/constants.ts` — drop the `{ value: "roo", label: "Roo Code Router" }` entry from PROVIDERS.
- `webview-ui/src/components/settings/utils/providerModelConfig.ts` — drop `"roo"` from the providers list.
- `webview-ui/src/components/settings/providers/Roo.tsx` — DELETE.
- `webview-ui/src/components/settings/providers/RooBalanceDisplay.tsx` — DELETE.
- `webview-ui/src/components/settings/providers/index.ts` — drop `Roo` export.
- `webview-ui/src/components/settings/ImageGenerationSettings.tsx` — drop the "Roo Code Cloud" `<VSCodeOption>`, collapse the provider select to just OpenRouter (or drop the select entirely if only one option remains).
- `webview-ui/src/components/ui/hooks/useRouterModels.ts` — drop `roo` from the comment / single-provider filter examples.
- `webview-ui/src/components/ui/hooks/useSelectedModel.ts` — drop `case "roo"`.
- `webview-ui/src/components/ui/hooks/useRooCreditBalance.ts` — DELETE.
- `webview-ui/src/components/ui/hooks/useRooPortal.ts` — DELETE if only the router used it; keep if CloudView still references.
- Tests: `ApiOptions.spec.tsx`, `ImageGenerationSettings.spec.tsx`, `RooBalanceDisplay.spec.tsx`.

### Branch 3 — handler, schema, types

- `src/api/providers/roo.ts` — DELETE.
- `src/api/providers/fetchers/roo.ts` — DELETE.
- `src/api/providers/__tests__/roo.spec.ts` — DELETE.
- `src/api/providers/fetchers/__tests__/roo.spec.ts` — DELETE.
- `src/api/providers/index.ts` — drop `RooHandler` export.
- `src/api/index.ts` — drop `case "roo"`, drop `RooHandler` import, trim doc-comment line about `X-Roo-Task-ID`.
- `src/api/providers/fetchers/modelCache.ts` — drop `case "roo"`, drop `getRooModels` import.
- `src/api/providers/utils/__tests__/error-handler.spec.ts` — drop the "roo" error-mapping tests.
- `src/api/transform/reasoning.ts` — drop `getRooReasoning` if only the router used it.
- `src/extension.ts` — remove `handleRooModelsCache`, the `roo-provider-model` stored-model branch, simplify `authStateChangedHandler` (only `postStateListener()` remains in the previous-state-active branch).
- `src/extension/api.ts` — drop `provider: "roo" as const` model fetching.
- `src/shared/checkExistApiConfig.ts` — drop `"roo"` from the no-config list.
- `src/core/tools/GenerateImageTool.ts` — drop the `modelProvider === "roo"` branch + the `RooHandler` import; image-gen now only works through OpenRouter.
- `packages/types/src/provider-settings.ts` — remove `"roo"` from `dynamicProviders` and `providerNames`, delete `rooSchema`, remove its entry from `providerSettingsSchemaDiscriminated`, drop `...rooSchema.shape` from `providerSettingsSchema`, drop `modelIdKeysByProvider.roo`, drop the `MODELS_BY_PROVIDER.roo` entry, drop the `"roo"` from the `["vercel-ai-gateway", "roo"]` check in `getApiProtocol()`.
- `packages/types/src/providers/roo.ts` — DELETE.
- `packages/types/src/providers/index.ts` — drop `export * from "./roo.js"`, drop the `rooDefaultModelId` import, drop the `case "roo"` arm in `getProviderDefaultModelId`.
- `packages/types/src/image-generation.ts` — collapse `ImageGenerationProvider` to `"openrouter"`, drop the three Roo Code Cloud entries, change `getImageGenerationProvider` to always return `"openrouter"`.

### Branch 4 — peripherals

- `apps/cli/src/types/types.ts` — drop `OnboardingProviderChoice.Roo`, drop `"roo"` from `supportedProviders`.
- `apps/cli/src/ui/components/onboarding/OnboardingScreen.tsx` — drop "Connect to Roo Code Cloud" option.
- `apps/cli/src/lib/utils/onboarding.ts` — drop the `OnboardingProviderChoice.Roo` branch.
- `apps/cli/src/index.ts` — drop the `auth` command pitched as "Authenticate with Roo Code Cloud" (or rebrand to plain `cloud-auth` if needed).
- `apps/cli/src/commands/cli/run.ts` — drop the "Roo Code Cloud authentication" branch.
- `apps/cli/src/lib/storage/__tests__/settings.test.ts` — drop `OnboardingProviderChoice.Roo` tests.
- `apps/web-evals/src/hooks/use-roo-code-cloud-models.ts` — DELETE.
- `apps/web-evals/src/app/runs/new/new-run.tsx` — drop the Roo provider branch.
- `apps/web-evals/src/components/home/runs.tsx` — drop roo provider filtering.
- `apps/web-evals/src/lib/__tests__/roo-last-model-selection.spec.ts` — DELETE.
- `webview-ui/src/context/ExtensionStateContext.tsx` — drop the `currentProvider === "roo"` auth-state effect that calls `requestRooModels`.
- `webview-ui/src/context/__tests__/ExtensionStateContext.roo-auth-gate.spec.tsx` — DELETE.
- `packages/types/src/vscode-extension-host.ts` — drop the `"requestRooModels" | "requestRooCreditBalance"` webview message variants; drop `useProviderSignup` field from WebviewMessage; drop `"rooCreditBalance"` from ExtensionMessage.
- `src/core/webview/webviewMessageHandler.ts` — drop the `case "requestRooModels"` and `case "requestRooCreditBalance"` arms; drop the auto-add-roo-profile block (`provider: "roo"` profile creation around L1000); drop `roo-auth-skip-model` globalState clear (no longer reachable).
- `webview-ui/src/i18n/locales/{20 locales}/settings.json` — drop `providers.roo.*` keys.

## Failure surface

| Scenario                                      | Before                                                                                     | After                                                                                                                                            |
| --------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Fresh install, first launch                   | Welcome screen shows "Tumble Code Router" + "3rd-party Provider" radio, defaults to router | Welcome screen shows provider selection going straight to `<ApiOptions>`; no router CTA                                                          |
| Existing user with `apiProvider: "roo"` saved | Roo settings panel loads, balance shown                                                    | `apiProvider` falls through schema validation; Zod normalizes to `undefined`; user sees the empty/default provider in settings and must pick one |
| Image generation tool called                  | "roo" or "openrouter" depending on `imageGenerationProvider`                               | Only OpenRouter path remains                                                                                                                     |
| `useCloudUpsell` / `CloudView` sign-in button | Triggers `rooCloudSignIn` webview message, opens browser to roocode.com auth               | Unchanged — CloudService stays intact                                                                                                            |

## Migration / legacy users

Existing user profiles with `apiProvider: "roo"` will fail provider-settings schema validation in branch 3 and be normalized to `undefined` (the default case in `buildApiHandler` returns an `AnthropicHandler`, but with no API key it will error on first request — user must pick a real provider). No migration shim is added; the welcome screen / settings panel surface this clearly.

## Notes / caveats

- We **do not** delete `CloudService` or any `roo*Cloud*` infrastructure. The cloud sign-in flow still works; it just no longer auto-creates a router profile.
- We **do not** rename internal identifiers (`RooIgnoreController`, `.roo/`, `RooCodeAPI`, etc.) — these stay per the rebrand plan's compatibility rule.
- The `webview-ui/src/index.css` and `webview-ui/src/components/welcome/RooHero.tsx` changes the user already has staged are unrelated and left untouched.
- `webview-ui/src/components/chat/__tests__/TaskActions.spec.tsx` references `useCloudUpsell` Roo Code Cloud copy — unchanged (that's cloud, not router).

## Tests

Per branch: run `pnpm -w lint`, `pnpm -w check-types`, and the workspace `pnpm -w test` on the package that owns the touched files. Each branch must build cleanly before the next is cut.
