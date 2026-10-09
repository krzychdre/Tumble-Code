# web_fetch refused with HTTP 403 by crates.io: investigation & fix

**Status:** done (branch `fix/web-fetch-browser-user-agent`)
**Related plans:** none
**Touched:**

- `src/services/web/WebFetchService.ts`
- `src/services/web/__tests__/WebFetchService.spec.ts`
- `.changeset/web-fetch-browser-user-agent.md`

## Symptom

An Ask-mode task on GLM-5.3-Flash checking whether a Rust project needs dependency upgrades stopped on:

```
web_fetch got HTTP 403 for https://crates.io/api/v1/crates/serde; check the URL or continue without the page contents
```

The same URL opens fine in a browser.

## What was happening

`WebFetchService.requestFollowingRedirects` sent only an `Accept` header. Node's built-in `fetch` then signs the request as `User-Agent: node`. crates.io's data access policy rejects requests without an identifying user agent, and it treats `node` that way.

Measured against the live host on 2026-10-09:

| Request                                        | Status                 |
| ---------------------------------------------- | ---------------------- |
| Node `fetch`, default user agent               | 403                    |
| Node `fetch`, Chrome user agent + our `Accept` | 200 `application/json` |

The tool takes only `url`, so the model cannot change headers and has no way to work around the refusal.

## Failure surface (before/after)

| Scenario                                | Before                 | After                      |
| --------------------------------------- | ---------------------- | -------------------------- |
| crates.io API (`/api/v1/crates/<name>`) | 403                    | 200, JSON returned as text |
| Hosts that block non-browser clients    | 403 or a bot page      | answered as for Chrome     |
| Redirect hops                           | each hop signed `node` | each hop signed as Chrome  |

## Fix

A private `BROWSER_USER_AGENT` constant (desktop Chrome on Linux) goes into the headers of every hop in `requestFollowingRedirects`, next to the existing `Accept`. The owner chose a browser string over a self-identifying `TumbleCode/x.y` one, so sites answer the way they answer a person.

The constant is not exported: an export used only by the spec would trip the test-only exports gate.

## Tests

- New spec case "signs every hop as a desktop Chrome so hosts that refuse `node` answer": a 301 hop and the final hop must both carry a Chrome-shaped user agent.
- Verified by removing the header line: the new case fails; restored, all 37 cases pass.
- Live check (outside vitest, which blocks the network through nock): the real `WebFetchService` fetched `https://crates.io/api/v1/crates/serde` and returned `"max_stable_version":"1.0.229"`.

## Notes

- `WebSearchService` (SearXNG) is untouched; it talks to a configured instance, not to arbitrary sites.
- The Chrome version number in the string ages. Sites do not check it closely, but bump it now and then.
- This does not help with sites behind JavaScript challenges (Cloudflare "checking your browser"): no header can get past those.
