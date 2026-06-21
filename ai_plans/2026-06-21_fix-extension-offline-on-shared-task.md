# Fix: shared task shows "Extension offline" — make it remote-controllable right after sharing

**Date:** 2026-06-21
**Branch:** `feature/self-hosted-remote-task-control`
**User's words:** "all the same with 'Extension offline' on shared task. Fix it. Once user
share the task, it should be already remote-controllable."

## Symptom

After sharing a task, the web cockpit shows the live-status pill **"Extension offline"** and
all controls are disabled. The user expects that the moment a task is shared, the page is
already drivable from the browser.

## Root cause (proven with evidence)

`registry.has_extension(user_id)` is what the live page reports as `instanceOnline`
(`src/realtime/sio.py:212`, surfaced by `live.js` as `"Extension offline"`). It is true only
once the extension's `BridgeOrchestrator` has connected and emitted `extension:register`.

The orchestrator never starts:

- `src/extension/bridge.ts` gates `start()` behind
  `isEnabled() = getConfiguration("tumble-code").get("remoteControlEnabled", false)`.
- `src/package.json` declares `tumble-code.remoteControlEnabled` with **`default: false`**.
- The user's `~/.config/Code/User/settings.json` does **not** set the key → it resolves to
  **false**. Verified: `grep remoteControlEnabled settings.json` → no match.
- Therefore `reconcile()` always calls `stop()` (a no-op), the socket never connects, the
  extension never registers, and every live page renders "Extension offline".

The installed build (`qub-it.tumble-code-3.53.0/dist/extension.js`) **does** contain the bridge
code (grep hit), so this is purely the default-off gate, not missing code. The bridge's own
header comment already claims it is _"Always on — the bridge connects whenever a cloud session
is active, with no opt-in toggle"_ — the code contradicts its documented intent.

Second gap: the URL the user actually lands on after sharing is `/shared/{id}`
(`shareUrl` in the share response), and `routers/web.py` hard-codes that page to `live=False`.
So even with the extension online, the share link the user opens is read-only.

## Fix

Two coordinated changes; security boundary preserved (a _public_ share link viewed by a
stranger must never gain control).

### 1. Extension — bind the bridge to the cloud session (no setting)

The setting added nothing: the bridge already requires an authenticated cloud session for its
token + user identity, so a separate enable flag is pure redundancy. **Removed entirely** rather
than defaulted-on:

- `src/package.json` + `src/package.nls.json`: delete the `tumble-code.remoteControlEnabled`
  contribution and its description string.
- `src/extension/bridge.ts`: drop `isEnabled()`/`CONFIG_*` and the `onDidChangeConfiguration`
  listener; `reconcile()` now follows auth state — `start()` when
  `CloudService.isAuthenticated()`, `stop()` otherwise; runs on `auth-state-changed`.

Result: whenever a cloud session is active (which it must be to share at all), the orchestrator
connects and registers, so the extension is online before the user opens the page — with no
toggle to find.

### 2. Web — the owner's own shared link is live

- `routers/web.py` `/shared/{task_id}`: load the `Task`, and set
  `live = settings.bridge_enabled and user is not None and user["user_id"] == task.user_id`.
  Anonymous / non-owner viewers stay `live=False` (read-only) exactly as before.
  Pass a real `live_config_json` when live.
- `task_detail.html`: show the "Shared link · read-only" note only `{% if share_url and not
live %}` (owner driving their own shared task isn't read-only).

The backend already independently authorizes control: `task:join` does a DB ownership check and
`task:command` relays only to that same `user_id`'s own extension. The web gating is the UI half
of the same owner-only rule.

## Verification

- Backend `uv run pytest`: existing `test_shared_page_never_renders_live_controls`
  (anonymous viewer) still passes; add `test_shared_owner_gets_live_controls` (owner session →
  ships `#live-controls` + `live.js`) and `test_shared_nonowner_stays_readonly`.
- Manual e2e: with the rebuilt extension signed in, share a task, open the share URL → status
  pill flips to **Live**, controls enabled, drive the task from the browser.

## Risk / rollback

Additive + a default flip. Disable globally via backend `BRIDGE_ENABLED=false`, or per-machine
by setting `tumble-code.remoteControlEnabled: false`. No browser↔VS Code direct path; relay
stays strictly per-`user_id` and DB-ownership-checked.
