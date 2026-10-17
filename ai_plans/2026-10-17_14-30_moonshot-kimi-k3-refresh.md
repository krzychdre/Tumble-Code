# Moonshot: model table refresh, Kimi K3 default

**Status:** implemented on `fix/moonshot-default-model`
**Touched:**

- `packages/types/src/providers/moonshot.ts` (table replaced, `moonshotDefaultModelId = "kimi-k3"`, new
  `moonshotUnknownModelStandInId = "kimi-k2.6"`), `packages/types/src/provider-models.ts` (`unknownModelInfoId`)
- `src/api/providers/moonshot.ts` (no temperature for `supportsTemperature: false`, `reasoning_effort` from the
  resolved effort, in both the stream and the one-shot path)
- tests: `moonshot.spec.ts`, `moonshot-wire.spec.ts`, `openai-compatible-request-bodies.characterization.spec.ts`
  (+ snapshot), sample ids in `cancellation-contract.spec.ts`, `error-contract.spec.ts`,
  `moonshot-stream-errors.spec.ts`

## Problem

The audit of stale defaults flagged `moonshotDefaultModelId = "kimi-k2-0905-preview"` and suggested `kimi-k2.5`,
the newest entry of the table. Moonshot's model list (https://platform.kimi.ai/docs/models.md, read 2026-10-17)
shows that every model in the table was discontinued: the `kimi-k2` series on 2026-05-25, `kimi-k2.5` on
2026-08-31. Moonshot's migration guidance for all of them is `kimi-k3`. The provider had no working model.

## Sources

- Pricing: https://platform.kimi.ai/docs/pricing/chat.md
- Parameters: https://platform.kimi.ai/docs/api/models-overview.md
- K3: https://platform.kimi.ai/docs/guide/kimi-k3-quickstart.md (max_completion_tokens default 131072)
- K2.6 / K2.7 Code quickstarts (max_tokens default 32768, base64 images only)

| id                         | context   | max out | in $/M | out $/M | cache read | cache write | reasoning                                               |
| -------------------------- | --------- | ------- | ------ | ------- | ---------- | ----------- | ------------------------------------------------------- |
| `kimi-k3`                  | 1,048,576 | 131,072 | 3.00   | 15.00   | 0.30       | 3.00 (5 m)  | `reasoning_effort` low/high/max, default max, always on |
| `kimi-k2.7-code`           | 262,144   | 32,768  | 0.95   | 4.00    | 0.19       | none        | always on, no parameter                                 |
| `kimi-k2.7-code-highspeed` | 262,144   | 32,768  | 1.90   | 8.00    | 0.38       | none        | always on, no parameter                                 |
| `kimi-k2.6`                | 262,144   | 32,768  | 0.95   | 4.00    | 0.16       | none        | `thinking`, on by default                               |

All four: images (base64, which `convertToR1Format` sends), `temperature`/`top_p` fixed server-side with "any
other value results in an error", `reasoning_content` must be passed back (`preserveReasoning`, sent by the R1
converter as before). `tool_choice: "required"` only on K3; the task sends `"auto"`, so nothing to do.

## Handler changes

- Temperature: `getModelParams` with `format: "openai"` does not apply `supportsTemperature: false` (only the
  o1/o3-mini special case), and the old handler sent `temperature: 0` on every stream. That is now an API error
  on every listed model, so `getSamplingParams` drops it when the info says `supportsTemperature: false`, and
  `completePromptWithUsage` drops the user's temperature the same way.
- Reasoning effort: K3 info has `supportsReasoningEffort: ["low", "high", "max"]`, `requiredReasoningEffort`
  (no "off" choice in the settings, K3 cannot stop thinking) and `reasoningEffort: "max"` (the API default, so
  sending it changes nothing for a user who does not pick one). `getExtraStreamParams` and the one-shot path send
  `reasoning_effort` when `getModelParams` resolved one. A saved effort K3 does not take (for example `medium`)
  resolves to none and nothing is sent, so the API default applies.
- K2.6's thinking switch is not exposed (it stays on, the API default); disabling it would also change its fixed
  temperature to 0.6.

## Unknown ids

`keep-id` sends an unknown id as typed with the default's info. With K3 as default that adds
`reasoning_effort: "max"`, which the K2 line does not support. Same pattern as Vertex/Bedrock:
`unknownModelInfoId: "kimi-k2.6"`, the plain record.

## Behaviour change for existing users

- No saved model: moves from kimi-k2-0905-preview (discontinued, so failing) to kimi-k3: $3/$15 instead of
  $0.60/$2.50, always reasoning at max unless lowered.
- Saved discontinued id: unchanged, still fails at Moonshot (now with the K2.6 stand-in info); the user picks a
  listed model. No migration: the saved id is the user's choice and there is no single right replacement.
- Saved temperature: no longer sent to Moonshot.

## Not changed

Bedrock's `moonshot.kimi-k2-thinking` (hosted by AWS, separate lifecycle); Fireworks/Groq Kimi entries.

## Tests

src: Moonshot specs + characterization + contract specs (242, then 174), `packages/types` 806, webview
`src/hooks/models` + `src/components/settings` 906, CLI `src/lib/utils` 304, `tsc --noEmit` in types, src,
webview-ui, cli.
