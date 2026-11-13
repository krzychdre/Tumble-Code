# Bedrock: leave Claude effort to the model default when none is chosen

**Status:** implemented on `fix/bedrock-effort-model-default`, not pushed, not merged
**Related plans:** `ai_plans/2026-10-17_12-05_anthropic-reasoning-effort.md` (the "Bedrock and Vertex caveats"
section described this gap and left it open), `ai_plans/archive/2026-06/2026-06-01_zoo-386-claude-opus-4-8.md`
(where the hardcoded level came from)
**Touched:**

- `src/api/providers/bedrock/request.ts` (`buildThinkingFields`, adaptive branch)
- tests: `src/api/providers/bedrock/__tests__/request.spec.ts`, `src/api/providers/__tests__/bedrock.spec.ts`,
  `src/api/providers/__tests__/bedrock-characterization.spec.ts`

## Symptom

With thinking on and no effort level chosen, a Bedrock request to an adaptive-thinking Claude model (Opus 4.7,
Opus 4.8, the Claude 5 family) carried `additionalModelRequestFields.output_config.effort: "xhigh"`. The settings
select (`webview-ui/src/components/settings/ThinkingBudget.tsx`) shows the model default for the same state:
"High (model default)", or "Medium (model default)" on Opus 5.5 and Haiku 5.5. So the request ran deeper (and
cost more) than what the UI said. The Anthropic and Vertex handlers already omit the field in this state.

## Where xhigh came from

`git log -S'"xhigh"'` on the Bedrock handler leads to `f00d0ebde` (#63, port of Zoo-Code #386, "add Claude Opus
4.8 support"). The original comment says xhigh "remains the recommended level for agentic coding tasks across
both 4.7 and 4.8 (4.8 changed the API default to "high" but the model continues to honour "xhigh" for deeper
reasoning)". It was a quality preference copied from upstream, not a protocol requirement: the Anthropic API
documents `output_config.effort` as optional with the model default applied when it is absent, and adaptive
thinking does not need it. The later split (`562557699`, API-18) and #897 kept it only as the fallback for an
unset level. Nothing else (no test, no model record, no API rule) depends on the field being present.

## Fix

- Adaptive branch of `buildThinkingFields`: `output_config` is spread only when `getAnthropicEffort` returns a
  level (`...(effort ? { output_config: { effort } } : {})`), the same pattern the budget branch already used.
  `getAnthropicEffort` (`src/api/transform/reasoning.ts`) was already called there; it returns undefined for an
  unset level and for a carried level the model does not list.
- Result: unset or invalid level means no effort field, so Bedrock runs the model default shown in the UI. A
  chosen valid level is sent as before.

## Behaviour change for existing users

Bedrock users who never picked a level, with thinking on, go from xhigh to the model default (high, or medium on
Opus 5.5 and Haiku 5.5). This is the owner's decision: the request must match what the settings show. Users who
want xhigh choose it in the select. The CLI is unaffected in practice: `resolveReasoningEffort` already pins the
model default level for the bedrock provider.

## Tests

- `bedrock/__tests__/request.spec.ts`: unset level on an adaptive model gives only `thinking` (no
  `output_config`); a chosen valid level is sent; a carried invalid level ("minimal") is omitted.
- `bedrock.spec.ts`: Opus 4.7 and Opus 4.8 with thinking on and no level send no `output_config`; new cases for
  Opus 4.8 with "max" (sent) and "minimal" (omitted) through the full handler.
- `bedrock-characterization.spec.ts`: the adaptive-model inline snapshot loses the `output_config` block.
