# Rename the CamelCase "RooCode" to "TumbleCode" everywhere

Date: 2026-10-02
Branch: `fix/rename-roocode-to-tumblecode` (stacked on `fix/remove-upstream-roo-links`)

Owner, 2026-10-02: "Nie możemy już używać RooCode. Wszędzie powinno to być zmienione jako TumbleCode".

## Change

Every tracked file outside the allow-list below, mechanically, in this order:

1. `migrateFromRooCode` -> `migrateFromRooCline` (function and both files). `roo-cline` is the
   old extension's id; "migrateFromTumbleCode" would invert the meaning.
2. `https://github.com/RooCodeInc/Roo-Code/(issues|pull)/N` in comments -> `upstream issue/PR #N`.
3. `RooCodeInc/Roo-Code` (test data, roomodes schema `$id`) -> `krzychdre/Tumble-Code`.
4. `RooCode` -> `TumbleCode`, `rooCode` -> `tumbleCode`, `roocode` -> `tumblecode`:
   types (`TumbleCodeEventName`, `TumbleCodeSettings`, `TumbleCodeAPI`, ...), cloud URL helpers
   (`getTumbleCodeApiUrl`, ...), `User-Agent: TumbleCode/<v>`, Bedrock `userAgentAppId:
TumbleCode#<v>`, abort messages `[TumbleCode#ask]`, the webview `tumblecode://settings` link.

Hand fixes where the mechanical rename inverted the meaning: the two guard regexes that assert
the old name is absent (now `/Roo ?Code|roo-cline/i`, `/roo-?code|.../i`), the installer test
comment and the CLI changeset (both said "upstream" about the fork after the rename).

Runtime values that change: the `User-Agent` / Bedrock app id sent to providers and the text
of internal abort errors. Nothing matches either by content. No persisted key changes.

## Allow-list (guarded by `src/__tests__/no-old-product-name.spec.ts`)

- `tumble-code.migrationFromRooCodeCompleted` in `migrateFromRooCline.ts` (+ spec): the
  globalState flag on users' machines; renaming it re-runs the import, which prompts again and
  copies the old extension's globalStorage over the current task history.
- `ai_plans/`, `CHANGELOG.md` (history), `README.md`, `CONTRIBUTING.md` (lineage/attribution
  links to the upstream repo and docs), `.git-blame-ignore-revs` (upstream PR reference).
  Pending the owner's decision.

Not in scope of this branch: the other spellings `Roo Code`, `roo-code` (`@roo-code/*`
packages), `ROO_CODE_*` env vars, `Roo-Code`.
