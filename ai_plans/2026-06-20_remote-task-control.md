# Remote live control of a Tumble Code task from the web (socket.io bridge)

**Date:** 2026-06-20
**Branch:** `feature/self-hosted-remote-task-control` (stacked on `feature/self-hosted-web-task-viewer`)
**Goal (user's words):** "I need to be able to remotely converse with [a] session. I want the
input as in vscode, and be able to allow/disallow requests. Also stop task and steer the
auto-approves (detailed (read, mcp, subtasks, write, mode, execute) and main modes (default,
bypass and autonomous)). Also I want to see the tokens in/out, context length (just like in
vscode)."

---

## Context

Tasks already reach the self-hosted cloud backend as a **read-only snapshot** (Share pipeline →
`Task`/`TaskMessage` rows → server-rendered `/app/tasks/{id}` viewer, see
`ai_plans/2026-06-19_web-task-list-and-viewer.md`). This adds a **live control channel** so the web
page can drive a running task like the VS Code panel: input, approve/deny, stop, auto-approve
steering (6 detailed toggles + `default`/`bypass`/`autonomous` mode), and live tokens/context.

**Hard constraint (user):** all traffic is **Tumble Code ↔ backend ↔ browser**. Never a direct
VS Code ↔ browser connection — the backend always relays.

**Decisions (user):**

- **Transport: socket.io bridge** (upstream "Roomote" architecture).
- **Connection model: opt-in** — a setting gates whether the extension connects/registers.
- **Scope: active task + resume from history.**

The upstream bridge **protocol enums/schemas already exist** in `packages/types/src/cloud.ts`
(`ExtensionSocketEvents`, `TaskSocketEvents`, `TaskBridgeEvent`, `TaskBridgeCommand`,
`ExtensionInstance`) but the **implementation was never ported** (no `socket.io-client`, no
orchestrator, no backend socket.io server). `services/bridge_service.py` is a stub returning a dead
`ws://localhost:8080/ws`.

## Architecture (verified entry points)

```
 VS Code (Tumble Code)            FastAPI cloud API (:8085)              Browser (/app/tasks/{id})
 BridgeOrchestrator  ── socket.io ──►  python-socketio AsyncServer  ◄── socket.io ──  task page JS
   attaches to API event bus            (mounted on the app)               cookie-auth handshake
   reaches ClineProvider                per-user + per-task rooms          live render + controls
                                        relays event ⇄ command
                                        persists Message events → TaskMessage
```

Both sides authenticate to the **same `user_id`** (extension = bridge JWT, browser =
`tumble_session` cookie), which is how the server pairs a browser to that user's extension and
authorizes task access.

### Extension control surface (verified, reused as-is)

- inject input → `Task.submitUserMessage(text, images, mode?, providerProfile?)` (Task.ts:952)
- approve/deny → `task.handleWebviewAskResponse("yesButtonClicked"|"noButtonClicked"|"messageResponse", text, images)` (Task.ts:916)
- stop → `provider.cancelTask()` (webviewMessageHandler.ts:1327)
- auto-approve → `provider.contextProxy.setValue(key, val)` + `provider.postStateToWebview()`;
  keys: `autoApprovalEnabled`, `autoApprovalMode` (`default|bypass|autonomous`, global-settings.ts:40),
  `alwaysAllowReadOnly|Write|Execute|Mcp|ModeSwitch|Subtasks`
- resume → `provider.showTaskWithId(id)` (ClineProvider.ts:1848)
- live bus → `API` re-emits `Message`/`TaskModeSwitched`/`TaskAskResponded`/`TaskTokenUsageUpdated`
  (api.ts:378); numbers via `Task.getTokenUsage()` (Task.ts:1267)

## Implementation

### 1. Protocol — `packages/types/src/cloud.ts`

Extend `TaskBridgeCommand` union: `stop_task {taskId}`, `set_auto_approval {payload:{autoApprovalEnabled?,
autoApprovalMode?, alwaysAllow*?}}`, `resume_task {taskId}`. Add an `instance_state` bridge event
carrying `{mode, autoApproval snapshot, tokenUsage, contextTokens, contextWindow, currentAsk?}`.

### 2. Backend — socket.io on FastAPI

- Dep `python-socketio`. `src/realtime/sio.py`: `AsyncServer(async_mode="asgi")`; mount in `main.py`.
- Handshake auth: extension via `decode_token` on `auth["token"]`; browser via `tumble_session`
  cookie (reuse `web_session.py`). Join `user:{user_id}`.
- Events: `extension:register`/`heartbeat` → in-memory registry; `task:join` → DB ownership check;
  `task:command` (browser) → relay to that user's extension as `task:relayed_command`;
  `extension:event` → relay to `task:{id}` room + upsert Message into `TaskMessage`
  (reuse `telemetry_service.backfill_messages` logic).
- Rewire `bridge_service.py` + `/api/extension/bridge/config` to real `socketBridgeUrl` + bridge JWT;
  `bridge_enabled=True` default.

### 3. Extension — bridge client

- Dep `socket.io-client` in `packages/cloud`. New `packages/cloud/src/bridge/BridgeOrchestrator.ts`:
  connect with token from `CloudAPI.bridgeConfig()`, `extension:register`, heartbeat, forward
  API-bus events, dispatch `task:relayed_command` → control entry points.
- Wire in `src/extension.ts` (~388) with `API` bus + `provider` + `cloudService`. Gate on opt-in
  setting `tumble-code.remoteControlEnabled` (default false) + `remoteControlEnabled` global setting.

### 4. Web — interactive `/app/tasks/{id}`

- Vendor `socket.io-client` min.js. Extend `task_detail.html` + `render.js`: `task:join`, append
  relayed Message events, UI → `task:command` (chat input, Approve/Deny, Stop, auto-approve bar with
  mode selector + 6 toggles, token/context header, Resume button). Offline/live states.

### 5. Migration

None — reuses `Task`/`TaskMessage`; instance registry is in-memory.

## Out of scope

Multi-instance disambiguation beyond newest-per-user; web image paste; visibility changes; upstream
merge reconciliation of the extended schema.

## Verification

- Backend `tests/test_bridge.py` (python-socketio AsyncSimpleClient): register on JWT; `task:join`
  only owned tasks; `task:command` relayed only to that user's extension; Message event upserts
  `TaskMessage`. Full `uv run pytest`.
- Extension vitest: command dispatcher mapping; orchestrator connects only when setting on.
- Manual e2e (real Authentik + extension): drive a task from the web — input, approve/deny, mode
  flip reflected in VS Code, live tokens, stop, resume.

## Risk / rollback

Additive; existing HTTP routes/viewer/Share untouched. Disable via `bridge_enabled=False` /
`remoteControlEnabled=false`. Relay strictly per-`user_id`; `task:join` DB-ownership-checked; bridge
JWT short-lived. No browser↔VS Code direct path.

## Status — 2026-06-20: COMPLETE (pending manual e2e)

All five implementation phases landed and verified:

- **Protocol** — `packages/types/src/cloud.ts`: extended `TaskBridgeCommand` with
  `stop_task` / `set_auto_approval` / `resume_task`; added `instance_state` event payload.
- **Backend** — `python-socketio` AsyncServer mounted as ASGI sub-app at `/bridge`
  (not wrapping `app`, to preserve `dependency_overrides`); handshake auth (extension
  JWT + browser `tumble_session` cookie → same `user_id`); in-memory instance registry
  (newest-wins per user); `task:join` DB ownership check; `task:command`→extension relay;
  `task:event` Message→`task:{id}` room relay + idempotent `TaskMessage` upsert by ts.
  `bridge_service`/`/api/extension/bridge/config` rewired; `bridge_enabled`/`bridge_path` settings.
- **Extension** — `@roo-code/cloud` `BridgeOrchestrator` + `dispatchBridgeCommand` (structural
  `BridgeProvider`/`BridgeTask` interfaces, no runtime dep on host `src/`); `socket.io-client`
  dep; `src/extension/bridge.ts` adapter wired in `extension.ts`, gated on opt-in
  `tumble-code.remoteControlEnabled` (default false) + cloud auth; reconciles on toggle/sign-in.
- **Web** — `task_detail.html` `{% if live %}` surface (header: tokens in/out, context n/window,
  cost, mode; ask-bar Approve/Deny; auto-approve bar: enabled + mode select + 6 toggles; chat
  input + Send/Stop/Resume); `render.js` refactored into a `mountConversation` upsert-by-ts
  controller; `live.js` socket controller; vendored `socket.io.min.js` (v4.8.3). Owner route live
  (gated on `bridge_enabled`), `/shared` always read-only.

### Verification

- Backend: `uv run pytest` → **51 passed** (18 in `test_bridge.py`; 2 new web live-control
  regression tests asserting owner page ships `#live-controls`/`#live-config`/`live.js` and
  `/shared` never does, even with the bridge enabled).
- Extension: `@roo-code/cloud` vitest → 278 passed (incl. 14 bridge tests); tsc + eslint
  (`--max-warnings=0`) clean for the bridge sources.
- **Pending: manual e2e** (needs real Authentik + extension) — enable the setting, drive a task
  from the web (message, Approve/Deny, flip auto-approve, watch tokens/context, Stop, Resume).

### 2026-06-21: bridge ungated at the backend

`BRIDGE_ENABLED=true` is now the shipped default (`.env` + `.env.example`); the socket.io relay is
always mounted and the owner web page is always live. The **extension** still requires the opt-in
`tumble-code.remoteControlEnabled` toggle AND an authenticated cloud session before it connects —
remote control of the dev machine stays user-initiated.
