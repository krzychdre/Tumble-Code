# Plan: Bypass-Permissions & Autonomous auto-approval modes

Date: 2026-06-08
Branch: `feat/bypass-permissions-modes`

## Goal

Evolve the existing "all auto-approves on" state (today surfaced as the **BRRR**
trigger label) into an explicit, tiered auto-approval **mode** with two new
override levels on top of the granular per-action toggles:

- **Mode 1 — Bypass permissions** (semi-auto): no interactive wait on any of
  read / mcp / subtask / write / mode-switch / run (execute) — **even for unknown
  commands** (i.e. ignore the allowlist, outside-workspace, and protected-file
  guards). Follow-up **questions still interrupt** the user. The six affected
  toggle buttons in the auto-approve dropdown turn **orange** to signal the
  danger state.
- **Mode 2 — Autonomous** (full auto): everything Bypass does **plus** follow-up
  questions are auto-answered so the agent runs until it finishes without any
  interaction. All seven toggle buttons turn orange.

Use case: put Tumble in semi-auto (only questions interrupt) or fully autonomous.

## Decisions (confirmed with user)

1. **UI surface**: a `Default / Bypass / Autonomous` segmented selector inside the
   existing Auto-Approve dropdown (modes are mutually-exclusive tiers).
2. **Orange scope**: only the auto-approve **toggle buttons** in the dropdown turn
   orange (not the trigger, not the in-chat Approve/Run buttons).
    - Bypass → orange for all keys **except** `alwaysAllowFollowupQuestions`.
    - Autonomous → orange for **all** keys.
3. **Rate limits**: keep them. `allowedMaxRequests` / `allowedMaxCost` still pause
   the agent. Bypass only removes per-action prompts, not the global budget guard.
   (No change to `AutoApprovalHandler` / `TaskApiLoop` limit path.)
4. **Autonomous follow-up with no suggestions**: always proceed — auto-answer with
   the first suggestion if present, otherwise respond with empty text to continue.

## Key facts established by code reading

- "BRRR" is just the trigger label when all toggles are enabled
  (`webview-ui/src/i18n/locales/en/chat.json:367 triggerLabelAll`). No literal
  "BRRR" feature/setting exists.
- `checkAutoApproval()` (`src/core/auto-approval/index.ts`) is called for **every**
  `ClineAsk` in `TaskAskSay.ask()` (`src/core/task/TaskAskSay.ts:245`). Asks it
  doesn't explicitly handle fall through to `return { decision: "ask" }`.
  → **Critical**: bypass/autonomous must only force-approve the _interactive
  permission_ asks (`command`, `tool`, `use_mcp_server`) plus `followup` for
  autonomous. It must **never** blanket-approve, or it would auto-retry
  `api_req_failed`, auto-resume `resume_task`, and silence `mistake_limit_reached`.
- The follow-up auto-answer reuses the existing `{ decision: "timeout", timeout, fn }`
  mechanism (`TaskAskSay.ts:251-258`), honoring `followupAutoApproveTimeoutMs`.
- Settings persist generically via `updateSettings` →
  `contextProxy.setValue(key, ...)` (`webviewMessageHandler.ts:758`). Adding the
  key to the schema is enough to persist; `getState()` must echo it back.
- No i18n key-parity test exists; adding keys to `en` only is safe.

## State model

New global setting (`packages/types/src/global-settings.ts`):

```ts
export const autoApprovalModes = ["default", "bypass", "autonomous"] as const
export type AutoApprovalMode = (typeof autoApprovalModes)[number]
// in globalSettingsSchema:
autoApprovalMode: z.enum(autoApprovalModes).optional(),
```

Master `autoApprovalEnabled` remains the kill-switch: if it's off, everything
prompts regardless of mode. Selecting Bypass/Autonomous in the UI auto-enables it.

## Files to change

1. `packages/types/src/global-settings.ts` — add `autoApprovalModes`,
   `AutoApprovalMode`, and `autoApprovalMode` schema field.
2. `src/core/auto-approval/index.ts` — add `"autoApprovalMode"` to
   `AutoApprovalStateOptions`; add mode-override branch (see logic below).
3. `src/core/webview/ClineProvider.ts` — echo `autoApprovalMode ?? "default"` in
   both `getState`/`getStateToPostToWebview` return blocks.
4. `webview-ui/src/context/ExtensionStateContext.tsx` — type field + default
   (`autoApprovalMode: "default"`) + `setAutoApprovalMode` setter.
