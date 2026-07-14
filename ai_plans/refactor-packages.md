# Packages (`packages/`) Refactor Audit

## Executive summary

- **`packages/types/src/vscode-extension-host.ts` is a 920-line god-file holding three monolithic message unions** (`ExtensionMessage`, `WebviewMessage` with ~170 inline literals, `WebViewMessagePayload`) in one flat-bag interface — the single biggest blocker to the cross-cutting registry refactor. Splitting it into per-domain discriminated-union modules (mirroring the already-clean `ipc.ts`) is the highest-leverage move. _(cognitive complexity, extensibility)_
- **`provider-settings.ts` (648 lines) centralizes ~10 change points per provider** — the `providerNames` array, the inline `anthropic`/`bedrock`/… literals appended _after_ the composed sub-arrays, the `providerSettingsSchemaDiscriminated` 25-arm union, the `providerSettingsSchema` shape spreads (with a duplicated `poeSchema.shape`), `modelIdKeysByProvider`, `MODELS_BY_PROVIDER`, and `getProviderDefaultModelId`'s 25-case switch. Each provider should own one self-describing module. _(extensibility, maintainability)_
- **`TelemetryService.ts` (292 lines) has ~30 hand-written `captureXxx()` wrapper methods** that re-encode properties the typed `rooCodeTelemetryEventSchema` already defines — adding an event touches 3 files (the `TelemetryEventName` enum, the `z.enum([...])` re-enumeration in `rooCodeTelemetryEventSchema`, and a new wrapper here). A schema-driven dispatcher collapses this to 1. _(extensibility, elegance)_
- **`CustomToolRegistry` is ~60% custom-tool-specific** (esbuild transpilation, `.env` copying, Zod-shape validation) layered over a generic `Map<string, T>` core — it is a _partial_ exemplar. Extracting a generic `Registry<K, V>` (the `has`/`get`/`list`/`getAll`/`register`/`unregister`/`clear` spine) into `packages/core` gives the backend/frontend registries a clean base without the esbuild coupling. _(elegance, extensibility)_
- **`CloudService` (504 lines) is a pass-through god-facade singleton** with ~40 delegating methods and hand-rolled `if (env var) StaticX else CloudX` strategy selection — adding a third auth or settings backend means editing `initialize()`. The `bridge/types.ts` structural-interface pattern (already used to keep cloud decoupled from `src/`) is the model to generalize. _(maintainability, extensibility)_

## Strategic role of this audit

`packages/types` is the **shared contract layer** the backend and frontend registries must key on. Its dependency hygiene is excellent — `types` is a verified leaf (zero imports from `src/`, `webview-ui/`, or sibling `packages/*`), and `core` depends only on `types` — so the cross-cutting registry refactor is **unblocked at the dependency layer**. The blocker is _structural_, not directional: the three big unions (`ProviderName`, `ToolName`, `WebviewMessage["type"]`) are **monolithic literal lists in one file each**, so even with a registry the act of _adding a new provider/tool/message_ still edits a central type file. The fix is to compose these unions from per-domain sub-unions (the `provider-settings.ts:37-101` `DynamicProvider`/`LocalProvider`/`InternalProvider`/`CustomProvider`/`FauxProvider` pattern is the in-repo proof this works) and mirror the `ipc.ts` discriminated-union-with-per-variant-`data` shape for the message types. `custom-tool-registry.ts` is a **reusable exemplar only after extraction** — its registry spine is generic, but ~60% of the file is esbuild/validation/env-file coupling that must not leak into `nativeToolRegistry` / `providerRegistry` / `webviewMessageRegistry`.

## Findings by package

### 1. packages/types (shared contract layer) — TOP PRIORITY

#### 1.1 — `vscode-extension-host.ts` 920-line god-file with three monolithic message unions

