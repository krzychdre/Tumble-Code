# `zoo-port` skill — periodic triage & porting of Zoo-Code PRs

**Date:** 2026-05-31
**Branch:** suggested `feature/zoo-pr-port-skill` (off `main`) — only the ai_plan is tracked; see §6.
**Driver:** `Zoo-Code-Org/Zoo-Code` is a sibling Roo Code fork that actively merges PRs. We want a repeatable way to (a) discover Zoo's merged PRs, (b) judge which are worth bringing into our fork, and (c) port the good ones — reimplemented cleanly, not copied — while remembering what we've already looked at so a periodic run is incremental.

Related work: [2026-05-26_rebrand-roo-to-tumble-code.md](2026-05-26_rebrand-roo-to-tumble-code.md), [2026-05-28_hide-cloud-upsell-content.md](2026-05-28_hide-cloud-upsell-content.md), [2026-05-27_remove-tts.md](2026-05-27_remove-tts.md), [2026-05-26_22-35_remove-roo-router-provider.md](2026-05-26_22-35_remove-roo-router-provider.md).

---

## 1. Decisions (locked with user 2026-05-31)

| #   | Decision                 | Value                                                                                                                                                                                                                                                                                                                                                                      |
| --- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Autonomy                 | **Triage automatically, port only on approval.** Each run classifies new PRs and proposes candidates; reimplementation happens only for PRs the user green-lights.                                                                                                                                                                                                         |
| D2  | Ledger location          | **Gitignored local state** at `.claude/zoo-port/ledger.json`. The whole `.claude/` tree is already ignored via the user's global excludesfile, so nothing is committed.                                                                                                                                                                                                    |
| D3  | PR data source           | **Local Zoo clone** (`$ZOO_CODE_PATH` or sibling `../Zoo-Code`) — has every merged PR's full diff, works offline, no rate limits. `gh` is not authed; GitHub API is optional enrichment only.                                                                                                                                                                              |
| D4  | Port discipline          | **TDD + DRY + YAGNI**, reimplemented (not copied), rebranded (Tumble not Roo/Zoo), weak-model-safe for any LLM-facing change, one feature branch per PR + an ai_plan each, and **credit the upstream author** (`Co-authored-by:` trailer on the port commit).                                                                                                              |
| D5  | Triage deliverable       | **Per-PR markdown reports** in `.claude/zoo-port/reports/`, each with a vs-our-current-code assessment and a `[ ] PORT · [ ] SKIP · [ ] DEFER` decision line. The user decides in the report; `approved` reads the checked boxes back. An upstream change is **not** automatically wanted — our fork made its own UI/behavior changes.                                     |
| D6  | Port plan for weak model | Each approved PR gets a **full implementation plan executable by a small/weak model (Sonnet or worse)** — exact verified paths, failing-test-first, every edit as an explicit code block (pre-adapted to our names + utilities), explicit scope cuts and removed-feature landmines, exact verify commands, binary acceptance. Template: `templates/port-plan-template.md`. |

---

## 2. Why these choices

- **Local clone over the API.** Both repos share Roo Code's tree, so paths map 1:1 and `git -C <zoo> show <commit>` gives the real patch to assess and adapt. `gh` is unauthenticated here and the public API's 60-req/hr unauthenticated limit is fragile for a recurring job; the clone has no such limit.
- **Ledger as the memory.** Keying by Zoo's trailing merge-PR number (`(#…)`) and recording a verdict for _every_ PR seen is what makes runs incremental — the next run's `new` only surfaces PRs with no ledger entry. Mutating it solely through the helper keeps the JSON shape valid (the model never hand-edits state).
- **Triage ≠ porting.** Discovery/classification is cheap and safe to automate; porting is careful TDD work that deserves a human gate (D1).

## 3. Architecture (all under gitignored `.claude/`)

| File                                                      | Role                                                                                                                                                                                                                                                                                  |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.claude/skills/zoo-port/SKILL.md`                        | Operating spec: the two repos, ledger commands, the two modes (`triage` / `port`), the report→decision→port gate, the weak-model plan contract, and the triage rubric.                                                                                                                |
| `.claude/skills/zoo-port/scripts/zoo-prs.mjs`             | Dependency-free Node ESM helper — the deterministic half. Subcommands: `new`, `show`, `record`, `record-batch`, `gen-reports`, `approved`, `report`, `init`. Resolves repo root + Zoo path, parses merged-PR commits, reads/writes the ledger, renders reports, reads decisions back. |
| `.claude/skills/zoo-port/templates/port-plan-template.md` | The weak-model port-plan skeleton (D6) copied per approved PR into `ai_plans/`.                                                                                                                                                                                                       |
| `.claude/zoo-port/ledger.json`                            | State, created on first `record`. Source of truth for "already analyzed".                                                                                                                                                                                                             |
| `.claude/zoo-port/reports/PR-<n>-<slug>.md`               | Per-PR decision-ready report (D5), generated from the ledger; shows the upstream author(s) + paste-ready `Co-authored-by:` credit, and holds the user's `[x] PORT/SKIP/DEFER` choice. Never overwritten unless `--force`.                                                             |

**Ledger entry shape:** `{ pr, refs[], title, commit, mergedAt, category, status, reason, branch, plan, notes, authors[], analyzedAt, updatedAt }`. Status ∈ `skip` \| `watch` \| `candidate` \| `ported`. `notes` carries the vs-our-current-code assessment that fills the report; `authors[]` is the credited upstream author(s) (`{name, email}`).

## 4. Workflow

Two stages with a **human gate** between them — triage makes the call legible,
the user decides in the reports, porting follows.

- **Triage (default):** `zoo-prs new` → for each: `show` + read the diff →
  **assess vs. our current code** (still exists? already present? clashes with our
  divergence or UI changes? size/risk/files) → `record` immediately
  (skip/watch/candidate) with the verdict in `--reason` and the vs-our-code
  assessment in `--notes`; large batches via `record-batch` (one atomic write) →
  `gen-reports` writes one decision-ready markdown per PR → tell the user to
  review and check `[x] PORT/SKIP/DEFER`. **No code written.**
- **Gate:** the user edits decisions in the reports; `zoo-prs approved` reads back
  the `[x] PORT` set.
- **Port (approved only):** for each, branch `feature/zoo-<PR#>-<slug>` off `main`
  → write a **weak-model-executable plan** (`templates/port-plan-template.md` → `ai_plans/`)
  with verified paths, failing-test-first, every edit pre-adapted, explicit scope
  cuts and removed-feature landmines, exact verify commands + binary acceptance,
  and the **upstream author credit** → `record … --status ported --plan …` →
  execute yourself or hand the plan to a smaller model → verify (lint/types/tests)
  → on commit (if asked) add `Co-authored-by:` trailers. One branch per PR (stack
  on overlap).

