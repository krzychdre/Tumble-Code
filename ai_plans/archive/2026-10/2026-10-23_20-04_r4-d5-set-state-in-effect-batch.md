# R4 D5: first set-state-in-effect batch (prop-sync effects)

**Status:** done

**Related plans:** [maintenance audit round 4](2026-10-23_17-20_maintenance-audit-round-4.md), item D5.

## Touched files

- `webview-ui/src/components/chat/ReasoningBlock.tsx`, `webview-ui/src/components/settings/TemperatureControl.tsx`,
  `webview-ui/src/components/settings/providers/Bedrock.tsx`, `webview-ui/src/components/chat/ContextMenu.tsx`
- `webview-ui/src/components/chat/__tests__/ReasoningBlock.spec.tsx`

## Problem

`react-hooks/set-state-in-effect` is the one compiler rule still off (39 findings after the five rules came back).
The simplest kind copies a prop or setting into local state in an effect, which renders once with the old value
and then again.

## Change

- ReasoningBlock, TemperatureControl and Bedrock keep the last prop value they applied in state and reset their
  local state during render when the prop changes (the React "adjust state on prop change" pattern), instead of an
  effect. TemperatureControl's initial "custom temperature" flag now treats `null` like the effect did.
- ContextMenu reads `MATERIAL_ICONS_BASE_URI` in the state initializer instead of an on-mount effect.
- The rule stays off: 35 findings remain, each needing its own look (async results, timers, host messages).

## Tests

- New ReasoningBlock case: a changed collapse setting resets a block the user toggled (red without the reset).
- TemperatureControl profile-switch spec and Bedrock spec go red when their reset is removed.
- ReasoningBlock, TemperatureControl, Bedrock, ContextMenu, ChatTextArea and ApiOptions specs green; tsc, eslint and
  the bailout check (2 known) pass.
