# A Marketplace item that installs a set of modes (Konsylium)

**Status:** done on `feat/marketplace-mode-sets`
**Related:** `ai_plans/2026-10-30_23-25_mode-request-budget.md` (the `maxRequests` budgets the council modes use)
**Touched:** `src/services/marketplace/SimpleInstaller.ts`, its spec, `marketplace-files.spec.ts`,
`marketplace/README.md`, new `marketplace/modes/konsylium.yaml`

## Goal

Konsylium is three modes that only work together: the chair `konsylium` runs `konsylium-odkrywca` (explorer) and
`konsylium-weryfikator` (verifier) with `run_parallel_tasks`. Installing the chair alone gives a mode that calls modes
which do not exist, so the Marketplace has to install and remove all three as one item.

## Change

- A mode item's `content` is either one mode or a YAML list of modes. `parseModeContent` in `SimpleInstaller` turns
  both into a list; install imports the whole list in one `importModeWithRules` call and opens the file at the first
  mode's slug; remove checks every slug first, then deletes each mode.
- The installed check is unchanged: it looks for a mode whose slug equals the item id, so the first mode of a set
  carries the item id (`konsylium`).
- `marketplace/modes/konsylium.yaml` holds the three modes as they are in the owner's global `custom_modes.yaml`
  (without `source`). Its prerequisites name the parallel-subagents setting, the two different models and the
  release that knows `maxRequests` and sets.

## Tests

`SimpleInstaller.spec.ts`: a set installs every mode and points at the first; a set removes every mode; a set with a
mode without a slug removes nothing. `marketplace-files.spec.ts` validates every mode of a set and the first slug.
Mutations (remove only the first mode, parse the list as one mode) turned tests red.

## Notes

- A version up to 1.2.0 wraps the list in another list and rejects it as an invalid mode, so the item fails to
  install there with an error; nothing is written.
- The Marketplace reads `marketplace/` from `main`, so the item is listed as soon as this branch is merged.
