# WP-<ID>: <short title>

Status: ready | needs-investigation-first
Effort: S | M | L      Risk: low | medium | high      Depends on: <WP ids or "none">
Branch name: fix/<id-lowercase>-<slug>      Base: origin/main

## 1. Goal (2-4 sentences, plain words)

## 2. Why it matters (user-visible effect, 2-4 sentences)

## 3. Read these first (exact paths, and the symbol to look for in each)

## 4. Current code (verbatim excerpts, each headed by path and symbol name; line numbers only as a hint "near line N")

## 5. Root cause / analysis
State what is VERIFIED (you read or ran it) and what is a HYPOTHESIS. For every hypothesis give the exact command
or test that confirms or refutes it, and what to do in each case.

## 6. Step-by-step changes
Numbered steps. Each step: the file, the exact code to find (a unique snippet), and the exact replacement code.
Small enough that a less capable model can apply it mechanically. No "etc.", no "similar for the others":
list every call site.

## 7. Tests to add or change
For each: the spec file path (existing or new), the full test code, and why it fails without the fix.
Follow the test placement rules in AGENTS.md (lowest layer that proves the behavior).

## 8. Commands to run (exact, from which directory) and the expected result
Include: the new test failing before the change (proves the test), passing after; type check; eslint on changed
files; prettier --check; the wider test folder.

## 9. Do not touch / pitfalls
Include relevant entries of the "Do not touch" list in docs/architecture.md, known flaky tests (F1 cli-integration
resume case, F2 Windows TaskHistoryStore lock count), mocks that assert exact call arguments, etc.

## 10. Acceptance checklist (checkboxes)

## 11. Commit, changeset and PR text
- Commit title (conventional commits, ends with the WP id in parentheses) and body.
- `.changeset/<slug>.md` content (package "tumble-code": patch) if user-visible; say "none" for test-only/docs-only.
- `ai_plans/2026-MM-DD_<slug>.md` short note (problem, change, tests) as the repo does for every fix.
- PR body outline.

## 12. If stuck
What to report back and where to stop, instead of guessing.
