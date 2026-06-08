# Ask mode: eager web search via MCP

**Date:** 2026-06-08
**Branch:** `feature/ask-mode-eager-websearch` (stacked on `rebrand/built-in-mode-personas`)

## Goal

Make the built-in **ask** mode eager to use web search / web scraping when such a tool is
available, so answers about current/after-cutoff topics are grounded in fresh sources rather
than stale model memory.

## Key finding (why this is prompt-only)

There is **no native web-search tool** in the codebase — web search/scraping reaches the model
exclusively through user-configured **MCP servers**. Ask mode already has `groups: ["read", "mcp"]`,
so MCP tools are already injected into its prompt, and the CAPABILITIES / MCP-tools sections
already advertise whatever servers are connected (filtered by the per-mode allowlist from
Zoo #453). Therefore the only change needed is to the mode's `customInstructions` — encouraging
the model to _reach for_ those tools. No wiring, no new tool, no plumbing.

Source of truth: ask mode in `DEFAULT_MODES`,
[packages/types/src/mode.ts](../packages/types/src/mode.ts).

## Change

Rewrote ask `customInstructions` to add an eager-web-search directive. Designed for weak models
([[feedback_design_for_weak_models]]): concrete triggers + explicit action + graceful fallback,
not a vague "use tools when helpful".

- **Conditional**, not assumed: "When an MCP server that provides web search or web page
  fetching/scraping is connected…". A model with no such server must not hallucinate a tool —
  the fallback clause tells it to answer from knowledge and flag staleness.
- **Concrete triggers**: current events, recent releases, library/API versions, third-party
  docs, anything after the training cutoff or low-confidence. Enumerated so a weak model has a
  checklist rather than a judgement call.
- **Cite sources** after searching.
- Preserved the original behavioral guarantees: thorough answers, no auto-switch to coding,
  Mermaid diagrams when they clarify.

## Stacking note

Stacked on `rebrand/built-in-mode-personas` because both branches edit the same ask-mode object
in `mode.ts` ([[feedback_separate_branch_per_feature]] — one branch per functionality, stacked
when files overlap). The rebrand branch already changed ask's `roleDefinition` to
"You are Tumble, …"; this branch only touches `customInstructions`.

## Validation

- `npx vitest run core/prompts/__tests__ shared/__tests__/modes.spec.ts -u` → 130 passed;
  1 snapshot regenerated (`add-custom-instructions/ask-mode-prompt.snap`).
- No test asserts the old `customInstructions` literal beyond the regenerated snapshot.

## Possible follow-ups

- Optionally pin ask mode's `allowedMcpServers` to web-capable servers only (uses the Zoo #453
  per-mode allowlist) — left to user config, not hardcoded.
- Same eager-search directive could be applied to other modes if desired.
