# The dream verifies time-bound claims in project memory

Status: in progress, four stacked branches (see "Branches"). `src/core/memory` is on the "do not touch without a
dedicated item" list in `docs/architecture.md`; this document is that item.

## Problem

The memory dream (`src/core/memory/autoDream.ts`) only merges or drops pairs of similar memories. Nothing checks
whether a memory still says something that has stopped being true. Memories are full of clauses that were true only
for a while: "VSIX rebuild owed", "fix/cloud-daily-chart-axis STILL unmerged", "deferred to a follow-up", "jeszcze
nie zmergowane". They turn false silently and keep misleading every later session, because the MEMORY.md index line
and the description repeat them on every turn.

Measured on the real shared memory directory of this repo (122 files, 2026-10-01): 170 time-bound clauses in 64
files; 38 of them name something git can check (a PR number, a commit hash, a branch, a repo path). Most of the rest
are "VSIX rebuild owed" style clauses that only a newer memory can settle ("2026-09-27 audit: VSIX = main@059bac30c").

## Constraint: a very small, unreliable model runs the dream

The dream runs on the memory-writer profile, often a small local model. So:

1. The code finds the clauses, the references, the evidence and does every edit. The model writes no text.
2. The model answers one word, DONE or STILL, about one clause at a time. Anything else counts as STILL.
3. The model is asked only when the code already found evidence that could resolve the clause (the gate below).
   Without such evidence the answer could only be a guess, so no call is made.
4. Every edit is recoverable: the original file goes to `.archive/` first, the body keeps the clause with a
   `[resolved <date>: <evidence>]` note, only the one-line description and index line drop the clause.

## Design

### 1. Finding time-bound clauses (`timeBoundClaims.ts`, pure)

- `findTimeBoundClauses(text)`: lines are cut into clauses at `;`, spaced dashes and sentence ends; a clause is
  time-bound when it matches one of the English or Polish markers (owed, not yet, unmerged, not pushed, still open,
  deferred, postponed, follow-up(s/y), open:, must run, needs a rebuild, for now, temporary, jeszcze nie, niezmergowane,
  odłożone, do zrobienia, na razie, zaległe, ...). Fenced code is skipped. A clause carrying `[resolved ` is skipped.
- `extractRefs(clause)`: `#123` PRs, 7-40 hex commit hashes (must mix digits and letters), `feat/`, `fix/` ... branch
  names, repo-relative file paths. Only refs inside the clause itself count (refs from a neighbouring clause would
  let "MERGED #570; VSIX rebuild owed" resolve the VSIX clause).
- `removeClause(line, clause)` and `annotateClause(text, clause, note)`: the two text edits.
- Contracts shared by the other branches: `ClaimRef`, `ClaimEvidence { ref, landed, text }` and the gate rule
  `allRefsLanded(refs, evidence)`. The lookup type
  `ClaimEvidenceLookup = (refs: ReadonlyArray<ClaimRef>, signal: AbortSignal) => Promise<ClaimEvidence[]>` lands with
  its implementation in `claimEvidence.ts` (knip rejects an exported type nobody uses yet).

### 2. Evidence

Two sources, both deterministic:

- **Git** (`claimEvidence.ts`, `createGitClaimEvidenceLookup(cwd)`), read-only, no fetch: - PR `#N`: a commit on the default branch whose subject has `(#N)` (squash) or `pull request #N` (merge commit). - Commit: exists, and is an ancestor of the default branch. - Branch: local or `origin/` ref; tip is an ancestor of the default branch, or `git merge-tree --write-tree
<default> <branch>` yields the default branch's own tree (content already there = squash-merged). Optional
  `gh pr list --head <branch> --state merged` only when the branch is gone and `gh` exists. - File: `git cat-file -e <default>:<path>`. - `landed: true` = on the default branch, `false` = known not there, `undefined` = cannot tell.
- **Newer memories** (inside the dream): lines of memories changed after the claim's memory that share a rare topic
  word with the clause (e.g. "VSIX") and contain a completion word (rebuilt, merged, landed, deployed, installed,
  done, fixed, resolved, zrobione, wdrożone, przebudowane, ...) and are not time-bound themselves. At most 2 per clause.

### 3. Gate, question, edit (`claimCheck.ts`, called from `consolidateMemories`)

For each time-bound clause of the description, the MEMORY.md index line and the body, oldest memories first:

1. Gate: the model is asked only when (a) the clause has refs and every one is `landed: true`, or (b) at least one
   newer-memory statement was found. Otherwise skip, no state written.
2. Skip when the check state (`.claim-checks.json` in the memory dir, keyed by file + clause + evidence) holds a
   STILL answer younger than 14 days. New evidence means a new key, so it is asked again at once.
3. One completion, at most 4 per dream:
    ```
    system: You check one old note against facts found today. ... Answer with exactly one word: DONE or STILL.
    user:   Sentence (written 2026-09-28, 3 days ago): "VSIX rebuild still owed."
            Facts found today (2026-10-01):
            - A newer note (project_x.md, 2026-09-30) says: "VSIX rebuilt from main@abc1234"
    ```
    The first word decides; `<think>` blocks, markdown and case are ignored; anything else is STILL.
4. DONE: archive a copy, then the body clause gets `[resolved 2026-10-01: <first evidence>]`, the description and
   the index title/hook drop the clause (annotated instead when the clause was the whole text). The description is
   written quoted when it contains `: ` or YAML-special leading characters, because Claude Code parses the shared
   directory's frontmatter as real YAML.
5. STILL: only the check state is written.

Implementation notes (branch 4, `claimCheck.ts`):

- The cap of 40 examined clauses counts only clauses that reach the evidence stage (refs with a lookup wired, or a
  newer statement found). Clauses nothing could settle cost no lookup and are skipped without counting, so they do
  not use up the budget meant for the rest of the store.
- A DONE whose edit could not drop the clause (a clause that is the whole index title) is remembered and not asked
  again while the facts stay the same.
- An edited memory keeps its mtime: the rest of the note is as old as before, and a fresh mtime would hide the newer
  notes that could settle its remaining clauses.
- The git lookup is injected (`evidence` on `AutoDreamContext` and `consolidateMemories`); until branch 2 is wired,
  only newer memories count as evidence.

### 4. Recall warns about unresolved time-bound clauses (`surfacing.ts`)

When a surfaced memory is at least a day old and still contains time-bound clauses, its header lists up to 3 of
them and tells the main agent to check them before relying on them or repeating them. This is the second line of
defence for clauses the dream cannot settle (no refs, no newer memory).

## Branches

1. `feat/memory-time-bound-claims`: detector, refs, text edits, contracts, this document.
2. `feat/memory-claim-evidence-git`: `claimEvidence.ts` + spec with a real temporary git repository.
3. `feat/memory-recall-time-bound-note`: the recall header note.
4. `feat/dream-verifies-time-bound-claims`: `claimCheck.ts`, newer-memory evidence, check state, edits,
   `consolidateMemories` hook, then the wiring of the git lookup once 2 is on main.

## Results

(filled in when the branches land)