**Attribution rule (evidence-based).** Zoo squash-merges PRs, so the commit
**committer is always `GitHub`** — never credit it. The author is the commit
author **unioned with every `Co-authored-by:` trailer**, de-duped by name
(preferring the GitHub-linkable `…@users.noreply.github.com` email), with bots
(`*[bot]`) and AI-assistant trailers (`noreply@anthropic.com` /
`noreply@openai.com`) dropped **when a human remains**. Verified against real Zoo
commits: PR #268's author is `roomote[bot]` but the human **Elliott de Launay** is
in the trailer; PR #275 credits two humans; PR #233's `Claude Opus 4.7` AI trailer
is dropped in favour of the human author. `commitAuthors()` in the helper
implements this; `show`, the report **Credit** section, and the ledger `authors[]`
all use it.

## 5. Triage rubric (fork-aware)

- **SKIP:** branding / cloud-credits / upsell / Roo-cloud-telemetry; TTS and router/cloud-provider code we removed (verify touched paths still exist here first); Zoo release/version/changeset chores; pure dep bumps (→ `watch` at most).
- **PORT:** core bug fixes (`src/`, `packages/`: providers, API lifecycle, diff/checkpoints, parsing, tool execution); new provider/model support; correctness/perf/robustness fixes (esp. tool-calling/parser/weak-model); non-branding webview UX fixes.
- **WATCH:** large/ambiguous features needing design judgement.
- Always check: do the paths still exist here, and have we already ported it (`git log | grep`)?

The helper prints advisory **"likely skip"** hints (keyword-matched: TTS/router/roo-cloud/credits/deps/release) to focus attention — the model always verifies against the actual diff before recording.

## 6. Git note

The skill lives under `.claude/`, which is gitignored globally, so it is **local to this machine** and produces no repo changes. Only this ai_plan is a tracked artifact; commit it on its own branch per the branch-per-feature convention. If the skill should be shared with teammates, relocate it to a tracked path (e.g. `tools/zoo-port/`) and adjust the global ignore — out of scope here.

## 7. Verification (done 2026-05-31)

Ran against the real Zoo clone: `new --limit 25` listed 25 PRs with correct PR-number parsing (incl. dual-ref `(#157) (#276)` → keyed on `276`) and sensible hints; `show 386` rendered message + changed files; a 3-PR `record` round-trip upserted with auto-filled metadata, `report` grouped by status, and `new` then dropped the recorded PRs (25 → 22).

**Full triage run + reports (D5):** classified all 103 merged Zoo PRs (38 candidate / 6 watch / 59 skip) across 8 read-only subagents, merged/de-duped their verdicts, and loaded them with one `record-batch` write. `gen-reports --force` wrote 103 `PR-<n>-<slug>.md` reports. Spot-checked PR-233's report (verdict blockquote + decision line, commit body, `--stat`, the vs-our-code assessment, "why this verdict", "decide before porting"). Confirmed the decision round-trip: set `[x] PORT` in one report → `approved` returned `#233` → reverted. Re-running `gen-reports` without `--force` keeps edited reports intact.

**Attribution (D4 credit):** added `commitAuthors()` and re-ran `record-batch` + `gen-reports --force` to backfill `authors[]` and Credit sections for all 103. Verified the three tricky cases — PR #268 (`roomote[bot]` author → credits **Elliott de Launay** from the trailer), PR #275 (**two humans**, Armando preferring his `…noreply.github.com` email), PR #233 (AI trailer `Claude Opus 4.7` dropped → **Armando Vaquera**). The only reports still containing an AI email are those embedding the raw upstream commit body in "What it does"; their generated Credit sections correctly list the human only.

## 8. Running periodically

The skill is the unit of work; drive it on a cadence with `/loop` or the `/schedule` skill (e.g. weekly `/zoo-port`). Each run is incremental via the ledger.
