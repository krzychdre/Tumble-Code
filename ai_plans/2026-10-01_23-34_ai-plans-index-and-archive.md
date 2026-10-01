# ai_plans index and archive (E2)

Status: done (PR open, not merged)

## Touched files

- `ai_plans/README.md` (new): what the folder is, the naming convention, the archive rule, open plans, roadmaps.
- 269 plans moved with `git mv`: 250 dated before 2026-09-20 into `ai_plans/archive/YYYY-MM/`, 19 undated ones into
  `ai_plans/archive/undated/`.
- 95 files rewritten so every reference follows the move: code comments in `src/` (21 files), one cloud API test
  docstring, `scripts/agent-bench/README.md`, and relative links inside the plans themselves.

## Problem

`ai_plans/` had about 500 files and no index. Most status lines were never updated after the work merged, so a
reader could not tell open plans from history.

## Fix

- Which plans are finished: the 2026-09-27 content audit found every branch of the period merged (only the refactor
  plan branch is intentionally unmerged). The 29 old plans whose status still said Draft, Approved or In progress
  were spot-checked against the code (for example TTS is gone, custom sounds exist, `tools_load` parsing is pinned,
  share backfills the whole task, parallel subtasks require two), so all plans older than 2026-09-20 counted as
  finished. The undated plans (May `Task.ts` split, deferred tool loading, July refactor plans) are finished or
  superseded by the 2026-09-24 refactor plan.
- Kept in place: `2026-08-04_cli-bare-run-settings-sync.md`, `2026-08-04_cli-provider-parity.md` and
  `2026-08-05_cli-claude-code-style-ui-redesign.md`. `apps/cli` comments point at them, and other helpers are editing
  `apps/cli` right now; moving them later is a three-line change.
- Rewrite: every `ai_plans/<moved>.md` (with any `../` prefix) became the new path; relative markdown links inside
  moved plans were recomputed from the new folder, including links to plans that did not move.

## Tests

- The reference check below, before and after: the same 22 dangling references before the move (test fixtures such as
  `ai_plans/x-plan.md`, links into the memory folder, the refactor plan that is not on `main`) and 21 after
  (`ai_plans/README.md` now exists). No reference to a moved file's old path is left (`git grep -F` per file).
- Relative links inside the moved plans: 125 resolved before the move, 125 after.
- The 8 touched specs in `src` (comment changes only): 160 passed. `tests/test_sign_in_flow.py`: 9 passed.
- Prettier and ESLint on the touched TypeScript files, `pnpm knip`: exit 0.

## Notes

- `docs/plan-ids.md` (E1, PR #695) links five plans that this PR moves
  (`2026-07-11_codebase-review-findings-register.md`, `2026-07-12_glm-agent-loop-efficiency-implementation.md`,
  `2026-07-27_verbosity-and-turn-economics.md`, `2026-08-24_dsh-adoption-implementation-plan.md`,
  `2026-07-30_cloud-web-gui-overhaul.md`). Whichever PR merges second must point those links at
  `ai_plans/archive/YYYY-MM/`; run the check after the rebase.
- Plans dated 2026-09-20 and later are mostly finished too but stay at the top level for now.

## Reference check

Run from the repository root; it prints every dangling reference and exits 1 if there is any. Compare with the 21
known ones listed above.

```python
# Lists dangling references: (1) any "ai_plans/...md" path in a tracked text file that does not exist,
# (2) relative markdown links inside ai_plans/ that do not resolve. Exit 1 if any.
import os,re,subprocess,sys
W=sys.argv[1] if len(sys.argv)>1 else '.'
os.chdir(W)
tracked=[t for t in subprocess.run(['git','ls-files','-co','--exclude-standard'],capture_output=True,text=True).stdout.split('\n') if t and os.path.exists(t)]
bad=[]
pat=re.compile(r'(?<![\w/.-])(?:\.\./|\./)*ai_plans/[\w./-]*?\.md\b')
link=re.compile(r'\]\(([^)\s#]+?\.md)(?:#[^)]*)?\)')
for t in tracked:
    if t.startswith('locales/') or not t.endswith(('.md','.ts','.tsx','.js','.mjs','.cjs','.py','.css','.json','.yml','.yaml','.html','.sh','.txt','.toml')): continue
    if '/__snapshots__/' in t: continue
    try: s=open(t,encoding='utf-8').read()
    except Exception: continue
    for m in pat.finditer(s):
        p=m.group(0)
        q=re.sub(r'^(\.\./|\./)+','',p)
        if not os.path.exists(q) and not os.path.exists(os.path.normpath(os.path.join(os.path.dirname(t),p))):
            bad.append(f"{t}: {p}")
    if t.startswith('ai_plans/') and t.endswith('.md'):
        for m in link.finditer(s):
            p=m.group(1)
            if re.match(r'^[a-z]+:',p) or p.startswith('/'): continue
            if 'ai_plans/' in p: continue  # covered above
            r=os.path.normpath(os.path.join(os.path.dirname(t),p))
            if not os.path.exists(r): bad.append(f"{t}: link {p}")
for b in sorted(set(bad)): print(b)
print(f"{len(set(bad))} dangling", file=sys.stderr)
sys.exit(1 if bad else 0)
```