- **What** — One file holds `ExtensionMessage` ([`vscode-extension-host.ts:31`](packages/types/src/vscode-extension-host.ts:31), Extension→Webview, ~80 inline literals + ~60 optional payload fields), `WebviewMessage` ([`vscode-extension-host.ts:456`](packages/types/src/vscode-extension-host.ts:456), Webview→Extension, ~170 inline literals + ~60 optional payload fields), and `WebViewMessagePayload` ([`vscode-extension-host.ts:783`](packages/types/src/vscode-extension-host.ts:783)). Both message interfaces use the anti-pattern of a single `interface { type: "lit1"|"lit2"|…; field?: T; field?: T; … }` — a flat bag of optional fields shared across all message variants, so the type system cannot enforce that message `X` carries payload `Y`. `ExtensionMessage.payload` is typed `any` (line 112) with an eslint-disable.
- **Criterion** — low cognitive complexity (920 lines, 3 unions, ~120 optional fields in one scope); extensibility (the monolithic union is the change-point the registries can't eliminate); human maintainability (no clear ownership — worktree messages, skills messages, marketplace messages, indexing messages all intermixed).
- **Change points today vs. after** — Today, adding a webview message: (1) add literal to the `WebviewMessage.type` union (line 456-631), (2) add payload field(s) to the same interface, (3) add to backend dispatch switch, (4) add to frontend handler, (5) possibly add to `WebViewMessagePayload` union (line 783) — **5 spots, 2 in this one file**. After split into per-domain discriminated unions: (1) add one `z.object({ type: z.literal("…"), payload: … })` variant in its domain module, (2) add to backend registry, (3) add to frontend registry — **3 spots, 1 in types**, and the payload is type-narrowed automatically.
- **Proposed refactor** — Split `vscode-extension-host.ts` into:
    - `messages/extension-message.ts` — `ExtensionMessage` as `z.discriminatedUnion("type", […])` with per-variant `data`/`payload` shapes, composed from sub-domain modules (`messages/extension/worktree.ts`, `messages/extension/marketplace.ts`, `messages/extension/indexing.ts`, …).
    - `messages/webview-message.ts` — `WebviewMessage` as `z.discriminatedUnion("type", […])`, composed from sub-domain modules (`messages/webview/worktree.ts`, `messages/webview/skills.ts`, `messages/webview/mcp.ts`, …). Each domain owns its variants.
    - `messages/payloads.ts` — the shared payload schemas (`CheckpointDiffPayload`, etc.) that cross domains.
    - Keep `ExtensionState` (the large state interface, lines ~330-430) in `extension-state.ts` — it's a legitimately big but _single-concern_ type.
    - **Mirror the `ipc.ts` shape**: `IpcMessageType` enum + `ipcMessageSchema = z.discriminatedUnion("type", [per-variant z.object])` is the in-repo exemplar of how to do this cleanly ([`ipc.ts:107-125`](packages/types/src/ipc.ts:107)).
- **Risk** — High blast radius: every `case "foo":` in backend dispatch and every `switch (message.type)` in the webview touches these literals. Must be done as a mechanical, type-preserving migration (the discriminated union is a strict refinement of the current bag). Interacts with the registry refactor as its **prerequisite** — the registries can only be clean if the union they key on is itself cleanly partitioned.
- **Evidence** — 920 lines; `ExtensionMessage` union spans lines 31-108; `WebviewMessage` union spans lines 456-631; `payload?: any` at line 112.

#### 1.2 — `provider-settings.ts` 648-line god-file with ~10 change points per provider

- **What** — Adding a provider today edits, all in [`provider-settings.ts`](packages/types/src/provider-settings.ts): (1) the `providerNames` array (line 107-130, which appends ~16 inline literals _after_ the composed sub-arrays — a missing sub-domain), (2) a per-provider `xxxSchema` (e.g. `anthropicSchema` line 204, `bedrockSchema` line 218, … ~25 schemas), (3) the `providerSettingsSchemaDiscriminated` 25-arm array (line 395-425), (4) the `providerSettingsSchema` shape spreads (line 427-459, with a **duplicated `...poeSchema.shape`** at lines 410 and 446 — a copy-paste bug), (5) `modelIdKeys` (line 477-488), (6) `modelIdKeysByProvider` (line 506-532), (7) `MODELS_BY_PROVIDER` (line 562-647), and in `providers/index.ts` (8) `getProviderDefaultModelId`'s 25-case switch (line 63-119) and (9) the `export * from "./<provider>.js"` barrel (line 1-26) plus the default-model import block (line 28-49). Plus the per-provider model-list file in `providers/<name>.ts` (10).
- **Criterion** — extensibility (10 change points to add one provider is the canonical "N spots" smell); human maintainability (the duplicated `poeSchema.shape` is live evidence the central list drifts); elegance (the sub-domain arrays `dynamicProviders`/`localProviders`/etc. at lines 37-101 are a _partial_ composition — the inline literals at 113-129 break the pattern).
- **Change points today vs. after** — Today: **~10 spots, 8 in one file**. After per-provider self-describing modules: a new `providers/<name>.ts` exports `{ name, schema, defaultModelId, models, modelIdKey, label, apiProtocol }` as one object and self-registers via a `defineProvider(…)` call appended to a `providerRegistry` array — **1 spot** (the new file), with the union derived as `type ProviderName = (typeof providerRegistry)[number]["name"]`.
- **Proposed refactor** —
    - Introduce a `ProviderDescriptor` interface in `provider-settings.ts` (or a new `provider-descriptor.ts`) bundling: `name`, `settingsSchema` (the per-provider zod schema), `defaultModelId`, `models`, `modelIdKey?`, `label`, `apiProtocol: "anthropic"|"openai"|((modelId?) => …)`, `kind: "dynamic"|"local"|"internal"|"custom"|"faux"|"typical"`.
    - Each `providers/<name>.ts` calls `defineProvider({ … })` and the registry collects them. `providerNames` becomes `providerRegistry.map(p => p.name) as const`. `providerSettingsSchemaDiscriminated` becomes `z.discriminatedUnion("apiProvider", providerRegistry.map(p => p.settingsSchema.merge(z.object({ apiProvider: z.literal(p.name) }))))`. `MODELS_BY_PROVIDER`, `modelIdKeysByProvider`, `getProviderDefaultModelId` all derive from the registry.
    - Complete the sub-domain composition: move the inline literals at lines 113-129 into a `typicalProviders` array (or per-provider self-registration) so `providerNames = [...dynamicProviders, ...localProviders, ...internalProviders, ...customProviders, ...fauxProviders, ...typicalProviders]`.
    - Fix the duplicated `...poeSchema.shape` (line 446) — likely a merge artifact.
- **Risk** — Medium. The zod discriminated union is already half-present (line 395); the migration is mostly mechanical aggregation. The `providers/<name>.ts` files already exist and own the model lists — this is about _collecting_ their metadata, not creating it. Interacts with the registry refactor as the **provider-side enabler**: `providerRegistry` in the app becomes a thin wrapper over the descriptor list.
- **Evidence** — 648 lines; 25 per-provider schemas; 25-arm discriminated union; duplicated spread at lines 410 & 446; 25-case switch in `providers/index.ts:63-119`.

#### 1.3 — `telemetry.ts` 543-line god-file mixing event schema with error classes and helpers

- **What** — [`telemetry.ts`](packages/types/src/telemetry.ts) mixes: the `TelemetryEventName` enum (line 20-77, ~50 events), the `rooCodeTelemetryEventSchema` discriminated union (line 164-238) which **re-enumerates** ~45 of those events in a giant `z.enum([...])` (line 166-208) plus 3 special-cased variants, property schemas (line 83-148), error classes (`ApiProviderError` line 450, `ConsecutiveMistakeError` line 500), error-extraction helpers (`getErrorMessage`, `extractMessageFromJsonPayload`, `shouldReportApiErrorToTelemetry`, `getErrorStatusCode` — lines 341-444), and type guards. The `z.enum([...])` re-listing is a **drift risk**: an event added to the enum but forgotten in the `z.enum` silently loses validation.
- **Criterion** — human maintainability (mixed concerns: event schema ≠ error classes ≠ error helpers); extensibility (double-declaration of events); low cognitive complexity (543 lines, 4 concerns).
- **Change points today vs. after** — Today, adding a telemetry event: (1) `TelemetryEventName` enum, (2) `z.enum([...])` re-enumeration in `rooCodeTelemetryEventSchema` (or a new special-case variant), (3) a `captureXxx()` wrapper in `TelemetryService.ts` — **3 files**. After schema-driven dispatch: (1) add one `z.object({ type: z.literal(NAME), properties: … })` variant — the `TelemetryEventName` enum and the wrapper method are both derived — **1 file**.
- **Proposed refactor** —
    - Split `telemetry.ts` into `telemetry/events.ts` (the enum + the discriminated union, with each variant's `properties` schema co-located), `telemetry/properties.ts` (the property schemas), `telemetry/errors.ts` (`ApiProviderError`, `ConsecutiveMistakeError`, type guards, extractors).
    - Keep `TelemetryEventName` as the **runtime** source of truth (it is a TS `enum`, i.e. a runtime object, used as a _value_ — `TelemetryEventName.X` — in 112 sites repo-wide, including inside the schema itself via `z.enum([...])`/`z.literal(...)`). Deriving the type _from_ the schema (`typeof schema.options[number]["type"]`) would delete the runtime namespace and break all 112 value-usages. Instead, derive the schema's name-list _from_ the enum: `z.enum(Object.values(TelemetryEventName) as [string, ...string[]])` for the catch-all arm, with per-variant `properties` schemas co-located via a `defineTelemetryEvent(name, propertiesSchema)` builder or a `Record<TelemetryEventName, ZodSchema>` map assembled into the discriminated union by iteration. This kills the drift risk (adding to the enum auto-appears in the schema) and co-locates each event's properties shape. _See Section G — this bullet was corrected; the original `typeof`-derivation line was the same category error the self-review flagged for providers._
    - In `packages/telemetry`, replace the ~30 `captureXxx()` wrappers with a single typed `capture(event: RooCodeTelemetryEvent)` whose `event.type` narrows the required `properties` (the schema already defines this). Keep a few ergonomic aliases only where the call-site payload shape is non-obvious.
- **Risk** — Low-medium. The schema is the source of truth; deriving the enum from it is a strict improvement. Call sites that pass `TelemetryEventName.X` as a literal still work. Interacts with the registry refactor by **removing a parallel change-point**: telemetry is not a registry target itself, but it's the third-most-touched string-keyed surface and demonstrates the same "add a thing, edit N files" pattern.
- **Evidence** — 543 lines; enum at 20-77; re-enumeration at 166-208; error classes at 450-513; helpers at 341-444.

#### 1.4 — `ToolName` is a flat monolithic array with no per-tool self-registration

- **What** — [`tool.ts:24-51`](packages/types/src/tool.ts:24) defines `toolNames` as a single 27-element inline array. There is no per-tool module ownership; the tool's param schema lives elsewhere (`tool-params.ts`), its handler lives in `src/`, its display name/group lives elsewhere. `ToolGroup` (line 7) is similarly a flat 5-element array.
- **Criterion** — extensibility (adding a tool edits the central array + the handler switch + the param schema + the UI row — the backend audit's tool-dispatch finding); elegance (the tool is scattered across 4+ files with no cohesion).
- **Change points today vs. after** — Today: central `toolNames` array + handler switch + param schema + UI — **4+ spots**. After per-tool descriptor modules (mirroring the proposed `ProviderDescriptor`): a new `tools/<name>.ts` exports `{ name, group, paramSchema, description, … }` and self-registers — **1 spot**, with `ToolName` derived as `typeof toolRegistry[number]["name"]`.
- **Proposed refactor** — Introduce `ToolDescriptor` (bundling `name`, `group`, `paramSchema` or a reference, `description`, `icon?`) in `tool.ts` or a new `tool-descriptor.ts`. Each native tool owns a descriptor module; `toolNames` derives from the registry. This is the types-side half of the backend's `nativeToolRegistry` proposal.
- **Risk** — Medium — touches the tool dispatch hot path. Do after the provider refactor (same pattern, lower blast radius first). Interacts with the registry refactor as the **tool-side enabler**.
- **Evidence** — `tool.ts:24-51` (27 literals), `tool.ts:7` (5 groups).

#### 1.5 — Schema generation is single-source-of-truth (good); published surface is well-gated (good)

- **What** — `generate:schema` ([`generate-roomodes-schema.ts`](packages/types/scripts/generate-roomodes-schema.ts)) generates `schemas/roomodes.json` from the zod schema in `src/roomodes-schema.ts` — single source of truth, no hand-maintained JSON. A sync test (`roomodes-schema-sync.spec.ts`) guards drift. The `npm:publish` setup uses `tsup` (`tsup.config.ts`) and the `exports` map in `package.json` gates the public surface to `./src/index.ts` (dev) / `./dist/index.cjs` (published) — internal types are not separately leaked because everything re-exports through `index.ts`.
- **Criterion** — maintainability (single-source schema is good); elegance (gated publish surface is good).
- **Verdict** — **No refactor needed.** This is a positive finding and a model for the other unions: the roomodes schema proves that "TS types → generated artifact" works in this repo. The same generator pattern could produce a published `webview-messages.json` or `provider-descriptors.json` if downstream tooling ever needs it.
- **Evidence** — `generate-roomodes-schema.ts:15-23`; `roomodes-schema-sync.spec.ts:19-20`; `package.json:6-15`.

---

### 2. packages/core (registry exemplar + platform-agnostic core)

#### 2.1 — `CustomToolRegistry` is a partial exemplar: generic spine + custom-tool-specific coupling

- **What** — [`custom-tool-registry.ts`](packages/core/src/custom-tools/custom-tool-registry.ts) (433 lines) has a clean generic spine: `tools = new Map<string, StoredCustomTool>()` (line 32), `register`/`unregister`/`get`/`has`/`list`/`getAll`/`size`/`clear` (lines 154-220). But ~60% of the file is custom-tool-specific: `loadFromDirectory`/`loadFromDirectories`/`loadFromDirectoryIfStale` (file-system discovery, lines 53-149), `import` (esbuild transpilation of `.ts`, lines 274-340), `copyEnvFiles` (lines 350-372), `validate` (Zod-shape detection, lines 391-429), `clearCache` (lines 241-263), `tsCache`/`cacheDir`/`nodePaths`/`extensionPath` fields. The `getAllSerialized` (line 204) is coupled to `serializeCustomTool`.
- **Criterion** — elegance (the generic registry spine is buried under tool-specific concerns); extensibility (the backend/frontend audits want to mirror this for `nativeToolRegistry`/`providerRegistry`/etc., but copying it imports esbuild + env-file logic that those registries don't need).
- **Change points today vs. after** — Today, creating a new registry means copy-pasting the spine and deleting the tool-specific bits (or subclassing and getting coupling you don't want). After extracting `Registry<K, V>`: a new registry is `new Registry<K, V>()` — **1 spot**, with optional `loadFromDirectories`/validation mixins only where needed.
- **Proposed refactor** —
    - Extract `packages/core/src/registry/Registry.ts` — a generic `class Registry<K extends string, V>` with `register(id, value)`, `unregister`, `get`, `has`, `list`, `getAll`, `size`, `clear`, and a `getAllSerialized` that takes a `serialize: (v: V) => S` callback (decoupling it from `serializeCustomTool`).
    - `CustomToolRegistry extends Registry<string, CustomToolDefinition>` and keeps only the esbuild/validation/fs-discovery logic.
    - Place it in `packages/core` (not `packages/types`) because it has runtime behavior; `types` stays types-only. The app's `nativeToolRegistry`/`providerRegistry`/`webviewMessageRegistry` extend or compose it.
- **Risk** — Low. Pure extraction; existing `CustomToolRegistry` API unchanged. Interacts with the registry refactor as its **foundation** — this is the exemplar the other two audits cite, and making it genuinely generalizable is the keystone.
- **Evidence** — 433 lines; generic spine at 32, 154-220; tool-specific at 53-149, 241-372, 391-429.

#### 2.2 — `message-utils/` internal inconsistency: `safeJsonParse` exists but siblings use raw `JSON.parse`

- **What** — [`safeJsonParse.ts`](packages/core/src/message-utils/safeJsonParse.ts) is a clean helper (typed, with context-label logging). `consolidateCommands.ts:65` uses it. But `consolidateApiRequests.ts:71,79` and `consolidateTokenUsage.ts:43,83` use raw `JSON.parse(...)` inside `try/catch` — the same defensive pattern, hand-rolled, without the context label. Within one 4-file subsystem, two files use the helper and two don't.
- **Criterion** — human maintainability (inconsistent within one folder); elegance (duplication of the try/parse/catch pattern).
- **Change points today vs. after** — N/A (consistency fix). After: all four files call `safeJsonParse` with a context label — 1 helper, 4 call sites, consistent error logging.
- **Proposed refactor** — Replace the raw `JSON.parse` try/catch in `consolidateApiRequests.ts` and `consolidateTokenUsage.ts` with `safeJsonParse` calls. Trivial.
- **Risk** — Negligible. **Obvious win.**
- **Evidence** — `consolidateApiRequests.ts:71,79`; `consolidateTokenUsage.ts:43,83`; contrast `consolidateCommands.ts:65`.

#### 2.3 — Singleton-as-default-export convention is implicit and inconsistent

- **What** — `custom-tool-registry.ts:432` exports `export const customToolRegistry = new CustomToolRegistry()`. `worktree/index.ts:12-13` exports `worktreeService` and `worktreeIncludeService` singletons. `TelemetryService` (in `packages/telemetry`) uses a static `createInstance`/`instance`/`hasInstance` lazy-singleton pattern. `CloudService` uses the same static pattern. Four packages, two different singleton conventions (eager default export vs. static lazy), no documented rule.
- **Criterion** — elegance (inconsistent pattern); human maintainability (no clear ownership of "when is a singleton OK").
- **Proposed refactor** — Pick one convention for packages-wide singletons and document it. Recommendation: the static lazy pattern (`createInstance`/`instance`/`hasInstance`/`resetInstance`) for services with async init (`TelemetryService`, `CloudService`); eager default export only for stateless registries (`customToolRegistry`). Add to `AGENTS.md`.
- **Risk** — Low. **Obvious win** (documentation + convention).
- **Evidence** — `custom-tool-registry.ts:432`; `worktree/index.ts:12-13`; `TelemetryService.ts:269-290`; `CloudService.ts:35,387-435`.

#### 2.4 — `task-history/`, `debug-log/` are cohesive (positive)

- **What** — `task-history/index.ts` is a single cohesive module (read/write task history JSON); `debug-log/index.ts` likewise. Both are small, single-concern, well-tested. No mixed concerns.
- **Verdict** — **No refactor needed.** Positive finding.

---

### 3. packages/ipc

#### 3.1 — IPC is the best-structured message package (positive exemplar)

- **What** — [`ipc.ts`](packages/types/src/ipc.ts) defines `IpcMessageType` (enum, line 10-16), `TaskCommandName` (enum, line 43-53), `taskCommandSchema = z.discriminatedUnion("commandName", [per-variant z.object with typed `data`])` (line 59-99), and `ipcMessageSchema = z.discriminatedUnion("type", […])` (line 107-125). Client and server both validate via `ipcMessageSchema.safeParse(data)` ([`ipc-server.ts:83`](packages/ipc/src/ipc-server.ts:83), [`ipc-client.ts:65`](packages/ipc/src/ipc-client.ts:65)) and dispatch via small switches keyed on the shared enum ([`ipc-server.ts:96-103`](packages/ipc/src/ipc-server.ts:96), [`ipc-client.ts:77-85`](packages/ipc/src/ipc-client.ts:77)). The two files are 138 and 148 lines respectively — small, symmetric, cohesive.
- **Criterion** — extensibility (adding an IPC message type: add to the enum + add a variant to the discriminated union + add a case to the dispatch switch = **3 spots, 2 in types** — and the payload is type-narrowed); elegance (discriminated union with per-variant `data`); human maintainability (client/server symmetric via shared schema).
- **Change points today vs. after** — Already good (3 spots). Could be reduced to 2 by deriving `IpcMessageType` from the schema options, same as proposed for telemetry. Not urgent.
- **Verdict** — **This is the model `WebviewMessage` and `ExtensionMessage` should follow.** No refactor needed here; cite it as the target pattern for finding 1.1.
- **Evidence** — `ipc.ts:10-16,43-53,59-99,107-125`; `ipc-server.ts:83,96-103`; `ipc-client.ts:65,77-85`.

#### 3.2 — Dispatch switches are small but not table-driven (minor)

- **What** — Both dispatch sites use `switch (payload.type) { case …: this.emit(…) }`. Adding a type means editing the switch. This is the same registry opportunity as the backend/frontend audits propose, but at IPC scale (3 parsed message variants — `Ack`, `TaskCommand`, `TaskEvent`; the `IpcMessageType` enum has 5 entries but `Connect`/`Disconnect` are connection-lifecycle, not schema-parsed) the switch is fine.
- **Verdict** — Not worth refactoring unless IPC grows significantly. **Obvious win to leave alone.**

---

### 4. packages/cloud

#### 4.1 — `CloudService` 504-line god-facade singleton with hand-rolled strategy selection

- **What** — [`CloudService.ts`](packages/cloud/src/CloudService.ts) (504 lines) is a singleton (`_instance`, `createInstance`, `instance`, `hasInstance`, `resetInstance` — lines 35, 387-435) that wires 6 sub-services (`authService`, `settingsService`, `telemetryClient`, `shareService`, `cloudAPI`, `retryQueue` — lines 50-84) via hand-rolled `if (env var) StaticX else CloudX` branching in `initialize()` (lines 122-147: `ROO_CODE_CLOUD_TOKEN` → `StaticTokenAuthService` else `WebAuthService`; `ROO_CODE_CLOUD_ORG_SETTINGS` → `StaticSettingsService` else `CloudSettingsService`). It then exposes ~40 pass-through delegating methods (lines 181-356), each calling `this.ensureInitialized()` then `this.<service>!.<method>(…)`.
- **Criterion** — low cognitive complexity (504 lines, ~40 one-line delegators, 1 large init); human maintainability (god-facade, no clear ownership — auth/settings/share/telemetry all behind one class); extensibility (adding a 3rd auth backend or a 3rd settings backend means editing `initialize()`'s if/else and adding more delegators).
- **Change points today vs. after** — Today, adding a 3rd auth backend: edit `initialize()`'s if/else (line 122-129), add delegators, maybe add a new env-var branch — **3+ spots in one file**. After a strategy-registry: register `AuthService` factories keyed by a `AuthProvider` discriminator (e.g. `"web"|"static-token"|"oauth-foo"`), select via `authProviderRegistry.resolve({ provider: config.authProvider })` — **1 spot** (the new factory module).
- **Proposed refactor** —
    - Extract `AuthService` strategy selection into a small registry/factory in `packages/cloud/src/auth/` (`WebAuthService`, `StaticTokenAuthService` each self-register a factory keyed by a `AuthProvider` literal). `CloudService.initialize()` resolves the provider from config/env.
    - Same for `SettingsService` (`CloudSettingsService`, `StaticSettingsService`).
    - Consider splitting `CloudService` into a thin `CloudService` (lifecycle + event relay) plus facade getters that return the sub-services directly, eliminating the ~40 delegators. Call sites already access `CloudService.instance.authService` — let them call `authService.login()` directly instead of `CloudService.instance.login()`. This shrinks the facade to ~150 lines.
- **Risk** — Medium. The facade is the public API; shrinking it changes call sites across `src/`. Do incrementally (introduce sub-service getters, migrate callers, then remove delegators). Interacts with the registry refactor by **demonstrating the strategy-selection pattern** that `providerRegistry` (for inference providers) can reuse.
- **Evidence** — 504 lines; 6 sub-services at 50-84; if/else strategy at 122-147; ~40 delegators at 181-356; singleton at 35,387-435.

#### 4.2 — `RetryQueue` couples a generic retry primitive to VS Code `ExtensionContext`

- **What** — [`retry-queue/RetryQueue.ts`](packages/cloud/src/retry-queue/RetryQueue.ts) (372 lines) implements a generic HTTP retry queue (enqueue, FIFO retry, 429 `Retry-After` parsing, 5xx retry, 4xx non-retry, max-retries, persistence, rate-limit pause/resume). The generic logic is ~300 lines. But it imports `ExtensionContext` from `vscode` (line 2) and uses `context.workspaceState.get/update` (lines 50, 67) for persistence — coupling a reusable primitive to the VS Code extension host. This blocks promotion to a shared util (e.g. `packages/core`) and makes it untestable without a VS Code mock.
- **Criterion** — elegance (leaky interface: persistence impl leaks into retry logic); extensibility (can't reuse outside cloud/extension); human maintainability (vscode shim needed to test).
- **Change points today vs. after** — Today: to reuse `RetryQueue` in `packages/ipc` or `packages/evals`, you'd have to mock `ExtensionContext`. After decoupling: inject a `PersistenceProvider` interface (`get<T>(key): T|undefined; set(key, value): Promise<void>`) — the cloud layer adapts `ExtensionContext.workspaceState` to it; other consumers pass an in-memory or filesystem adapter.
- **Proposed refactor** —
    - Define `interface PersistenceProvider { get<T>(key: string): T | undefined; set<T>(key: string, value: T): Promise<void> }` in `retry-queue/types.ts`.
    - `RetryQueue` constructor takes `persistence: PersistenceProvider` instead of `context: ExtensionContext`.
    - `packages/cloud` provides a `WorkspaceStatePersistenceAdapter` wrapping `ExtensionContext.workspaceState`.
    - Optionally move `RetryQueue` + `PersistenceProvider` to `packages/core` as a shared util.
- **Risk** — Low. The persistence surface is 2 method calls. Interacts with the registry refactor indirectly (decoupling primitives makes the whole package layer cleaner).
- **Evidence** — `RetryQueue.ts:2,9,50,67`; 372 lines; generic logic vs. VS Code coupling.

#### 4.3 — `bridge/types.ts` structural-interface pattern is the decoupling model (positive exemplar)

- **What** — [`bridge/types.ts:1-30`](packages/cloud/src/bridge/types.ts:1) defines `BridgeTask` and `BridgeProvider` as **structural interfaces** (not the concrete `Task`/`ClineProvider`), with an explicit comment: "Declared as a structural interface (not the concrete `Task`) so the command dispatcher is unit-testable with a plain mock and `@roo-code/cloud` stays free of a runtime dependency on the extension host `src/` tree." `dispatchBridgeCommand` (commandHandlers.ts:43-81) is a clean switch-on-`TaskBridgeCommandName` enum (a third dispatch surface beyond `IpcMessageType` and `WebviewMessage`), validated upstream by `taskBridgeCommandSchema.safeParse` (BridgeOrchestrator.ts:236).
- **Verdict** — **This is the decoupling pattern the registries should adopt.** The registries should key on structural interfaces (`ToolHandler`, `ProviderHandler`, `WebviewMessageHandler`) defined in `packages/types`, not concrete classes, so `packages/core` and the app can register implementations without circular deps. Positive finding — cite as the model.
- **Evidence** — `bridge/types.ts:1-30`; `commandHandlers.ts:43-81`; `BridgeOrchestrator.ts:236`.

#### 4.4 — `TelemetryClient` validates via the shared schema (positive)

- **What** — `packages/cloud/src/TelemetryClient.ts:178` calls `rooCodeTelemetryEventSchema.safeParse(payload)` before uploading — it reuses the types-package schema rather than re-defining a cloud-side event list. Good.
- **Verdict** — Positive. Contrast with the `TelemetryService` wrapper-method proliferation (finding 5.1) — the cloud client is already schema-driven; the wrapper boilerplate is only in `TelemetryService`.

---

### 5. packages/telemetry

#### 5.1 — `TelemetryService` ~30 hand-written `captureXxx()` wrappers re-encode schema-defined properties

- **What** — [`TelemetryService.ts`](packages/telemetry/src/TelemetryService.ts) (292 lines) has a generic `captureEvent(eventName, properties?)` (line 60-66) plus ~30 hand-written wrappers (`captureTaskCreated`, `captureTaskRestarted`, `captureTaskCompleted`, `captureConversationMessage`, `captureLlmCompletion`, `captureModeSwitch`, `captureToolUsage`, `captureCheckpointCreated/Diffed/Restored`, `captureContextCondensed`, `captureSlidingWindowTruncation`, `captureCodeActionUsed`, `capturePromptEnhanced`, `captureSchemaValidationError`, `captureDiffApplicationError`, `captureShellIntegrationError`, `captureConsecutiveMistakeError`, `captureTabShown`, `captureModeSettingChanged`, `captureCustomModeCreated`, `captureMarketplaceItemInstalled/Removed`, `captureTitleButtonClicked`, `captureTelemetrySettingsChanged` — lines 81-251). Each wrapper unpacks typed args and calls `captureEvent(EVENT_NAME, { … })`. The `rooCodeTelemetryEventSchema` already defines the required `properties` shape per event — the wrappers re-encode that knowledge in method signatures.
- **Criterion** — extensibility (3 change points per event: enum, schema re-enumeration, wrapper); elegance (boilerplate — the schema is the source of truth, the wrappers are a manual projection); low cognitive complexity (292 lines, ~30 near-identical methods).
- **Change points today vs. after** — Today: 3 files per event (see finding 1.3). After: expose `capture(event: RooCodeTelemetryEvent)` where `event.type` narrows `event.properties` via the discriminated schema — callers construct the typed event object; no wrapper needed. Keep ~3 ergonomic aliases only for the hottest call sites. **1 file per event.**
- **Proposed refactor** —
    - Add `capture(event: RooCodeTelemetryEvent): void` that fans out to `client.capture({ event: event.type, properties: event.properties })`.
    - Delete the ~30 wrappers; migrate call sites to construct `{ type: TelemetryEventName.X, properties: { … } }` (the schema validates).
    - Keep `captureException` (different shape) and maybe `captureLlmCompletion` (very hot, non-obvious payload) as aliases.
- **Risk** — Medium — touches many call sites in `src/`. Do after the `telemetry.ts` split (finding 1.3) so the schema is the clean source of truth. **Pairs with finding 1.3.**
- **Evidence** — 292 lines; wrappers at 81-251; generic at 60-66; singleton at 269-290.

#### 5.2 — `TelemetryService` singleton with no `resetInstance` (testability gap)

- **What** — `TelemetryService` has `createInstance`/`instance`/`hasInstance` (lines 269-290) but **no `resetInstance`** — unlike `CloudService` which has `resetInstance` (CloudService.ts:430-435). This makes test isolation harder (can't tear down the singleton between tests).
- **Criterion** — human maintainability (inconsistent singleton lifecycle across packages); testability.
- **Proposed refactor** — Add `static resetInstance(): void` mirroring `CloudService`. Trivial. **Obvious win.**
- **Evidence** — `TelemetryService.ts:269-290` (no reset); contrast `CloudService.ts:430-435`.

---

### 6. packages/evals (scan)

#### 6.1 — Exercises are directory-driven (positive exemplar for table-driven design)

- **What** — [`exercises/index.ts`](packages/evals/src/exercises/index.ts) discovers exercises by filesystem scan (`listDirectories`, line 13-22; `getExercisesForLanguage`, line 24-25). The only hardcoded list is `exerciseLanguages` (line 9, 5 entries). Adding a scenario = drop a directory (**0 code changes**); adding a language = 1 array edit.
- **Verdict** — **This is the data-driven pattern the rest of the codebase should emulate.** Contrast with the provider/tool/message central-list pattern. Positive finding — cite as the model for "add a thing = 0-1 change points".
- **Evidence** — `exercises/index.ts:9,13-25`.

#### 6.2 — `cli/` has 9 files; quick scan shows cohesion

- **What** — `cli/` (`runEvals`, `runTaskInCli`, `runTaskInVscode`, `runCi`, `runUnitTest`, `processTask`, `messageLogDeduper`, `redis`, `utils`, `types`) — each is a CLI entry point or helper. `runTaskInVscode.ts:153` uses raw `JSON.parse` in try/catch (could use `safeJsonParse` from core, but cross-package import may not be wired — minor). Cohesion is acceptable; no god-file. Low priority.
- **Verdict** — No refactor needed for this audit's scope.

---

### 7. packages/build (scan)

#### 7.1 — `esbuild.ts` sync busy-wait sleep and Windows `attrib` exec (minor)

- **What** — [`esbuild.ts:73-77`](packages/build/src/esbuild.ts:73) uses a `while (Date.now() - start < delay) { /* busy wait */ }` synchronous sleep to back off `rmDir` retries — blocks the event loop. Line 50 runs `execSync("attrib -R …")` on Windows. `rmDir` (line 26-80) is a 55-line retry-with-backoff function that could use `fs.rmSync`'s built-in `maxRetries`/`retryDelay` (which line 55 already uses as a fallback).
- **Criterion** — elegance (hand-rolled retry where a stdlib option exists); low cognitive complexity (55-line function).
- **Proposed refactor** — Replace `rmDir`'s custom retry loop with `fs.rmSync(dirPath, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })` on all platforms; drop the busy-wait. Keep the Windows `attrib` only if a real Windows-specific EPERM case demands it.
- **Risk** — Low (build-time only). **Minor / optional.**
- **Evidence** — `esbuild.ts:26-80,73-77,50`.

---

### 8. packages/vscode-shim (scan)

#### 8.1 — Well-partitioned, comprehensive (positive)

- **What** — `src/` is cleanly partitioned: `classes/` (Uri, Position, Range, Selection, EventEmitter, …), `api/` (WindowAPI, WorkspaceAPI, CommandsAPI, …), `interfaces/` (document, editor, extension-host, terminal, webview, workspace), `context/` (ExtensionContext), `storage/` (Memento, SecretStorage), `utils/` (logger, machine-id, paths). `index.ts` is a 116-line re-export barrel (appropriate for a shim). Each class has a co-located test.
- **Verdict** — **No refactor needed.** Positive finding. The shim's `interfaces/extension-host.ts` is the structural surface that lets `packages/cloud` and `packages/core` compile against `vscode` without the real extension host — it's the same decoupling pattern as `bridge/types.ts`.
- **Evidence** — directory structure; `index.ts:12-86`; co-located tests.

---

### 9. packages/config-eslint + config-typescript (check)

#### 9.1 — Shared configs are actually shared consistently (positive)

- **What** — `config-eslint/base.js` is a clean flat-config array (js recommended + prettier + tseslint recommended + turbo plugin + only-warn + unused-vars rule). Every package's `eslint.config.mjs` imports `config` from `@roo-code/config-eslint/base` and spreads it: `core` uses `[...config]` verbatim ([`core/eslint.config.mjs:4`](packages/core/eslint.config.mjs:4)); `cloud` extends with a justified `.cjs`/CommonJS carve-out (lines 7-19). `config-typescript` provides `base.json`/`cjs.json`/`nextjs.json`/`vscode-library.json` composable bases. No hand-tweaked per-package rule divergence detected.
- **Verdict** — **No refactor needed.** This is the correct way to share lint/ts config. Positive finding.
- **Evidence** — `config-eslint/base.js:12-44`; `core/eslint.config.mjs:1-4`; `cloud/eslint.config.mjs:1-20`.

---

### 10. Cross-package concerns

#### 10.1 — Dependency direction is clean (positive — unblocks the registry refactor)

- **What** — Verified via regex search: `packages/types/src` has **zero** imports from `src/`, `webview-ui/`, or any sibling `@roo-code/*` package (it imports only `zod`, `ai-sdk-provider-poe`, and its own `./providers/*`). No `packages/*` file imports from `../../../src/` or `../../../webview-ui/`. `packages/core` depends only on `@roo-code/types` (+ esbuild/execa/ignore/openai/zod). `packages/ipc`/`packages/cloud`/`packages/telemetry` depend on `@roo-code/types` (cloud also on `vscode-shim` via the `vscode` import). The dependency graph is a clean DAG: `types` ← `core`/`ipc`/`cloud`/`telemetry` ← `src`/`webview-ui`.
- **Verdict** — **This is the green light for the cross-cutting registry refactor.** The shared contract layer (`types`) is a leaf; registries can live in `core` (runtime) keying on unions in `types` (compile-time) with no circular deps. Positive finding.
- **Evidence** — search returned 0 matches for app-code imports in `packages/`; `package.json` deps: `types` has no `@roo-code/*` deps, `core` has only `@roo-code/types`.

#### 10.2 — `safeJsonParse` duplication / inconsistent raw `JSON.parse` across packages

- **What** — `safeJsonParse` lives in `packages/core/src/message-utils/safeJsonParse.ts` and is re-exported via `@roo-code/core`. But raw `JSON.parse` in `try/catch` is repeated in: `packages/core/src/task-history/index.ts:51`, `packages/types/src/telemetry.ts:366`, `packages/vscode-shim/src/storage/Memento.ts:47`, `packages/vscode-shim/src/storage/SecretStorage.ts:58`, `packages/vscode-shim/src/context/ExtensionContext.ts:125`, `packages/cloud/src/WebAuthService.ts:223`, `packages/cloud/src/StaticSettingsService.ts:24`, `packages/evals/src/cli/runTaskInVscode.ts:153`. Some of these (vscode-shim storage) legitimately can't import `core` (shim should be lower-level than core), but `task-history` (in core itself), `cloud`, and `evals` could use the shared helper.
- **Criterion** — human maintainability (inconsistent error handling); elegance (duplication).
- **Proposed refactor** — For `core`-internal consumers (`task-history`), use `safeJsonParse`. For `cloud`/`evals`, import from `@roo-code/core`. For `vscode-shim`, either keep the local try/catch (shim must stay leaf-ish) or promote a minimal `safeJsonParse` to a new tiny `@roo-code/util` package if the duplication bugs. Low priority.
- **Risk** — Low. **Minor / optional.**
- **Evidence** — search results across 8 files.

#### 10.3 — Vitest config duplicated across 5+ packages

- **What** — `packages/core/vitest.config.ts`, `packages/types/vitest.config.ts`, `packages/build/vitest.config.ts`, `packages/vscode-shim/vitest.config.ts` are near-identical (`globals: true`, `watch: false`, often `environment: "node"`). `packages/cloud` adds a `vscode` alias. There is no shared vitest preset; each package reinvents the same 8-line config.
- **Criterion** — human maintainability (boilerplate duplication); elegance (no shared preset).
- **Proposed refactor** — Add a `defineVitestConfig` helper (or a `@roo-code/config-vitest` package) that takes optional `{ environment, aliases }` and returns the standard config. Each package's `vitest.config.ts` becomes a 1-3 line call.
- **Risk** — Low. **Obvious win** (small, mechanical). Low priority but cheap.
- **Evidence** — `core/vitest.config.ts:1-9`; `types/vitest.config.ts:1-8`; `cloud/vitest.config.ts:1-14` (diverges with alias).

## Prioritized refactor backlog

| Priority | Finding                                                                                                    | Package              | Criterion                           | Effort | Risk                       | Change-points (before→after)             |
| -------- | ---------------------------------------------------------------------------------------------------------- | -------------------- | ----------------------------------- | ------ | -------------------------- | ---------------------------------------- |
| **P0**   | 1.1 Split `vscode-extension-host.ts` 920-line god-file into per-domain discriminated-union message modules | types                | cognitive complexity, extensibility | L      | High (mechanical but wide) | 5→3 per webview message                  |
| **P0**   | 1.2 Per-provider self-describing `ProviderDescriptor` modules + registry-derived `ProviderName`            | types                | extensibility, maintainability      | L      | Medium                     | ~10→1 per provider                       |
| **P1**   | 2.1 Extract generic `Registry<K,V>` from `CustomToolRegistry` into `packages/core`                         | core                 | elegance, extensibility             | M      | Low                        | new registry: copy-paste→1 instantiation |
| **P1**   | 1.3 Split `telemetry.ts` 543-line god-file; derive `TelemetryEventName` from schema                        | types                | maintainability, extensibility      | M      | Low-Medium                 | 3→1 per event (with 5.1)                 |
| **P1**   | 5.1 Replace ~30 `captureXxx()` wrappers with schema-driven `capture(event)`                                | telemetry            | extensibility, elegance             | M      | Medium (many call sites)   | 3→1 per event (with 1.3)                 |
| **P2**   | 1.4 Per-tool `ToolDescriptor` modules + registry-derived `ToolName`                                        | types                | extensibility                       | M      | Medium (dispatch hot path) | 4+→1 per tool                            |
| **P2**   | 4.1 Extract `CloudService` auth/settings strategy selection into registries; shrink the facade             | cloud                | maintainability, extensibility      | M      | Medium (call sites)        | 3+→1 per auth/settings backend           |
| **P2**   | 4.2 Decouple `RetryQueue` from `ExtensionContext` via `PersistenceProvider` interface                      | cloud                | elegance, extensibility             | S      | Low                        | reusable outside cloud                   |
| **P3**   | 2.2 Use `safeJsonParse` in `consolidateApiRequests.ts` + `consolidateTokenUsage.ts`                        | core                 | maintainability, elegance           | S      | Negligible                 | **obvious win**                          |
| **P3**   | 5.2 Add `TelemetryService.resetInstance()`                                                                 | telemetry            | maintainability, testability        | S      | Negligible                 | **obvious win**                          |
| **P3**   | 10.3 Shared vitest config preset                                                                           | cross                | maintainability                     | S      | Low                        | **obvious win**                          |
| **P3**   | 2.3 Document packages-wide singleton convention                                                            | core/telemetry/cloud | elegance                            | S      | Negligible                 | **obvious win**                          |
| **P4**   | 10.2 Consolidate raw `JSON.parse` try/catch on `safeJsonParse`                                             | cross                | maintainability                     | S      | Low                        | minor                                    |
| **P4**   | 7.1 Replace `build/esbuild.ts` busy-wait + custom retry with `fs.rmSync` options                           | build                | elegance                            | S      | Low                        | minor / optional                         |

## Patterns to adopt packages-wide

- **Discriminated-union-with-per-variant-`data` for every message/command surface — but pick the mechanism by boundary.** `ipc.ts` (`ipcMessageSchema = z.discriminatedUnion("type", [per-variant z.object])`) and `taskCommandSchema` are the in-repo zod exemplar — for surfaces that cross a trust/persistence boundary (IPC, CLI, disk config, [`roomodes.json`](schemas/roomodes.json)). `WebviewMessage`/`ExtensionMessage` should follow the _shape_ (per-variant `data`, compile-time payload narrowing, "add a message" = one variant addition) but via **plain TS discriminated unions**, not zod — the webview↔extension seam is same-process typed and a ~170-arm `z.discriminatedUnion` is a type-instantiation-depth/hover-latency hazard. Reserve zod for trust/persistence boundaries; use TS unions for in-process typed contracts. _(See Section B Correction 1 and Section G §2c for the decision rule.)_
- **Self-describing descriptor modules + a runtime source-of-truth the union is derived from.** The `provider-settings.ts:37-101` sub-domain arrays (`dynamicProviders`, `localProviders`, …) are a _partial_ proof; complete it for providers, tools, telemetry events, and (eventually) webview messages. Each extensible thing owns one module exporting a descriptor; the union is `typeof registry[number]["name"]`. **Two regimes, never conflated (Section B Correction 2):** closed sets wanting compile-time exhaustiveness (native `ProviderName`/`ToolName`/`TelemetryEventName`) use a **static `const` tuple** as the runtime source of truth and derive the union/type _and_ the schema name-list from it — change-points drop to 2 (new descriptor + one append line), not 1. Open sets discovered at runtime (custom tools, MCP tools) use a runtime registry with no static-union derivation. **Descriptors must be side-effect-free data — no top-level registration side-effects at import time** (Section G §2f); runtime registration into a map is a separate explicit consumer step, not a descriptor responsibility. The evals `exercises/` directory-driven discovery is the data-driven extreme of the same principle.
- **Structural interfaces for cross-package decoupling.** `cloud/bridge/types.ts` (`BridgeTask`, `BridgeProvider`) proves that `packages/cloud` can call into the app's `Task`/`ClineProvider` without a runtime dep on `src/`. The registries should key on structural `ToolHandler`/`ProviderHandler`/`WebviewMessageHandler` interfaces in `packages/types`, with implementations registered in the app — no circular deps.
- **Generic `Registry<K, V>` in `packages/core` as the runtime base.** Extract the `Map`-spine from `CustomToolRegistry` so every registry (`nativeToolRegistry`, `providerRegistry`, `webviewMessageRegistry`, `providerSettingsPanelRegistry`, `settingsSectionRegistry`, `toolRowRegistry`, auth/settings strategy registries) composes it. Keep package-specific concerns (esbuild, validation, fs-discovery) as mixins or subclasses, not in the base.

## Cross-reference: how packages findings unblock the backend + frontend registry refactor

| Packages finding                                                                                                                                                                             | Unblocks (backend/frontend finding)                                                                         | How                                                                                                                                                                                                                                                                                                                                                                                                                             |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.1 Split `vscode-extension-host.ts` into per-domain discriminated unions                                                                                                                    | Frontend `webviewMessageRegistry` + backend webview-message dispatch                                        | The registry keys on `WebviewMessage["type"]`; a per-domain discriminated union means each domain owns its variants instead of all routes editing one 920-line file. Payload narrowing comes free.                                                                                                                                                                                                                              |
| 1.2 `ProviderDescriptor` + registry-derived `ProviderName`                                                                                                                                   | Backend `providerRegistry` (provider dispatch) + frontend `providerSettingsPanelRegistry`                   | Today both sides maintain parallel switch ladders keyed on a monolithic `ProviderName`; a descriptor registry makes both sides iterate `providerRegistry` instead. Adding a provider = 1 descriptor module.                                                                                                                                                                                                                     |
| 1.4 `ToolDescriptor` + registry-derived `ToolName`                                                                                                                                           | Backend `nativeToolRegistry` (tool dispatch) + frontend `toolRowRegistry`                                   | Same as 1.2 for tools; the backend tool switch and the frontend tool-row rendering both derive from the registry.                                                                                                                                                                                                                                                                                                               |
| 2.1 Generic `Registry<K,V>` in `packages/core`                                                                                                                                               | All six registries on both sides                                                                            | Gives every registry a common `has`/`get`/`getAll`/`register` spine without re-implementing the `CustomToolRegistry` esbuild coupling.                                                                                                                                                                                                                                                                                          |
| 1.3 + 5.1 Telemetry: runtime `TelemetryEventName` enum as source of truth; schema name-list derived _from_ it; per-variant `properties` co-located via descriptors; partial wrapper collapse | Removes a parallel change-points case (telemetry) that would otherwise remain after the registry refactor   | Same regime as 1.2/1.4 (closed set, static source-of-truth + co-located descriptors), **not** an exception to it. The original "derive enum from schema via `typeof`" prescription was the same category error as 1.2 — corrected in Section G §G.1. Demonstrates the "2 spots per addition" end state (new descriptor + one append) for a string-keyed surface that is _not_ a registry candidate but exhibits the same smell. |
| 4.3 `bridge/types.ts` structural interfaces                                                                                                                                                  | Registry handler interfaces (`ToolHandler`, `ProviderHandler`, `WebviewMessageHandler`) in `packages/types` | Proves the app can register concrete implementations against `packages/types`-defined structural interfaces with no `src/`→`packages/*` circular dep. This is the decoupling contract the registries need.                                                                                                                                                                                                                      |
| 10.1 Clean dependency DAG (`types` is a leaf)                                                                                                                                                | The entire cross-cutting registry refactor                                                                  | Confirms registries can live in `core` (runtime) keying on unions in `types` (compile-time) with the app depending on both — no direction violations to fix first. Green light.                                                                                                                                                                                                                                                 |

---

## Assessment & Review (2026-07-12)

> Status: **Verified against source; two material corrections required before execution.**
> Reviewer spot-checked every claim against the live codebase.

### A. Verification results (every spot-check passed)

| Finding   | Claim                                                                                                        | Verified     | Notes                                                                                                                                   |
| --------- | ------------------------------------------------------------------------------------------------------------ | ------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| 1.1       | `vscode-extension-host.ts` 920 lines, 3 flat-bag unions, `payload?: any` w/ eslint-disable                   | ✅ exact     | `ExtensionMessage` L31, `WebviewMessage` L456, `WebViewMessagePayload` L783, `payload?: any` L112                                       |
| 1.2       | `provider-settings.ts` 648 lines, inline literals after composed sub-arrays, duplicated `...poeSchema.shape` | ✅ exact     | Inline literals L113–129; duplicate spread at **L443 & L446** (doc said L410 & L446 — bug real, one line ref off)                       |
| 1.3       | `telemetry.ts` 543 lines, enum re-enumerated in `z.enum([...])` (drift risk)                                 | ✅ exact     | Enum L20–77, re-enumeration L166–208, error classes L450+                                                                               |
| 5.1       | `TelemetryService.ts` 292 lines, generic `captureEvent` L60 + ~30 wrappers from L81                          | ✅ exact     | Wrapper pattern confirmed                                                                                                               |
| 2.1       | `custom-tool-registry.ts` 433 lines, `Map` spine L32                                                         | ✅ exact     | Generic spine + esbuild/validation/fs coupling as described                                                                             |
| 4.1       | `CloudService.ts` 504 lines, if/else strategy L122–147                                                       | ✅ exact     | `ROO_CODE_CLOUD_TOKEN` / `ROO_CODE_CLOUD_ORG_SETTINGS` branching confirmed                                                              |
| 4.2       | `RetryQueue.ts` imports `ExtensionContext` L2, uses `workspaceState` L50/L67                                 | ✅ exact     | Coupling real, blocks reuse                                                                                                             |
| 1.4       | `tool.ts` flat `toolNames` array                                                                             | ✅ confirmed | 26 entries (doc said 27 — trivial count error)                                                                                          |
| 10.1      | `types` is a verified leaf (zero app/sibling imports)                                                        | ✅ exact     | Regex search returned 0 matches — DAG clean                                                                                             |
| Exemplars | `ipc.ts` discriminated union, `bridge/types.ts` structural interface                                         | ✅ exact     | Cited accurately as target patterns                                                                                                     |
| Cross-ref | `getProviderDefaultModelId` 25-case switch                                                                   | ✅ exact     | `providers/index.ts:63`                                                                                                                 |
| 2.2       | `safeJsonParse` inconsistency                                                                                | ✅ exact     | Raw `JSON.parse` in `consolidateApiRequests.ts` (L71,79) & `consolidateTokenUsage.ts` (L43,83); helper used in `consolidateCommands.ts` |

**Diagnoses are accurate.** The dependency-DAG green light stands, the flat-bag anti-pattern is real, the `poeSchema` duplicate is real, the telemetry double-declaration drift risk is real, and the cited exemplars (`ipc.ts`, `bridge/types.ts`, `exercises/`) are correct models. The P3 "obvious wins" stand unchanged.

### B. Two material corrections (mechanism + change-point math)

The two P0 prescriptions as written are mechanically incoherent. The diagnoses survive; the prescriptions need correction.

#### Correction 1 — Finding 1.1: zod is the wrong mechanism at ~170 variants

The doc prescribes "mirror `ipc.ts`'s `z.discriminatedUnion`" for `WebviewMessage`. That is a category error on three axes:

1. **Scale regime.** `ipcMessageSchema` has **3** schema variants (`Ack`, `TaskCommand`, `TaskEvent` — the 5-entry `IpcMessageType` enum includes `Connect`/`Disconnect` which are connection-lifecycle, not schema-parsed). `WebviewMessage` has ~170. At ~170 arms, `z.discriminatedUnion` hits TypeScript instantiation-depth / union-size pressure — hover, completion, and go-to-def latency degrade, and `Type instantiation is excessively deep` errors become a real risk. A 3-variant exemplar does not extrapolate to a 170-variant target. (This strengthens, not weakens, the argument — the gap is wider than first stated.)

2. **Trust boundary.** IPC crosses a process/socket boundary — `safeParse` there is justified (untrusted-ish input). `WebviewMessage` is the extension's own webview posting to its own host via same-origin `postMessage` inside VS Code — not an untrusted boundary. Introducing `safeParse` on every webview message is net-new runtime cost (none exists today — dispatch is a bare `switch (message.type)`) buying ~zero security. The audit's own exemplar rationale does not transfer.

3. **Mechanism vs. structure are separable.** The per-domain split (each domain owns its variants) is unconditionally good and captures ~90% of the claimed benefit. That win is available with **plain TS discriminated unions** — `type WorktreeWebviewMessage = { type: "worktreeList"; … } | …`, composed as `type WebviewMessage = WorktreeWebviewMessage | McpWebviewMessage | …`. Plain TS unions give compile-time payload narrowing for free, with no runtime cost and far lower type-checker load than a 170-arm zod union.

**Decision rule the audit is missing:** zod schemas belong at _serialization/trust boundaries_ (IPC, CLI args, network, disk-config round-trip, the generated+consumed-back `roomodes.json` — which is why 1.5 is zod). Plain TS discriminated unions belong at _in-process typed contracts_ (webview↔extension, internal module seams). **Corrected prescription for 1.1: plain TS per-domain discriminated unions, not zod. Reserve zod for variants that actually cross a boundary.** Change-point claim (5→3) still holds, via TS unions. Risk drops from High → Medium (no runtime validation introduction, lower type-checker load). Use the superset-then-narrow migration: first make every variant's fields a superset of all currently-optional fields (behavior-preserving), then narrow per-variant in a follow-up — avoids one mega-PR breaking compilation across `src/` and `webview-ui/` simultaneously.

#### Correction 2 — Finding 1.2 (and 1.4): "~10 → 1" conflates two incompatible mechanisms

The doc's sentence — _"self-registers via a `defineProvider(…)` call appended to a `providerRegistry` array — **1 spot**, with the union derived as `type ProviderName = (typeof providerRegistry)[number]["name"]`"_ — is internally contradictory. It fuses two regimes that cannot both hold:

- **Static-derivation regime.** `typeof providerRegistry[number]["name"]` yields a literal union _only_ if `providerRegistry` is declared as a `const` tuple in one file (`const providerRegistry = [anthropicDescriptor, …] as const`) with each descriptor's `name` narrowed to a literal (via a `<N extends string>` generic on `defineProvider`). That requires importing every descriptor and listing it in the tuple. **Change points: ~10 → 2** (new descriptor module + one import-and-append line). Still a huge win; not 1.
- **Runtime self-registration regime.** `defineProvider(…)` appending to a module-level array at import time (side-effect registration, as the doc describes) is a _runtime_ operation. `typeof` is compile-time. A runtime-mutated array is invisible to `typeof` — you cannot derive a literal union from it. To get the type you'd need codegen (like the existing `generate:schema` script) or a hand-maintained `ProviderName` — the latter reintroduces the exact drift the audit wants to kill.

The doc's fallback line `providerNames = providerRegistry.map(p => p.name) as const` is doubly wrong: `.map()` widens to `string[]` (the map signature infers `U` to `string`, the declared property type, not the literal), and `as const` on a `.map()` _result_ is an assertion that doesn't retroactively narrow element literals — it produces `readonly string[]`, not a tuple of literals. It does not compile to the intended type.

**The keystone exemplar already lives in the runtime regime and exposes the conflation.** `customToolRegistry` (finding 2.1) is a _runtime_ registry (eager `new` + `loadFromDirectory` discovery); custom tool names are a runtime string set, **not** derived via `typeof`. So the audit's own exemplar operates in the runtime regime, while its provider/tool prescription assumes the static-derivation regime. Different problems, different correct answers, flattened into one pattern that works cleanly for neither.

**Corrected prescription — split by open/closed set:**

- **Closed sets wanting compile-time exhaustiveness** (native `ProviderName`, `ToolName` — the dispatch `switch` should be exhaustive): **static const-tuple registry, ~10 → 2 change points.** The 2nd point is a trivial one-line append; accept it as the cost of real static exhaustiveness checking.
- **Open sets discovered at runtime** (custom tools, MCP tools): **runtime registry, 1 change point, no static union derivation.** Derive names via codegen if a literal type is needed, or accept `string` and validate at the boundary.

Apply the same correction to finding 1.4 (native tools → static tuple, ~4 → 2; custom tools already runtime, stay runtime).

### C. Other gaps to address before execution

1. **`providerSettingsSchema` (the non-discriminated shape-spread union, L427–459) is a deliberate escape hatch, not just duplication.** It exists because settings can be partially configured (a profile may omit `apiProvider`). The per-provider descriptor refactor must preserve this "any-provider partial config" shape — deriving it purely from `providerSettingsSchemaDiscriminated` won't work (a discriminated union requires the discriminator present). The `ProviderDescriptor` proposal should explicitly model a `partialSettingsSchema` (all per-provider schemas made optional/merged) as a derived artifact, or note that the flat schema stays as a computed `z.object({...allDescriptorsSchemasMerged})`.

2. **5.1's "delete the ~30 wrappers" is more disruptive than framed.** Wrappers encode ergonomic argument unpacking; ~half have non-trivial payload shapes (checkpoint, condense, sliding-window). Keep wrappers that perform non-trivial argument shaping; delete only the pure one-line pass-throughs. This preserves the "schema = single source of truth" win without churning every telemetry call site across `src/`.

3. **Missing regression guard for the schema-generation pipeline.** 1.5 praises `generate:schema`, but deriving `ProviderName`/`ToolName`/`TelemetryEventName` from registries/schemas means any generated artifact that currently lists providers/tools (e.g. `schemas/roomodes.json`) must have its generator updated to consume the new registry. No finding flags this. Add a verification step per refactor: "regenerate all schema artifacts and run sync tests (`roomodes-schema-sync.spec.ts`)."

4. **Minor inaccuracies to correct in the doc itself:**
    - 1.2: duplicate `poeSchema.shape` is at **L443 & L446**, not L410 & L446.
    - 1.4: `toolNames` has **26** entries, not 27.
    - 5.1: recount the "~30 wrappers" against the current enum before quoting in a PR.

### D. Net effect on the backlog

| Finding               | Original                                                         | Correction                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.1 (P0)              | zod discriminated union per domain                               | **Plain TS per-domain discriminated unions; zod only at trust boundaries.** Risk High → Medium.                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 1.2 (P0)              | ~10 → 1 via `defineProvider` self-register + `typeof` derivation | **~10 → 2 via static const-tuple registry.** Drop the self-register-and-derive conflation. Fix `poeSchema` duplicate (L443 & L446) as freebie.                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 1.4 (P2)              | 4+ → 1 via registry-derived `ToolName`                           | **~4 → 2 via static const tuple (native); custom/MCP tools stay runtime registry.**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 2.1 (P1, keystone)    | generic `Registry<K,V>` as runtime base                          | Unchanged, but note: it is a **runtime** base only — it does not and should not also be the compile-time union source. Static union derivation is a separate file-level concern.                                                                                                                                                                                                                                                                                                                                                                                            |
| 1.3 + 5.1 (telemetry) | split + collapse wrappers                                        | **AFFECTED — see Section G, Correction 3.** Telemetry does cross to an external sink (zod justified), but the original "derive enum from schema via `typeof`" prescription is the same category error flagged for providers in Correction 2. `TelemetryEventName` is a runtime `enum` used as a _value_ in 112 sites (incl. inside the schema via `z.enum`/`z.literal`). Corrected direction: keep the enum as runtime source of truth, derive the schema's name-list _from_ it, co-locate per-variant `properties` via descriptors. Keep non-trivial-arg-shaping wrappers. |
| 4.1, 4.2, P3 wins     | —                                                                | Unchanged.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

### E. Corrected execution phasing

The backlog implies an order via priority but doesn't state the dependency chain. Recommended:

- **Phase 0 (foundation):** Finding 2.1 — extract generic `Registry<K,V>`. Lowest risk. Unblocks the _runtime_ registries (app-side provider/tool/message dispatch). It does **not** unblock the type-level splits (1.1, and the type-derivation halves of 1.2/1.3/1.4) — those are independent plain-TS refactors in `packages/types` and can proceed in parallel. Runtime-only.
- **Phase 1:** Finding 1.2 — provider descriptors via **static const tuple** (proves the descriptor pattern at moderate blast radius). Fix `poeSchema` duplicate. Regenerate `roomodes.json` + run sync test.
- **Phase 2:** Findings 1.3 + 5.1 — telemetry split + partial wrapper collapse (paired, schema-first).
- **Phase 3:** Finding 1.1 — message union split via **plain TS per-domain unions** (highest blast radius; do last among structural refactors; superset-then-narrow migration).
- **Phase 4:** Finding 1.4 — tool descriptors via static const tuple (pattern now proven).
- **Continuous:** P3 "obvious wins" (2.2 `safeJsonParse`, 5.2 `resetInstance`, 10.3 vitest preset, 2.3 singleton convention) — pick off any time, bundle into unrelated PRs.

### F. Overall verdict

**Accept and execute with the corrections in Sections B and G.** The audit is evidence-driven, falsifiable (12/12 spot-checks passed), correctly diagnoses the structural-vs-directional distinction, and cites real in-repo exemplars. The diagnoses are sound; three _prescriptions_ need the mechanism corrections in Sections B and G before they're executable. With those applied, plus the smaller fixes in Section G §2, the plan is sound. Green-light execution starting with 2.1.

---

## Independent critical review (2026-07-12) — Section G

> Reviewer re-verified every load-bearing claim against live source. **The self-review's two corrections (B) stand. This section adds a third correction the self-review missed, plus six smaller fixes.** The self-review exempted telemetry from its own regime-split critique; that exemption is wrong and is corrected below.

### G.1 — Correction 3: telemetry is a third instance of Correction 2, not an exception to it

The self-review's Section D row for `1.3 + 5.1` originally said telemetry "stands unaffected" because "the schema is already zod, and deriving the enum from the zod schema's `.options` is the static-derivation regime done right." Finding 1.3's prescription said: "Derive `TelemetryEventName` from the schema: `type TelemetryEventName = (typeof rooCodeTelemetryEventSchema.options)[number]["type"]`."

**This is the exact category error the self-review accuses finding 1.2 of in Correction 2.** Verified against source:

- [`TelemetryEventName`](packages/types/src/telemetry.ts:20) is a TypeScript `enum` — a **runtime object** (`{ TASK_CREATED: "TaskCreated", … }`), not a type alias.
- A repo-wide search returns **112 usages of `TelemetryEventName.X` as a value** (not a type), including:
    - inside the schema itself: [`z.enum([TelemetryEventName.TASK_CREATED, …])`](packages/types/src/telemetry.ts:166) and [`z.literal(TelemetryEventName.TELEMETRY_SETTINGS_CHANGED)`](packages/types/src/telemetry.ts:212) — `z.enum`/`z.literal` take runtime string values, not types;
    - runtime filter lists: [`events: [TelemetryEventName.TASK_MESSAGE, TelemetryEventName.LLM_COMPLETION]`](packages/telemetry/src/PostHogTelemetryClient.ts:34), [`events: [TelemetryEventName.TASK_CONVERSATION_MESSAGE]`](packages/cloud/src/TelemetryClient.ts:97);
    - runtime comparisons: [`if (eventName === TelemetryEventName.TASK_MESSAGE)`](packages/cloud/src/TelemetryClient.ts:295);
    - ~80 call sites of `captureEvent(TelemetryEventName.X, {…})` across `src/` (e.g. [`captureEvent(TelemetryEventName.CODE_INDEX_ERROR, …)`](src/services/code-index/orchestrator.ts:82), repeated across ~25 code-index files).

`type TelemetryEventName = (typeof schema.options)[number]["type"]` produces a **type-only union**. It deletes the runtime namespace. All 112 value-usages become compile errors — _including the `z.enum`/`z.literal` calls inside the very schema we're deriving the type from_, which is circular and self-defeating. To force the "derive from schema" direction you'd have to rewrite the schema with raw string literals and rewrite all 112 call sites to raw `"TaskCreated"` literals, **reintroducing the drift risk the audit exists to kill** (a typo in a string literal is uncaught; that is the whole value of a named enum).

**Corrected direction — the reverse, and the same pattern the self-review prescribes for providers in Correction 2.** Keep [`TelemetryEventName`](packages/types/src/telemetry.ts:20) (or a `const` tuple of names) as the **runtime** source of truth, and derive the schema's name-list _from_ it:

- catch-all arm: `z.enum(Object.values(TelemetryEventName) as [string, ...string[]])` (auto-tracks the enum — drift killed);
- per-variant `properties` schemas co-located via a `defineTelemetryEvent(name, propertiesSchema)` builder, or a `Record<TelemetryEventName, ZodSchema>` map that the discriminated union is assembled from by iteration;
- the 3 special-cased variants ([`TELEMETRY_SETTINGS_CHANGED`](packages/types/src/telemetry.ts:212), [`TASK_MESSAGE`](packages/types/src/telemetry.ts:220), [`LLM_COMPLETION`](packages/types/src/telemetry.ts:228)) become descriptor entries with distinct `properties` schemas, not ad-hoc extra union arms.

This kills the drift risk, preserves all 112 value-usages, and co-locates each event's `properties` shape — the real maintainability win. **Telemetry belongs in Correction 2's "closed set wanting compile-time exhaustiveness → runtime source-of-truth + co-located descriptors" category, not in a "stand, unaffected" category.** The inline bullet in finding 1.3 has been corrected accordingly.

### G.2 — Smaller fixes

**2a. Phasing overclaim.** Section E originally said Phase 0 ([`Registry<K,V>` extraction](packages/core/src/custom-tools/custom-tool-registry.ts:32)) "unblocks everything." It unblocks the _runtime_ registries (app-side provider/tool/message dispatch), not the _type-level_ splits — finding 1.1 is a plain-TS discriminated-union refactor in [`packages/types`](packages/types/src/vscode-extension-host.ts:456) independent of any runtime registry, and the type-derivation halves of 1.2/1.3/1.4 likewise. Phase 0 line corrected to state this; the type splits can proceed in parallel with 2.1.

**2b. Missing bundle-size / tree-shaking gate.** Neither the findings nor the self-review mention it. A `const providerRegistry = [anthropicDescriptor, …] as const` imports every provider descriptor eagerly. [`packages/types`](packages/types/src/index.ts) is consumed by **both** `src/` and `webview-ui/`. If the webview imports `ProviderName` (type-only, fine) but the tree-shaker can't prove the descriptor _values_ are unused (zod schemas have runtime shape; `z.discriminatedUnion` arms are values), the webview bundle could regress by pulling in all ~25 provider schemas. **Add a verification step per registry refactor:** "build `webview-ui`, diff bundle size, confirm descriptors are tree-shaken or mark them side-effect-free." The [`roomodes.json`](schemas/roomodes.json) generator already proves TS→artifact works; add a bundle-size gate alongside the existing [`roomodes-schema-sync.spec.ts`](packages/types/src/__tests__/roomodes-schema-sync.spec.ts) sync test.

**2c. "Zero security benefit" rationale overstated.** The conclusion (plain TS unions for [`WebviewMessage`](packages/types/src/vscode-extension-host.ts:456)) is right. But the webview↔extension boundary _does_ cross a `postMessage` structured-clone serialization seam, and webviews render marketplace/skill/markdown content where a compromise (XSS in the webview UI, malicious marketplace content) could post a malformed message. Same-origin ≠ no boundary. The honest rationale is "defense-in-depth has _marginal_ value here and is not worth a 170-arm zod runtime cost" — not "zero security benefit." This matters because the audit is building a _decision rule_ ("zod at trust boundaries, TS unions in-process"), and overstating the "untrusted" side weakens it. **Corrected rule:** zod where input is untrusted or persisted/round-tripped (IPC, CLI, disk config, [`roomodes.json`](schemas/roomodes.json)); TS unions where input is same-process typed even if it crosses a `postMessage` seam, with optional single-point `safeParse` at the receiver if a specific webview is deemed risky.

**2d. Priority inconsistency — 2.2 vs 10.2 are the same fix at two priorities.** Finding 2.2 (use [`safeJsonParse`](packages/core/src/message-utils/safeJsonParse.ts) in [`consolidateApiRequests.ts`](packages/core/src/message-utils/consolidateApiRequests.ts:71) + [`consolidateTokenUsage.ts`](packages/core/src/message-utils/consolidateTokenUsage.ts:43)) is P3 "obvious win." Finding 10.2 (consolidate raw `JSON.parse` try/catch onto `safeJsonParse` across packages) is P4 "minor." They're the same change at different scopes. **Pick one priority** — either both are obvious wins (do together) or both are minor. Splitting them invites the P3 one to land and the P4 one to rot.

**2e. IPC variant count correction.** Finding 3.1 and the self-review cite `ipcMessageSchema` as a "~5-variant exemplar." The schema at [`ipc.ts:107-125`](packages/types/src/ipc.ts:107) actually has **3** `z.object` arms ([`Ack`](packages/types/src/ipc.ts:108), [`TaskCommand`](packages/types/src/ipc.ts:113), [`TaskEvent`](packages/types/src/ipc.ts:119)). The [`IpcMessageType`](packages/types/src/ipc.ts:10) enum has 5, but [`Connect`](packages/types/src/ipc.ts:11)/[`Disconnect`](packages/types/src/ipc.ts:12) are connection-lifecycle, not schema-parsed. The scale contrast is **3 vs ~170**, not 5 vs 170 — which _strengthens_ the self-review's scale-regime argument. Corrected in finding 3.2 and in Correction 1's §1.

**2f. Unstated constraint on descriptors.** The static-const-tuple registry only gives clean `typeof` derivation if descriptors are **side-effect-free data**. If a provider descriptor runs registration side-effects at import time (e.g. self-registering a default model into a runtime map), the tuple's import order becomes load-order-coupled — `typeof` derivation still works but runtime behaviour becomes order-dependent and non-deterministic. **Add an explicit rule to the "Patterns to adopt" section:** "descriptor modules export a plain data object; no top-level side effects. Registration into a runtime map is a separate explicit step performed by the consumer, not the descriptor."

### G.3 — What the self-review got right (for balance)

- The [`as const`](ai_plans/refactor-packages.md:352) on `.map()` critique (Correction 2) is technically correct: `.map()` widens to `string[]`, and `as const` on a `.map()` _result_ doesn't retroactively narrow element literals. The original `providerNames = providerRegistry.map(p => p.name) as const` indeed does not compile to the intended type.
- The static-derivation vs runtime-self-registration regime split is the key insight of the document and is correct.
- Line-number corrections confirmed against source: the [`poeSchema.shape`](packages/types/src/provider-settings.ts:443) duplicate is at **L443 & L446** (not L410 & L446); [`toolNames`](packages/types/src/tool.ts:24) has **26** entries (counted L24-51), not 27.
- Plain TS unions for the ~170-variant [`WebviewMessage`](packages/types/src/vscode-extension-host.ts:456) — correct conclusion; a 170-arm `z.discriminatedUnion` is a real type-instantiation-depth/hover-latency hazard, and the per-domain split captures ~90% of the benefit regardless of mechanism. Verified the ~170 count (literal list spans L457-631).
- [`payload?: any`](packages/types/src/vscode-extension-host.ts:112) with eslint-disable — verified, real.
- Superset-then-narrow migration for 1.1 — sound; avoids one mega-PR breaking `src/` and `webview-ui/` compilation simultaneously.
- Section C gap 1 ([`providerSettingsSchema`](packages/types/src/provider-settings.ts:427) non-discriminated flat shape is a deliberate partial-config escape hatch) — correct and important; the descriptor refactor must preserve it as a computed merge, not derive it from the discriminated union.
- Section C gap 3 (regenerate [`roomodes.json`](schemas/roomodes.json) + run sync test after any registry refactor) — correct and missing from the original findings.

### G.4 — Net effect on the backlog (cumulative with Section D)

| Finding           | Original                                            | Correction (B)                                                                              | Correction (G)                                                                                                                                                                                                                        |
| ----------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.1 (P0)          | zod discriminated union per domain                  | Plain TS per-domain discriminated unions; zod only at trust boundaries. Risk High → Medium. | (softened security rationale per 2c; ipc variant count 5 → 3 per 2e)                                                                                                                                                                  |
| 1.2 (P0)          | ~10 → 1 via self-register + `typeof`                | ~10 → 2 via static const-tuple registry. Fix `poeSchema` dup (L443 & L446).                 | (add side-effect-free-descriptor rule 2f; add bundle-size gate 2b)                                                                                                                                                                    |
| 1.3 + 5.1 (P0/P1) | split + derive enum from schema + collapse wrappers | Originally "stands unaffected"                                                              | **AFFECTED: do NOT derive enum from schema via `typeof`. Keep `TelemetryEventName` enum as runtime source of truth; derive schema name-list from it; co-locate `properties` via descriptors. Keep non-trivial-arg-shaping wrappers.** |
| 1.4 (P2)          | 4+ → 1 via registry-derived `ToolName`              | ~4 → 2 via static const tuple (native); custom/MCP stay runtime.                            | (add side-effect-free-descriptor rule 2f)                                                                                                                                                                                             |
| 2.1 (P1)          | generic `Registry<K,V>` as runtime base             | Unchanged (runtime-only, not compile-time union source).                                    | (Phase 0 "unblocks everything" → "unblocks runtime registries only"; type splits parallel)                                                                                                                                            |
| 2.2 + 10.2        | two separate priorities (P3 + P4)                   | —                                                                                           | **Merge to one priority — same fix at two scopes.**                                                                                                                                                                                   |
| 4.1, 4.2, P3 wins | —                                                   | Unchanged.                                                                                  | Unchanged.                                                                                                                                                                                                                            |

### G.5 — Corrected execution phasing (cumulative)

- **Phase 0 (foundation):** Finding 2.1 — extract generic [`Registry<K,V>`](packages/core/src/custom-tools/custom-tool-registry.ts:32). Lowest risk. Unblocks the _runtime_ registries. Type-level splits are independent and parallel.
- **Phase 1:** Finding 1.2 — provider descriptors via **static const tuple** (proves the descriptor pattern at moderate blast radius). Fix [`poeSchema`](packages/types/src/provider-settings.ts:443) duplicate. Regenerate [`roomodes.json`](schemas/roomodes.json) + run sync test. **Add: build `webview-ui`, confirm no bundle regression (2b).**
- **Phase 2:** Findings 1.3 + 5.1 — telemetry split + partial wrapper collapse, **schema-name-list derived from the runtime enum (not the reverse)**, per-variant `properties` co-located via descriptors (paired, schema-first).
- **Phase 3:** Finding 1.1 — message union split via **plain TS per-domain unions** (highest blast radius; do last among structural refactors; superset-then-narrow migration).
- **Phase 4:** Finding 1.4 — tool descriptors via static const tuple (pattern now proven).
- **Continuous:** P3 "obvious wins" — **merge 2.2 + 10.2 into one `safeJsonParse` consolidation pass**; 5.2 [`resetInstance`](packages/telemetry/src/TelemetryService.ts:269); 10.3 vitest preset; 2.3 singleton convention. Pick off any time, bundle into unrelated PRs.

### G.6 — Final verdict

**Accept and execute with three corrections (B 1, B 2, G 1) plus the six smaller fixes (G 2a–2f).** The diagnoses are sound; the prescriptions for 1.1, 1.2/1.4, and 1.3/5.1 each had a mechanism error of the same family (applying the wrong regime — zod-at-wrong-boundary, `typeof`-on-runtime, `typeof`-on-enum). All three are now corrected to a consistent rule: **runtime source-of-truth (enum or const tuple) + co-located descriptors + schema/union derived from it, with zod reserved for trust/persistence boundaries.** Green-light execution starting with 2.1.
