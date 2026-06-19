# Port plan — Zoo PR #442 → `feature/zoo-442-resolve-relative-symlinks-in-rules`

> **For the executor (read first).** Do the steps **in order**. This port lands
> as a verified-clean `git apply` of the upstream diff — **no hand-edits, no
> rebrand needed** (the diff carries no user-facing strings). If any
> `git apply --check` reports a conflict, **STOP and report** — do not force it.
> This repo is **Tumble Code**: never introduce the strings "Roo" or "Zoo" in
> user-facing text (the `.roo` directory is an internal id and stays as-is).

---

## 0. Context (read once, write no code)

- **Upstream:** Zoo PR #442 — "fix: resolve relative symlinks in rules files using realpath of parent directory" (commit `4c91a8f24`).
- **What it does, one paragraph:** `resolveSymLink` in
  [custom-instructions.ts](src/core/prompts/sections/custom-instructions.ts)
  resolves a rules-file symlink's target with
  `path.resolve(path.dirname(symlinkPath), linkTarget)`. When the `.roo/rules`
  directory is itself a symlink to an external directory and a file inside is a
  **relative** symlink (e.g. `../1-project.txt`), the OS resolves that relative
  target against the symlink's **real** location, but our code resolves it against
  the **access path** — pointing at the wrong file (or nothing). The fix calls
  `fs.realpath()` on the symlink's parent directory first, then resolves the
  relative target against that real path, matching OS semantics. `fs.realpath`
  failures fall back to the non-realpath'd dir, so non-symlinked setups are
  unaffected.
- **Why we want it, with evidence in OUR code:**
  [custom-instructions.ts:84-88](src/core/prompts/sections/custom-instructions.ts#L84-L88)
  in our tree still does the old `path.resolve(path.dirname(symlinkPath), linkTarget)`
  with no realpath step, so the bug reproduces here for symlinked `.roo/rules`
  dirs with relative inner symlinks.
- **What we deliberately leave out (YAGNI):** nothing — the diff is exactly the
  fix plus its test; both files exist and apply cleanly.
- **Original author — credit.** Povilas Kanapickas. Commit trailer:

    ```text
    Co-authored-by: Povilas Kanapickas <povilas@radix.lt>
    ```

## 1. Preconditions — verify before touching anything

- [ ] Current branch is `feature/zoo-442-resolve-relative-symlinks-in-rules`, created off `main`.
- [ ] Working tree clean (`git status --short` empty).
- [ ] These files exist: `src/core/prompts/sections/custom-instructions.ts`,
      `src/core/prompts/sections/__tests__/custom-instructions.spec.ts`.

## 2. Regenerate the diff and confirm it applies (no code yet)

```bash
cd /home/krzych/Projekty/QUB-IT/Roo-Code
git -C /home/krzych/Projekty/QUB-IT/Zoo-Code show 4c91a8f24 > /tmp/zoo-442.diff
git apply --check /tmp/zoo-442.diff && echo "APPLIES CLEANLY"
```

- **Expect:** `APPLIES CLEANLY`. If it prints any error, **STOP and report** — the
  before-state has drifted and this plan is stale.

## 3. Apply the diff

```bash
cd /home/krzych/Projekty/QUB-IT/Roo-Code
git apply /tmp/zoo-442.diff
git status --short
```

- **Expect exactly these 2 files changed:**
  `src/core/prompts/sections/custom-instructions.ts`,
  `src/core/prompts/sections/__tests__/custom-instructions.spec.ts`.

## 4. Out of scope — do NOT do these

- Do **not** hand-edit the fix or "improve" the realpath logic.
- Do **not** rename `.roo` → `.tumble` or touch any internal id (those stay).
- Do **not** re-add or re-wire: **TTS**, the **router / cloud provider**, **cloud
  upsell** UI, or **Roo/Zoo branding**.

## 5. Verify — paste real output, don't claim success without it

```bash
cd /home/krzych/Projekty/QUB-IT/Roo-Code/src && npx vitest run core/prompts/sections/__tests__/custom-instructions.spec.ts
cd /home/krzych/Projekty/QUB-IT/Roo-Code/src && pnpm check-types
```

## 6. Acceptance criteria (binary — all must hold)

- [ ] `custom-instructions.spec.ts` (incl. the new realpath/symlink describe) green.
- [ ] `check-types` clean.
- [ ] `git status` shows exactly the 2 expected files.
- [ ] `resolveSymLink` now calls `fs.realpath(symlinkDir)` (with try/catch fallback)
      before `path.resolve(realSymlinkDir, linkTarget)`.

## 7. Record in the ledger

Already recorded by the orchestrator after the plan file is written. The commit
(done by the orchestrator) will carry:

```text
Co-authored-by: Povilas Kanapickas <povilas@radix.lt>
```
