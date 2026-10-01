# Fix: finished task shows an empty live summary bar (tokens / context / cost = "—")

Date: 2026-06-21
Branch: feature/self-hosted-remote-task-control

## Symptom

Owner opens a task that has already finished in the web cockpit. The header pill
shows **LIVE** (extension is online) but every stat is blank:

```
LIVE   mode —   tokens — in / — out   context —   cost —
```

## Root cause (traced, not guessed)

The header fields (`#hdr-mode`, `#hdr-tokens-in/out`, `#hdr-context`, `#hdr-cost`)
are populated **exclusively** by `applyInstanceState()` in
`self-hosted-cloudapi/src/web/static/live.js`. That runs only when a live
`instanceState` snapshot arrives:

1. on `task:join` if the registry has a cached `instance`, or
2. on a relayed `task:relayed_event` of type `instanceState`.

The cached instance (`src/realtime/hub.py`) is **per-user, in-memory** and:

- is initialised to just `{lastHeartbeat}` on `register_extension` — the
  extension's `register()` (`packages/cloud/src/bridge/BridgeOrchestrator.ts`)
  sends no token/mode payload;
- is updated only when the extension pushes `instanceState`, which it does **only**
  on `TaskModeSwitched`, `TaskTokenUsageUpdated`, `TaskAskResponded`,
  `TaskInteractive`;
- is **wiped on extension disconnect** (`hub.py` `detach()`), so any reconnect
  (server restart, network blip, new VS Code window) clears it;
- even when present, `snapshot()` reads `provider.getCurrentTask()` — the task
  _currently active_ in VS Code, not the finished task being viewed.

For a **finished** task none of those state events fire, so the header never gets
data. But every number it needs is already embedded in the page: each persisted
`api_req_started` message carries `tokensIn`, `tokensOut`, `cost`
(`render.js` `apiReq()`), and the canonical aggregation is
`packages/core/src/message-utils/consolidateTokenUsage.ts`:

- totals = sum of `tokensIn` / `tokensOut` / `cost` over `api_req_started`
  (+ `condense_context.cost`);
- `contextTokens` = `tokensIn + tokensOut` of the **last** `api_req_started`
  (or `condense_context.newContextTokens`).

The header simply never reads the conversation it is sitting next to.

## Fix

Derive tokens/cost/context from the persisted messages as a baseline, and keep
them fresh from the live message stream; let live `instanceState` override while
the task is actually running.

1. `render.js` — `mountConversation`:

    - keep the latest raw message per `ts` (`rawByTs`);
    - add `getMetrics()` mirroring `consolidateTokenUsage`
      (totals + last-request `contextTokens`);
    - expose `getMetrics` on the returned conversation object.

2. `live.js`:
    - add `applyMetrics()` that fills tokens/out, cost, context from
      `convo.getMetrics()`, gated by `haveLiveTokens` so it never fights a live
      `instanceState`;
    - track `lastContextWindow` (live-only) to render the "/ window" suffix when known;
    - in `applyInstanceState`, set `haveLiveTokens = true` once a snapshot carries
      token data, and capture `contextWindow`;
    - call `applyMetrics()` on init (baseline for finished/offline tasks) and after
      each relayed `message` event (keeps totals live from the message stream).

`mode` and `contextWindow` stay live-only — they are genuinely not in the
persisted conversation, so a finished task shows `mode —` (honest) rather than a
fabricated value.

## Scope / non-goals

- No backend change. The persisted messages already contain everything needed.
- Not changing the registry lifecycle (per-user snapshot, wipe-on-disconnect) —
  that is correct for the _live control_ path; this fix just stops the header from
  depending on it for _historical_ totals.

## Verification

- Open a finished owned task → tokens/context/cost populate from history; mode `—`.
- Run/resume a task → live `instanceState` token updates take over (unchanged).
- Read-only `/shared` view is unaffected (header block is `{% if live %}` only).
