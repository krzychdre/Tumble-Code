# CLI: web_fetch pinned to the vetted address (audit X-2)

**Status:** done on `fix/sec-webfetch-pin`
**Audit:** `private_docs/security-audit-2026-11-06/report.md` X-2 (owner decision: pin in the CLI only)
**Touched:**

- `src/services/web/WebFetchService.ts`: `SendRequest`, `sendPinned` (CLI), `sendUnpinned` (VS Code); `assertAllowedTarget` returns the vetted addresses
- `src/services/web/addressGuard.ts`: header says where the pin applies

## Problem

`assertAllowedTarget` validated the addresses of each hop, then `fetch` resolved the name again
(`WebFetchService.ts`, `requestFollowingRedirects`). A DNS server answering a public address first
and 127.0.0.1 a moment later (rebinding, TTL 0) passed the guard.

## Fix

Each hop hands its vetted addresses to the request. In the CLI (`ROO_CLI_RUNTIME`, read with
`readCliRuntimeEnv`) the request goes through undici's own `fetch` with a per-hop
`Agent({ connect: { lookup } })` whose lookup answers only with those addresses; Host and TLS server
name stay the URL's hostname. A name that did not resolve gives an empty list, and the pinned lookup
then fails with ENOTFOUND instead of asking DNS itself (otherwise SERVFAIL-then-answer would bypass
the pin). Redirects stay re-validated per hop.

VS Code keeps the global `fetch` unpinned: `@vscode/proxy-agent`'s fetch patch replaces a custom
dispatcher (round 1 evidence in the X-2 status), so a pin there would be silently dropped. The
residual risk stays documented in the `addressGuard.ts` header.

## Tests

`WebFetchService.spec.ts`:

- each hop's vetted addresses reach the sender (redirect to another host);
- `sendPinned` reaches a 127.0.0.1 server for `rebound.invalid` (a name that never resolves), Host kept;
- `sendPinned` with no vetted addresses does not reach a server on `localhost`.

Mutations: plain `new Agent()` (two red), DNS fallback for an empty list (one red), `[]` instead of
the hop's addresses (one red).

## Notes

The pinned path does not honour Node's opt-in `NODE_USE_ENV_PROXY` for the global `fetch`; a CLI
user who sets it loses the proxy for `web_fetch` only. The CLI sets no global dispatcher of its own.
