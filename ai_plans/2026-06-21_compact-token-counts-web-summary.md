# Compact token counts in cloud web task summary

**Date:** 2026-06-21
**Branch:** feature/self-hosted-remote-task-control

## Problem

The task summary header shows raw token counts (`96 941`, `3365`, `29 385`, `1 000 000`)
for tokens in/out and context used. Large numbers are hard to scan; the user wants
human-readable abbreviations (M for millions, k for thousands).

## Root cause / location

All three header values — `hdr-tokens-in`, `hdr-tokens-out`, `hdr-context` — are
formatted through a single helper `fmt()` in
[self-hosted-cloudapi/src/web/static/live.js](../self-hosted-cloudapi/src/web/static/live.js#L52),
used by both the persisted-metrics path (`updateFromConversation`) and the live
snapshot path. It previously called `Number(n).toLocaleString()`. Cost is rendered
by a separate formatter, so it is unaffected.

## Fix

Replace `fmt()` body with a compact formatter:

- `>= 1e9` → `B`, `>= 1e6` → `M`, `>= 1e3` → `k`, one decimal, trailing `.0` stripped.
- `< 1000` → plain integer string.
- `null` / non-finite → `—` (unchanged).

Examples: `1 000 000 → 1M`, `96 941 → 96.9k`, `3365 → 3.4k`, `29 385 → 29.4k`.

## Scope

Single-function change, no markup/CSS changes (the `/` separator for
`context / window` is built outside `fmt`, so `29.4k / 1M` renders correctly).
