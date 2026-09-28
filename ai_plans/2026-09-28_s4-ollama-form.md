# S4 clean-up, slice b2: integer field kind, Ollama as descriptor data

Continues slice b1 (`ai_plans/2026-09-28_s4-fetched-model-picker.md`, PR #624), which added the fetched-model
picker kind and recorded as a residual: "Ollama needs two more pieces (an integer field for `num_ctx` with its parse
rule, and a note with a trailing warning); next slice." Branch `refactor/s4-ollama-form`, from main 5621e918f.

## 1. Problem

After b1 the Ollama form was the only local-server form still hand-written. Everything in it was already a field kind
(base URL and API key as `text`, the API key shown once a base URL is set via `visibleWhen: { settingIsSet }`, the
model picker as `fetchedModelPicker`) except two things: the context window field, which parses its input and
ignores values under 128, and the closing description followed by a warning in the error colour.

## 2. Approach

- New kind `integer` (packages/types `ProviderIntegerFieldDescriptor`): a labelled field for a numeric setting
  (`ProviderNumberSettingKey`) with an optional help text inside the field, a literal placeholder and an optional
  `min`. It renders exactly the old handler: an empty input writes `undefined`, anything else is read with
  `parseInt(value, 10)` and written only when it is a number of at least `min` (so "8192tokens" writes 8192 and "127"
  writes nothing, as before).
- `note` gains `warningKey`: the text followed by `<span className="text-vscode-errorForeground ml-1">`, the old
  markup. The spec checks it is not combined with the `Trans` variant (`links`/`warningTag`).
- Migrated: **Ollama**. `providers/Ollama.tsx`, its index export and its registry row are deleted. The "e.g., 4096"
  placeholder stays literal English, as it was (translating it would be a visible change).

## 3. Equivalence evidence

The characterization spec from b1 (`provider-forms.local-models.spec.tsx`, taken on main before either move) already
pins Ollama: 5 DOM snapshots (empty, base URL set revealing the API key, API key and listed model, unlisted model,
context window set), the model list request arguments and their serialized form, the availability error, and what
the base URL, API key and context window write (6 inputs: empty, 4096, 128, 127, "abc", "8192tokens"). All 39 cases
pass with no snapshot written or updated.

Also green: `provider-forms.*`, `provider-ui-registry`, `provider-descriptors.i18n`, `ApiOptions*`,
`providerModelConfig`, `useProviderModels`, `useSelectedModel`, `ModelPicker*`, the UI call-site specs, `validate`
and `provider-validation-registry` (44 files, 708 tests), `provider-descriptors.spec.ts` (22), `tsc` for
packages/types and webview-ui, eslint `--max-warnings=0` on the settings components and the React Compiler bailout
check (Ollama was not a bailout).

## 4. Adding a provider after this slice

Both local-server providers are descriptor rows. The custom forms left are OpenRouter, LiteLLM, OpenAI Compatible,
VS Code LM, Bedrock, Vertex, OpenAI Codex and Qwen Code; see section 5.

## 5. Residuals

What each remaining custom form needs beyond the current kinds (so a kind would serve one provider only, which does
not reduce the work of adding the next one):

- OpenRouter: an API key field with a live balance display in its label, a get-key link built from the editor's
  URI scheme (OAuth), a base URL toggle hidden under `simplifySettings`, a picker fed from the router models with
  the organization allow-list and validation error.
- LiteLLM: a refresh button with loading/success/error state and a missing-config check, a prompt caching checkbox
  shown by the fetched model's `supportsPromptCache`, allow-list, `simplifySettings`.
- OpenAI Compatible (580 lines): Azure switches, custom model info editing, headers editor, R1 format, streaming.
- VS Code LM: models from the editor's LM API, stored as a `{ vendor, family }` selector through value/display
  transforms, with a different layout when no model is available.
- Bedrock and Vertex: cloud credential sets (profiles, access keys, service-account JSON with a path warning),
  region pickers, custom ARN, 1M context rules on the raw `apiModelId` (not the default model).
- OpenAI Codex: OAuth sign in/out messages to the host and the rate-limit dashboard.
- Qwen Code: an OAuth credential file path whose empty value is replaced by the default path on blur, and several
  untranslated English notes (moving them to i18n keys would be a visible change, as the service tier was).
