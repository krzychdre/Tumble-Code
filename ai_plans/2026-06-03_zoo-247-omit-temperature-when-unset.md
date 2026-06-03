# Port Zoo #247 — omit `temperature` when no custom value is set (OpenAI-Compatible)

- **Date:** 2026-06-03
- **Branch:** `feature/zoo-247-omit-temperature-when-unset` (off `main`)
- **Upstream:** Zoo-Code PR #247 (commit `919394170`), fixes Zoo issue #242
- **Type:** provider bug fix · size S · risk low

## §0 Credit

Original author — add to commit message when committing:

```
Co-authored-by: Armando Vaquera <263793884+proyectoauraorg@users.noreply.github.com>
```

## §1 Problem (root cause, verified in our code)

In [src/api/providers/openai.ts:226-229](../src/api/providers/openai.ts#L226-L229) the
streaming `createMessage` request builds `temperature` as:

```ts
...(modelInfo.supportsTemperature !== false && {
    temperature:
        this.options.modelTemperature ?? (deepseekReasoner ? DEEP_SEEK_DEFAULT_TEMPERATURE : 0),
}),
```

When the user has **"use custom temperature" off**, `this.options.modelTemperature`
is `undefined`, so the `?? … : 0` fallback sends `temperature: 0`. That overrides
the model server's own default (the model never gets to pick its default). The
`supportsTemperature === false` gate and the deepseek-reasoner default are both
correct and must be preserved.

The non-streaming paths already pass `temperature: undefined` (openai.ts:446, :486),
so **only this one block needs changing** — matching the upstream single-file diff.

## §2 Fix (option A from #242 — omit when unset)

Send `temperature` only when the model supports it **and** (the user set a custom
value **or** the model needs a required default). Otherwise omit it so the server
default applies. A deliberately-set `0` is `!= null`, so it is still sent.

## §3 TDD — write tests first, watch them fail

File: [src/api/providers/**tests**/openai.spec.ts](../src/api/providers/__tests__/openai.spec.ts)

**Edit A** — flip the existing default-behavior test (lines 419-426):

Replace the test titled `"should include temperature by default when supportsTemperature is not set"`
(asserting `toHaveProperty("temperature")`) with one titled
`"should omit temperature by default when no custom temperature is set"` asserting
`not.toHaveProperty("temperature")`.

**Edit B** — add a new test after the deepseek-reasoner test (after line 446)
proving a deliberate `0` is still sent:

```ts
it("should still send temperature when the user sets a custom value of 0", async () => {
	// A deliberate 0 must be distinguished from "unset" — it is sent, not omitted.
	const zeroTempHandler = new OpenAiHandler({ ...mockOptions, modelTemperature: 0 })
	const stream = zeroTempHandler.createMessage(systemPrompt, messages)
	for await (const _chunk of stream) {
	}
	expect(mockCreate).toHaveBeenCalled()
	const callArgs = mockCreate.mock.calls[0][0]
	expect(callArgs.temperature).toBe(0)
})
```

**Edit C** — the Azure full-object assertion (line 689) currently expects
`temperature: 0`; after the fix temperature is omitted, so remove that line.

Run (expect RED on Edits A & C before the code change):

```
cd webview-ui/.. ; npx vitest run src/api/providers/__tests__/openai.spec.ts
```

(from repo root: `npx vitest run src/api/providers/__tests__/openai.spec.ts`)

## §4 Production change (makes tests GREEN)

File: [src/api/providers/openai.ts](../src/api/providers/openai.ts), lines 223-229. Replace with:

```ts
// Some OpenAI-Compatible models (e.g. claude-opus-4-7, claude-opus-4-8) reject
// `temperature` as deprecated/unsupported, so honor the model's `supportsTemperature`
// flag and omit it when that flag is false. Beyond that, only send `temperature` when
// the user set a custom value or the model needs a specific default (deepseek-reasoner);
// otherwise omit it so the server's own default applies instead of forcing 0.
...(modelInfo.supportsTemperature !== false &&
    (this.options.modelTemperature != null || deepseekReasoner) && {
        temperature: this.options.modelTemperature ?? DEEP_SEEK_DEFAULT_TEMPERATURE,
    }),
```

## §5 Gates / acceptance (binary)

- `npx vitest run src/api/providers/__tests__/openai.spec.ts` → all pass.
- `npx eslint src/api/providers/openai.ts src/api/providers/__tests__/openai.spec.ts` → clean.
- Type check: `npx tsc -p src --noEmit` (or repo `check-types`) → no new errors.
- No Roo/Zoo branding, no removed-feature (TTS/router/cloud) touched. YAGNI: do not
  alter the non-streaming paths (already correct).

## §6 Scope cuts

Only the OpenAI-Compatible streaming `createMessage` block + its 3 test edits.
Nothing else in the 2-file upstream diff exists beyond this.
