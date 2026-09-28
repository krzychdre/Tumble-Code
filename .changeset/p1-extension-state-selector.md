---
"tumble-code": patch
---

Performance: `useExtensionSelector` — streamed tokens no longer re-render every extension-state consumer.

Every streamed token used to rebuild the `ExtensionStateContext` value (a fresh object with ~25 fresh action closures) and re-render all ~45 consumers, including settings-only components. The provider now backs the same pure reducer with a versioned external store: the value is rebuilt once per committed change, the action identities are stable for the provider's lifetime, and the new `useExtensionSelector(selector, isEqual?)` hook (built on `useSyncExternalStore`) lets a component subscribe to a slice and skip re-renders when that slice is unchanged. `useExtensionState()` keeps working unchanged for the remaining consumers. Profiler harness (200 simulated tokens): settings-only consumers went from 202 renders to 2 (−99%); messages consumers still see every token. Hot path migrated: App, TranslationProvider, ChatView, ChatTextArea, TaskHeader (its all-messages scan now runs once per store commit instead of per render), AutoApproveDropdown, ModeSelector, row renderers, and ~20 more. See `ai_plans/2026-09-28_p1-extension-state-selector.md` for the design and before/after tables.
