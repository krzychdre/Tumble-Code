# Port plan — Zoo PR #483 → `feature/zoo-483-multiline-quoted-command-parsing`

> **For the executor (read first).** Do the steps **in order**. Do **not**
> improvise or hand-edit the parser — this port lands as a verified-clean
> `git apply` of the upstream diff with a single file excluded. If any
> `git apply --check` reports a conflict, **STOP and report** — do not force it
> or hand-merge. This repo is **Tumble Code**: never introduce the strings "Roo"
> or "Zoo" in user-facing text.

---

## 0. Context (read once, write no code)

- **Upstream:** Zoo PR #483 — "fix(commands): correct multi-line quoted command parsing, auto-approval, and malformed-command error surfacing" (commit `d7bc9f687`).
- **What it does, one paragraph:** Our shared command parser [parse-command.ts](src/shared/parse-command.ts)
  splits on every newline _before_ any quote handling, so newlines inside a
  quoted argument (e.g. a multi-line script in `sh -c '…'`), inside a heredoc
  body, or inside an unterminated quote are wrongly treated as separate
  sub-commands. That defeats allowlist auto-approval and produces noisy,
  spurious entries in the command-pattern breakdown UI. This PR rewrites the
  parser to mask quoted regions (single / double / ANSI-C `$'…'` / locale
  `$"…"` / heredocs / herestrings) via a single `scanTopLevelQuotes` state
  machine before splitting, detects unterminated quotes/heredocs as shell syntax
  errors, and changes `parseCommand`'s return type from `string[]` to
  `ParseResult { commands: string[]; parseError: UnterminatedQuote | null }`.
  Callers (`getCommandDecision`, `ExecuteCommandTool`, the webview
  `CommandExecution` card and `extractPatternsFromCommand`) are updated to read
  the new shape; a new `malformed_command` decision and a CommandExecutionStatus
  `error` status surface the syntax error to the agent and the UI.
- **Why we want it, with evidence in OUR code:** [parse-command.ts:22-33](src/shared/parse-command.ts#L22-L33)
  — our `parseCommand` does `command.split(/\r\n|\r|\n/)` first, then
  `parseCommandLine` per line, so a quoted/heredoc newline splits one command
  into bogus sub-commands. [commands.ts:266](src/core/auto-approval/commands.ts#L266)
  consumes that split for auto-approval, so a fragment of a malformed command can
  be independently auto-approved today.
- **Verified before-state:** Our working tree matches upstream's pre-#483 state
  for **all 27 code/i18n files** — confirmed by `git apply --check` passing on
  the core group, the webview group, and the full diff minus the changeset.
- **What we deliberately leave out (YAGNI):** the changeset file
  `.changeset/fix-multiline-quoted-command-parsing.md` — it carries the
  `"zoo-code"` package id (Zoo branding) and is Zoo release-prep; our fork does
  not keep per-PR changesets. Excluded from the apply.
- **Original author — credit.** Andrew Schmeder. Commit trailer:

    ```text
    Co-authored-by: Andrew Schmeder <149117631+awschmeder@users.noreply.github.com>
    ```

## 1. Preconditions — verify before touching anything

- [ ] Current branch is `feature/zoo-483-multiline-quoted-command-parsing`, created off `main`.
- [ ] Working tree clean (`git status --short` empty).
- [ ] The Zoo clone exists at `/home/krzych/Projekty/QUB-IT/Zoo-Code`.

## 2. Regenerate the diff and confirm it applies (no code yet)

```bash
cd /home/krzych/Projekty/QUB-IT/Roo-Code
git -C /home/krzych/Projekty/QUB-IT/Zoo-Code show d7bc9f687 > /tmp/zoo-483.diff
git apply --check --exclude='.changeset/*' /tmp/zoo-483.diff && echo "APPLIES CLEANLY"
```

- **Expect:** `APPLIES CLEANLY`. If `git apply --check` prints any error, **STOP
  and report** — the before-state has drifted and this plan is stale.

## 3. Apply the diff (excluding the Zoo changeset)

```bash
cd /home/krzych/Projekty/QUB-IT/Roo-Code
git apply --exclude='.changeset/*' /tmp/zoo-483.diff
git status --short
```

- **Expect exactly these 28 files changed** (the 29th, `.changeset/…md`, is
  intentionally excluded): `packages/types/src/terminal.ts`,
  `src/core/auto-approval/commands.ts`,
  `src/core/auto-approval/__tests__/commands.spec.ts`,
  `src/core/tools/ExecuteCommandTool.ts`, `src/shared/parse-command.ts`,
  `src/shared/__tests__/parse-command.spec.ts`,
  `webview-ui/src/components/chat/CommandExecution.tsx`,
  `webview-ui/src/components/chat/__tests__/CommandExecution.spec.tsx`,
  `webview-ui/src/utils/command-parser.ts`,
  `webview-ui/src/utils/__tests__/command-parser.spec.ts`, and the 18 i18n
  `chat.json` files (`en` + 17 locales).
- If `git status` shows the `.changeset` file, delete it:
  `rm -f .changeset/fix-multiline-quoted-command-parsing.md`.

## 4. Out of scope — do NOT do these

- Do **not** keep the `.changeset/fix-multiline-quoted-command-parsing.md` file
  (contains `"zoo-code"`; Zoo release-prep).
- Do **not** hand-edit the parser or "improve" the applied code.
- Do **not** re-add or re-wire: **TTS**, the **router / cloud provider**, **cloud
  upsell** UI, or **Roo/Zoo branding**.
- Do **not** rename internal ids (those stay `Roo-Code`).

## 5. Verify — paste real output, don't claim success without it

Run from the repo root:

- `cd src && npx vitest run shared/__tests__/parse-command.spec.ts` → all pass.
- `cd src && npx vitest run core/auto-approval/__tests__/commands.spec.ts` → all pass.
- `cd src && pnpm check-types` → clean.
- `cd webview-ui && npx vitest run src/utils/__tests__/command-parser.spec.ts src/components/chat/__tests__/CommandExecution.spec.tsx` → all pass.
- `cd webview-ui && npx vitest run` is overkill; the two suites above cover the change.

## 6. Acceptance criteria (binary — all must hold)

- [ ] `parse-command.spec.ts`, `commands.spec.ts`, `command-parser.spec.ts`,
      `CommandExecution.spec.tsx` all green.
- [ ] `pnpm check-types` clean (the `parseCommand` return-type change touches
      `commands.ts`, `ExecuteCommandTool.ts`, `CommandExecution.tsx`,
      `command-parser.ts` — all updated by the diff).
- [ ] `git status` shows the 28 expected files (NOT the `.changeset` file).
- [ ] English i18n value is "Malformed command: shell syntax error"; no new
      "Roo"/"Zoo" strings; no removed feature reintroduced.

## 7. Record in the ledger

Already recorded by the orchestrator after the plan file is written. The commit
(done by the orchestrator) will carry:

```text
Co-authored-by: Andrew Schmeder <149117631+awschmeder@users.noreply.github.com>
```
