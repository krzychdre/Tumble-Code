# R4 follow-up: code-index config checks (openai-compatible descriptor, restart rule 1)

**Status:** Done.

**Related plans:** `ai_plans/2026-10-23_17-20_maintenance-audit-round-4.md` (section "Follow-ups found during
execution").

## Touched files

- `src/services/code-index/embedders/descriptors.ts`
- `src/services/code-index/__tests__/service-factory.spec.ts`
- `src/services/code-index/__tests__/config-manager.spec.ts`

## Problem

1. The openai-compatible descriptor checked the base URL and the key twice: `read` returns options only when both
   are set, and `isConfigured` tested both fields again.
2. `doesConfigChangeRequireRestart` rule 1 (not ready before, enabled and configured now) looked reachable through
   the later field comparisons, and no spec failed when it was deleted (706 code-index specs green without it).

## Change

1. `isConfigured` is `!!options`; `read` keeps the one check. The options come only from `read`
   (`CodeIndexConfigManager` builds them, nothing else constructs `openAiCompatibleOptions`).
2. Rule 1 is not redundant. Its "was not configured" half is covered by the later checks (a move from unconfigured to
   configured changes the provider, an embedder field or the Qdrant URL), but its "was disabled" half is not: turning
   indexing on for a profile that was already complete changes no field, and only rule 1 restarts indexing then.
   Rule 1 stays; a spec now pins that case.

## Tests

- `config-manager.spec.ts`: "enabling an already configured index and nothing else" restarts (the snapshot says
  `enabled: false, configured: true`). Mutation: deleting rule 1 turns it red, and only it.
- The URL and key checks keep their coverage in the `isConfigured` table of `config-manager.spec.ts` ("without a base
  URL", "without a key"), which goes through `read`. Mutations: `read` without the URL check or without the key check
  turns one case red each.
- Removed from `service-factory.spec.ts`: the two cases that handed the factory an option group with a missing URL
  or key. That state cannot come out of `read`; the factory case with no option group stays.
