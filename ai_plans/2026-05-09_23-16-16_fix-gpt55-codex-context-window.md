# Fix: GPT-5.5 Codex context window

**Source:** Zoo-Code commit [b5ad6d9f2](https://github.com/Zoo-Code-Org/Zoo-Code/commit/b5ad6d9f2) by Jason Hicks (PR #42)
**Type:** Bug fix (one-liner)
**Risk:** Trivial — corrects a single numeric constant.

## Problem

In `packages/types/src/providers/openai-codex.ts`, the `gpt-5.5` model entry under
`openAiCodexModels` declares `contextWindow: 1_050_000`. The Codex provider routes through
the ChatGPT subscription backend (`https://chatgpt.com/backend-api/codex/responses`), which
caps context at 400K — the same as every other model in this file (`gpt-5.1-codex`,
`gpt-5.1-codex-max`, `gpt-5.4`, `gpt-5.3-codex`, etc., all at `400000`).

The 1.05M figure refers to the raw `gpt-5.5` model on the standard OpenAI API, not the
Codex subscription channel. Leaving the wrong value here will let the prompt-builder pack
in more tokens than the backend will accept, producing 4xx errors mid-conversation.

## Change

Single-line edit in [packages/types/src/providers/openai-codex.ts](packages/types/src/providers/openai-codex.ts).

Locate the `"gpt-5.5"` entry inside the `openAiCodexModels` object (around line 174 — the
exact line may vary depending on prior edits in this file) and change the
`contextWindow` from `1_050_000` to `400000`:

```diff
 	"gpt-5.5": {
 		maxTokens: 128000,
-		contextWindow: 1_050_000,
+		contextWindow: 400000,
 		includedTools: ["apply_patch"],
 		excludedTools: ["apply_diff", "write_to_file"],
 		supportsImages: true,
 		supportsPromptCache: true,
 		supportsReasoningEffort: ["none", "low", "medium", "high", "xhigh"],
 		reasoningEffort: "none",
 		inputPrice: 0,
 		outputPrice: 0,
 		supportsVerbosity: true,
 		supportsTemperature: false,
 		description: "GPT-5.5: Most capable model via ChatGPT subscription",
 	},
```

## Verification

1. After saving, run the type-check:
    ```bash
    pnpm --filter @roo-code/types check-types
    ```
2. Confirm no other entries in `openAiCodexModels` use `1_050_000` (they shouldn't):
    ```bash
    grep -n "1_050_000\|1050000" packages/types/src/providers/openai-codex.ts
    ```
3. Optional sanity: the four other Codex `gpt-5.*` entries should all show
   `contextWindow: 400000`.

No tests touch this constant directly, so the existing suite should pass unchanged.

## Notes

- This is the _Codex_ provider only. If the user has the regular OpenAI provider
  (`packages/types/src/providers/openai.ts` or similar) configured separately for
  `gpt-5.5`, that file's context window can stay at `1_050_000` because it goes through the
  full API.
- No migration / no settings reset needed — the value is read fresh on every request.
