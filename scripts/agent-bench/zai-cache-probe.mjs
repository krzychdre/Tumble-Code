#!/usr/bin/env node
// Z.ai context-cache probe (WS-6 of the agent-loop efficiency plan).
//
// Sends the SAME ~20k-token request twice to a Z.ai endpoint and prints the
// raw `usage` of both responses. Decision matrix:
//   - 2nd response has prompt_tokens_details.cached_tokens > 0
//       -> implicit caching works and is reported: proceed with WS-7
//          (prefix stability + surface cacheReads in cost).
//   - cached_tokens absent/0 on both
//       -> the endpoint does not cache or does not report it: close WS-7.
//
// Usage:
//   ZAI_API_KEY=... node scripts/agent-bench/zai-cache-probe.mjs [baseURL] [model]
//
// Defaults target the international coding endpoint used by the extension.

const baseURL = process.argv[2] ?? "https://api.z.ai/api/coding/paas/v4"
const model = process.argv[3] ?? "glm-5.2"
const apiKey = process.env.ZAI_API_KEY

if (!apiKey) {
	console.error("Set ZAI_API_KEY (the key the GLM profile uses).")
	process.exit(1)
}

// ~20k tokens of deterministic filler so the prefix is cacheable and identical.
const filler = Array.from(
	{ length: 2000 },
	(_, i) => `Line ${i}: the quick brown fox jumps over the lazy dog, again and again, deterministically.`,
).join("\n")

const body = {
	model,
	stream: false,
	max_tokens: 16,
	thinking: { type: "disabled" },
	messages: [
		{ role: "system", content: `You are a test assistant. Reference text:\n${filler}` },
		{ role: "user", content: "Reply with the single word: ok" },
	],
}

async function call(label) {
	const started = Date.now()
	const res = await fetch(`${baseURL}/chat/completions`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			authorization: `Bearer ${apiKey}`,
		},
		body: JSON.stringify(body),
	})
	const elapsed = Date.now() - started
	if (!res.ok) {
		console.error(`${label}: HTTP ${res.status} ${await res.text()}`)
		process.exit(1)
	}
	const json = await res.json()
	console.log(`${label}: ${elapsed} ms`)
	console.log(`${label} usage: ${JSON.stringify(json.usage, null, 2)}`)
	return json.usage
}

const first = await call("request-1")
// Small gap so the cache entry is surely materialized.
await new Promise((r) => setTimeout(r, 3000))
const second = await call("request-2")

const cached = second?.prompt_tokens_details?.cached_tokens ?? 0
console.log("---")
if (cached > 0) {
	console.log(`VERDICT: caching works and is reported (cached_tokens=${cached}). Proceed with WS-7.`)
} else {
	console.log(
		"VERDICT: no cached_tokens reported on the identical second request. " +
			"Either this endpoint does not cache or does not report it — close WS-7 unless Z.ai docs say otherwise.",
	)
}
console.log(`prompt_tokens: first=${first?.prompt_tokens}, second=${second?.prompt_tokens}`)
