# Port plan — Zoo PR #558 → `feature/zoo-558-list-files-check-cwd`

> **For the executor (read first).** Do the steps **in order**. Do **not**
> improvise, refactor beyond what is written, or add anything not listed
> (YAGNI). Every code block below is **already adapted to this repo** — paste it
> as-is unless a step says otherwise. If any precondition is false or a step
> doesn't behave as described, **STOP and report** — do not guess. This repo is
> **Tumble Code**: never introduce the strings "Roo" or "Zoo" in user-facing
> text. Placeholders are written as `{{like this}}` — replace every one.

---

## 0. Context (read once, write no code)

- **Upstream:** Zoo PR #558 — "fix(list-files): checking cwd before invoking rg" (commit `991130a5c`).
- **What it does, one paragraph:** Before invoking the ripgrep binary, `listFiles()` now checks whether the target directory actually exists on disk. If it does not, a clear error is thrown (`"Cannot list files: directory does not exist: <path>"`) instead of allowing the downstream `child_process.spawn(rg, ...)` call to fail with a confusing ENOENT that names the ripgrep executable rather than the missing directory.
- **Why we want it, with evidence in OUR code:** In our `src/services/glob/list-files.ts`, the `listFiles` function (line 33) proceeds directly to `getRipgrepPath()` (line 47) and then `listFilesWithRipgrep()` (lines 51, 60) which spawns `child_process.spawn(rgPath, ...)` at line 654. There is **no guard** between the early-return at line 36 and the special-directory handler at line 40. If a nonexistent path is passed, ripgrep is spawned against a missing directory and fails with an ENOENT error message that blames the ripgrep binary, not the absent directory. This is exactly the bug PR #558 fixes.
- **What we deliberately leave out (YAGNI):** None — this is a single-guard fix with accompanying tests.
- **Original author(s) — credit them.** edelauna. When you create the port commit (only if asked), include this trailer at the end of the commit message:

    ```text
    Co-authored-by: edelauna <54631123+edelauna@users.noreply.github.com>
    ```

## 1. Preconditions — verify before touching anything

- [ ] Current branch is `feature/zoo-558-list-files-check-cwd`, created off `main`.
- [ ] These files exist (the edits below depend on them):
    - `src/services/glob/list-files.ts`
    - `src/services/glob/__tests__/list-files.spec.ts`
    - `src/services/glob/__tests__/list-files-limit.spec.ts`
    - `src/services/roo-config/index.ts` (provides `directoryExists`)
- [ ] The code we will change still looks like this (quote it; if it differs,
      STOP — the plan is stale):

```ts
// src/services/glob/list-files.ts lines 33-48
export async function listFiles(dirPath: string, recursive: boolean, limit: number): Promise<[string[], boolean]> {
	// Early return for limit of 0 - no need to scan anything
	if (limit === 0) {
		return [[], false]
	}

	// Handle special directories
	const specialResult = await handleSpecialDirectories(dirPath)

	if (specialResult) {
		return specialResult
	}

	// Get ripgrep path
	const rgPath = await getRipgrepPath()
```

## 2. Write the failing test FIRST (TDD)

- **File:** `src/services/glob/__tests__/list-files.spec.ts`
- Add exactly this test (appended after the last existing describe block, before the final `}`):

```ts
describe("listFiles nonexistent directory", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		resetFsPromiseMocks()
	})

	it("should throw a clear error instead of a misleading ENOENT naming the executable", async () => {
		vi.mocked(directoryExists).mockResolvedValue(false)

		await expect(listFiles("/nonexistent/path", true, 100)).rejects.toThrow(
			"Cannot list files: directory does not exist:",
		)

		// spawn should never be called when the directory doesn't exist
		expect(vi.mocked(childProcess.spawn)).not.toHaveBeenCalled()
	})

	it("should report the missing directory even when ripgrep binary is also unavailable", async () => {
		vi.mocked(directoryExists).mockResolvedValue(false)
		const { getBinPath } = await import("../../ripgrep")
		vi.mocked(getBinPath).mockRejectedValue(new Error("Could not find ripgrep binary"))

		await expect(listFiles("/nonexistent/path", true, 100)).rejects.toThrow(
			"Cannot list files: directory does not exist:",
		)
	})
})
```

- Also add the `directoryExists` mock at the top of the file (after the existing `vi.mock("fs")` block), and import it:

Add near the top (after the imports, before the first `vi.mock`):

```ts
import { directoryExists } from "../../../services/roo-config"
```

Add this mock (after `vi.mock("fs")`):

```ts
vi.mock("../../../services/roo-config", () => ({
	directoryExists: vi.fn().mockResolvedValue(true),
}))
```

Add `stat` mock to the `fs.promises` mock object (inside the `vi.mock("fs", () => ({...}))`):

```ts
		stat: vi.fn().mockResolvedValue({ isDirectory: () => true }),
```

Add resets to `resetFsPromiseMocks()`:

```ts
vi.mocked(fs.promises.stat).mockReset()
vi.mocked(fs.promises.stat).mockResolvedValue({ isDirectory: () => true } as any)
vi.mocked(directoryExists).mockReset()
vi.mocked(directoryExists).mockResolvedValue(true)
```

- **Also update `src/services/glob/__tests__/list-files-limit.spec.ts`** — add the same `roo-config` mock:

```ts
vi.mock("../../../services/roo-config", () => ({
	directoryExists: vi.fn().mockResolvedValue(true),
}))
```

Add it after the `vi.mock("../../../utils/path", ...)` block (before the `import * as childProcess` line).

- **Run:** `cd src && npx vitest run services/glob/__tests__/list-files.spec.ts`
- **Expect it to FAIL** with: `TypeError: directoryExists is not a function` or a similar import/resolve error (because the function doesn't import `directoryExists` yet), OR the test assertion failure if it does import it but doesn't call it.
- If it **passes already**, STOP — the behavior is likely present; report back.

## 3. Implement — minimal change to make the test pass

Make only these edits. Each is explicit; do not touch anything else.

### Edit 1 — `src/services/glob/list-files.ts`

Add import (after the `getBinPath` import, line 8):

Replace:

```ts
import { getBinPath } from "../../services/ripgrep"
import { DIRS_TO_IGNORE } from "./constants"
```

With:

```ts
import { getBinPath } from "../../services/ripgrep"
import { directoryExists } from "../../services/roo-config"
import { DIRS_TO_IGNORE } from "./constants"
```

### Edit 2 — `src/services/glob/list-files.ts`

Add the cwd-existence guard (after the early return for limit === 0, before the special directories handler):

Replace:

```ts
// Early return for limit of 0 - no need to scan anything
if (limit === 0) {
	return [[], false]
}

// Handle special directories
```

With:

```ts
// Early return for limit of 0 - no need to scan anything
if (limit === 0) {
	return [[], false]
}

if (!(await directoryExists(path.resolve(dirPath)))) {
	throw new Error(`Cannot list files: directory does not exist: ${path.resolve(dirPath)}`)
}

// Handle special directories
```

## 4. Out of scope — do NOT do these

- Do not refactor `listFiles` beyond adding the single guard.
- Do **not** re-add or re-wire: **TTS**, the **router / cloud provider**, **cloud upsell** UI, or **Roo/Zoo branding** — all removed from this fork on purpose.
- Do **not** rename internal ids (those stay `Roo-Code`); only user-facing strings are "Tumble".

## 5. Verify — paste real output, don't claim success without it

- `cd src && npx vitest run services/glob/__tests__/list-files.spec.ts services/glob/__tests__/list-files-limit.spec.ts` → all green.
- `cd src && pnpm check-types` → must be clean.

## 6. Acceptance criteria (binary — all must hold)

- [ ] The §2 test passes; the surrounding suite is green.
- [ ] Only the files listed in §3 changed (`git status` confirms).
- [ ] No new "Roo" or "Zoo" user-facing strings introduced.
- [ ] No removed feature (TTS / router / cloud) was reintroduced.

## 7. Record in the ledger

The SKILL's `port` stage (step 3) already records this PR as `ported` once the
plan file exists. If — and only if — that has not been done yet, run it now
(re-running is a harmless idempotent upsert, so when in doubt run it once):

```bash
node .claude/skills/zoo-port/scripts/zoo-prs.mjs record \
  --pr 558 --status ported \
  --branch feature/zoo-558-list-files-check-cwd \
  --plan ai_plans/2026-06-17_zoo-558-list-files-check-cwd.md
```

When you commit (only if asked), append the `Co-authored-by:` trailer(s) from §0
to the commit message. Then summarize what landed and let the user review.
