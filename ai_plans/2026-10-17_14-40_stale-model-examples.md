# OpenAI Compatible stops auto-filling gpt-4o; stale model examples

**Status:** implemented on `fix/stale-model-examples`
**Touched:** `webview-ui/src/components/settings/providers/OpenAICompatible.tsx`,
`webview-ui/src/components/settings/providers/BedrockCustomArn.tsx`, `.github/ISSUE_TEMPLATE/bug_report.yml`,
test `webview-ui/src/components/settings/providers/__tests__/OpenAICompatible.spec.tsx`

## Problem

Found by the stale-default audit run with the OpenRouter / VS Code LM fixes.

- `OpenAICompatible.tsx` passed `defaultModelId="gpt-4o"` to `ModelPicker`. That is not a placeholder:
  `ModelPicker`'s init effect writes `defaultModelId` into the profile when no model id is set
  (`setApiConfigurationField(modelIdKey, initialValue, false)`). So opening the form filled
  `openAiModelId: "gpt-4o"` into a profile that may point at a local server, and the "model id required"
  validation (`providerModelDefinitions.openai.defaultModelId === ""`) never fired for it.
- `BedrockCustomArn.tsx` showed an inference-profile ARN example with Claude Sonnet 4.5 (retires 2026-11-30).
- The bug report template's example model was "Claude 3.7 Sonnet".

## Change

`defaultModelId=""` (as in `VSCodeLM.tsx` and `ProviderDescriptorForm.tsx`); the examples name Claude Opus 5.

## Tests

New case in `OpenAICompatible.spec.tsx`: the picker gets an empty default. Confirmed it fails with `"gpt-4o"`
restored and passes with the fix. OpenAICompatible + Bedrock specs: 36 passed.
