# CLI `/login <server address>` answered with a bare usage line

**Status:** done (branch `fix/cli-login-server-url-hint`)
**Related plans:** `ai_plans/2026-10-03_10-39_cli-cloud-login-tui.md`, `ai_plans/2026-10-03_11-00_cli-cloud-login-overview.md`
**Touched:** `apps/cli/src/lib/auth/tui-cloud-auth.ts`, `apps/cli/src/lib/utils/commands.ts`, `apps/cli/src/ui/hooks/useTaskSubmit.ts` (comment), `apps/cli/README.md`, tests in `apps/cli/src/lib/auth/__tests__/tui-cloud-auth.test.ts` and `apps/cli/src/lib/utils/__tests__/commands.test.ts`

## Symptom

The owner typed `/login` with the cloud server address (twice) and got only:

```
Usage: /login (opens the browser) or /login <address> (the address the browser ended on, containing /auth/clerk/callback?code=...).
```

No browser opened and nothing said how to point the CLI at the server.

## What was happening

`/login` takes one optional argument: the callback URL a remote browser ended on (`.../auth/clerk/callback?code=...&state=...`).
The picker showed it as `[address]`, which reads as "the server address". `TuiCloudAuth.login` sends any argument that is not a
callback URL to the usage line. Reproduced in a pseudo-terminal against the installed CLI (v0.2.0-local.b340cad7b): `/login`
alone works (it says `cloudApiUrl` is missing), `/login http://localhost:8085` prints the usage line once per submit.

The server address cannot be taken at runtime: the cloud URL is applied before the extension activates, and the auth service
keys its stored credentials by it when it is created. It belongs in `cloudApiUrl` in `~/.roo/cli-settings.json`.

## Fix

- The argument hint is `[callback-url]`; the usage line and the "waiting for the browser" note say `<callback-url>`.
- An argument that is an http(s) URL but not a callback URL gets a note naming the settings file and the exact
  `{ "cloudApiUrl": "<url>" }` line, then "restart the CLI and run /login without an argument". Other arguments keep the usage line.

## Tests

- New: `tui-cloud-auth.test.ts` "explains that the cloud server address goes in the settings, not after /login".
- Updated hint/wording assertions; affected CLI specs: 6 files, 113 tests pass.

## Notes

- The CLI needs a rebuild (`apps/cli/scripts/build.sh`) for this to reach `~/.roo/cli`.