5. `webview-ui/src/components/settings/AutoApproveModeSelector.tsx` — **new**
   reusable 3-way segmented selector.
6. `webview-ui/src/components/chat/AutoApproveDropdown.tsx` — render selector;
   orange toggle buttons per the rule; auto-enable master toggle when a mode is
   picked.
7. `webview-ui/src/components/settings/AutoApproveToggle.tsx` — optional `mode`
   prop → orange styling on the settings-page toggle row for parity.
8. `webview-ui/src/components/settings/AutoApproveSettings.tsx` — render the
   selector and pass `mode` to `AutoApproveToggle`.
9. `webview-ui/src/i18n/locales/en/chat.json` & `settings.json` — mode labels +
   descriptions.
10. `src/core/auto-approval/__tests__/index.spec.ts` (or existing spec) — unit
    tests for bypass/autonomous decisions.

## Core decision logic (index.ts)

Inserted after the `autoApprovalEnabled` guard, before the per-ask blocks:

```ts
const mode = state.autoApprovalMode ?? "default"
if (mode === "bypass" || mode === "autonomous") {
	if (ask === "command" || ask === "tool" || ask === "use_mcp_server") {
		return { decision: "approve" } // ignores allowlist / outside-ws / protected
	}
	if (ask === "followup") {
		if (mode === "autonomous") {
			let answer: string | undefined
			try {
				answer = (JSON.parse(text || "{}") as FollowUpData).suggest?.[0]?.answer
			} catch {}
			const timeout =
				typeof state.followupAutoApproveTimeoutMs === "number" && state.followupAutoApproveTimeoutMs > 0
					? state.followupAutoApproveTimeoutMs
					: 0
			return { decision: "timeout", timeout, fn: () => ({ askResponse: "messageResponse", text: answer ?? "" }) }
		}
		return { decision: "ask" } // bypass: questions still interrupt
	}
	// all other asks (api_req_failed, resume_*, mistake_limit_reached, ...) fall
	// through to the default handling below → returns "ask".
}
```

## Orange styling rule (UI)

```ts
const isModeForced = (key: AutoApproveSetting) =>
	autoApprovalMode === "autonomous" || (autoApprovalMode === "bypass" && key !== "alwaysAllowFollowupQuestions")
```

Forced buttons render with `!bg-orange-600 hover:!bg-orange-600 !text-white
!border-orange-600 !opacity-100` and are shown active. While a mode is active the
granular toggles are display-only (the mode overrides them); switching to Default
restores the user's granular choices, which are left untouched underneath.

## Verification

- `cd src && npx vitest run core/auto-approval` (new + existing decision tests).
- Type-check: `pnpm -C webview-ui tsc --noEmit` and `pnpm -C src tsc --noEmit`
  (or repo's `pnpm check-types`).
- Manual: pick Bypass → run an unknown shell command (no prompt), ask_followup
  (still prompts). Pick Autonomous → followup auto-answers. Toggle "Enabled" off →
  everything prompts again. Verify orange coloring matches the rule.

## Notes / tradeoffs

- Autonomous reuses `followupAutoApproveTimeoutMs` (default 60s) so the user keeps
  an intervention window; set it to 0 in settings for instant answers.
- Empty-text follow-up answers (no suggestions) may cause the model to re-ask;
  accepted per the "always proceed / maximum autonomy" choice.

## Follow-up: main-screen trigger box reflects the mode (2026-06-09)

The chat-screen auto-approve trigger box (`AutoApproveDropdown` `PopoverTrigger`)
now mirrors the active mode instead of always showing "x auto-approved":

- **Icon** is mode-consistent with the selector: `ShieldCheck` (default, enabled),
  `ShieldAlert` (bypass), `Zap` (autonomous), `X` (auto-approval off). Replaces the
  old `CheckCheck`/`X` pair.
- **Border** turns orange (`!border-orange-600` + `text-orange-500`) whenever a
  non-default mode is active; default keeps the subtle white border. Hover
  border-lightening is suppressed while orange so it doesn't fight the accent.
- **Label** reads `Bypass` / `Autonomous` (from `chat:autoApprove.mode.*.label`)
  instead of the count; default still shows the count / "all" / "off" text.
- **Tooltip** shows the mode description when bypass/autonomous is active.

"Active" is gated on `effectiveAutoApprovalEnabled` — turning the master switch off
reverts the box to the plain off state regardless of selected mode. No new strings
needed (reuses existing `mode.*` keys).
