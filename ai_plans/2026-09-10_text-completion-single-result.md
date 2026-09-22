# 2026-09-10 Text-only completion: one result block, no regeneration turn

Branch: `fix/text-completion-single-result` (off `main` 4d87b0d97), worktree `/tmp/roo-wt-completion-merge`.

## Symptom

When a task ends, the chat shows the same answer twice: once as a "Tumble said" text row,
then an `API Request` row, then the green "Task Completed" block with the same content.
Screenshot task: `/summarize-news-sites`, reviewer mode, `GLM-5.3-NVFP4-MAX`, native tool
protocol. The user's read: the final text before the request is the same content as the
result, so the second request is pure waste of time and tokens.

## Evidence (task `01a08a32-7791-7439-bf46-119978bccb9b`, `api_conversation_history.json`)

| idx | role      | content                                                                                                                         |
| --- | --------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 43  | assistant | reasoning + text (2075 chars), **no tool call**, ts 1789027262321                                                               |
| 44  | user      | `formatResponse.noToolsUsed()` + environment_details; reminders: 4 Completed, #5 "Deliver news summary to user" **In Progress** |
| 45  | assistant | `attempt_completion`, `result` = paraphrase of [43] (difflib ratio 0.81); 8.3 s, $0.0249 (80448 in / 611 out)                   |

`ui_messages.json` tail: `text` say (ts 1789027251773) -> `api_req_started` ->
`completion_result` say -> `completion_result` ask. The "1.3 s" on the request row is time to
first token; the wall time between [44] and [45] is 8.3 s.

## Root cause (two layers)

1. **The gate of the text-only completion fallback was too strict.**
   [`tryTextCompletionFallback`](../src/core/task/TaskApiLoop.ts) (WS-5, merged 2026-08-25)
   skipped on `todo.status !== "completed"`. The last reminder of this task, the delivery itself,
   was `in_progress`, so the fallback stepped aside, the `noToolsUsed` retry went out, and the
   model regenerated its answer through `attempt_completion`.
2. **Even when the fallback fires, the answer is shown twice.** The streamed text is on screen
   as a `text` say; the tool then says `completion_result` with the same text. Since the merge
   every fallback completion on disk (41 of 41 after 2026-08-25) shows `text` say followed by a
   `completion_result` say with identical content. No tokens, but exactly the duplicate the user
   sees.

## Data (956 stored tasks, script `/tmp/notool_analysis.py`, run 2026-09-10)

- 77 `noToolsUsed` retries in total: 42 followed by `attempt_completion`, 31 by another tool,
  1 by text again, 3 aborted.
- Retries followed by `attempt_completion`: median 11.3 s, 842 s in total; similarity between the
  discarded text and the regenerated result median 0.48, 18 of 41 at or above 0.6 (weak models
  paraphrase rather than copy, so the second copy is also drift).
- By reminder state at retry time: with incomplete reminders 5 `attempt_completion` vs 13
  other-tool. Of those 13, 6 were `update_todo_list`; and 7 of the 10 `update_todo_list` retries
  in the data set went straight to `attempt_completion` on the next turn (two turns paid for
  bookkeeping).
- Every confirmed mid-task narration (`new_task` x2 in orchestrator mode, `read_file` x2,
  `execute_command` x2) had **at least 2 `pending` reminders**. Every case with no `pending` and
  only `in_progress` reminders was a final answer (`01a0345d` ratio 1.0, `01a08a32` 0.81),
  an `update_todo_list` followed by completion (`019f6a13`, ratio 0.92), or an
  `ask_followup_question` (`019e8961`).

## Decision

1. **Gate on `pending` only.** A `pending` reminder is work the model itself listed as not yet
   started, so a text-only turn cannot be the final answer and the retry stays. An `in_progress`
   reminder no longer blocks: with weak models the last item is routinely the delivery, left
   un-ticked because ticking it costs a tool call of its own.
2. **Relabel the streamed text in place.** Before running the real `AttemptCompletionTool`,
   scan this turn's cline messages backwards (stopping at `api_req_started`), and turn the
   finalized `text` say into a `completion_result` say with the same `ts`. The webview swaps the
   row (`messageUpdated` matches by ts), the persisted transcript holds one result block, and the
   tool's `alreadyFinalized` check finds the exact text and does not say it again. The ts is
   removed from `cloudSyncedMessageTimestamps` so the `completion_result` revision is captured
   for the cloud too; the self-hosted API upserts by `(task_id, message_ts)`, so the row is
   corrected, not duplicated, and `session_quality.py` still sees the completion.

Supersedes finding I-3 in
[2026-07-13_efficiency-stack-review-findings.md](2026-07-13_efficiency-stack-review-findings.md):
the "one retry turn in a corner case" turned out to be the standard finishing pattern.

## Rejected alternatives

- **Drop the gate entirely.** The six confirmed mid-task narrations (all with pending items,
  two of them an orchestrator about to call `new_task`) would auto-complete and hand narration
  to the user, or to a parent task, as the result.
- **Length or wording heuristics** ("Let me now...") to tell narration from an answer:
  unverifiable model behaviour, language dependent, and the data shows 82 to 1621 char
  narrations next to 480 to 695 char answers.
- **Prompt change: "if the previous text was the answer, call `attempt_completion` with an empty
  result and it will be reused".** Still a round trip, depends on weak-model compliance (the
  screenshot model paraphrased instead of copying), and would need an agent-bench run first.
  Possible follow-up for the cases the `pending` gate still retries.
- **Hide the earlier text row when the retry regenerates it.** The tokens are already spent and
  the row is real model output; hiding it would misrepresent the transcript.

## Residual risks

- A model narrating with only `in_progress` reminders now completes with that narration; the
  user continues from the feedback box, exactly as after a premature explicit
  `attempt_completion`. For a subtask the parent receives the narration and can re-delegate.
  None of the 956 stored tasks shows this pattern.
- `preventCompletionWithOpenTodos = true` (default false): the tool refuses with its own error,
  which the fallback pushes back as plain text; the model continues with better guidance than the
  generic `noToolsUsed` message. Consistent with the explicit path.
- If this turn has no finalized `text` say (nothing on screen to merge), the relabel returns
  `undefined` and the tool says the result as before.

## Files

- `src/core/task/TaskApiLoop.ts`: `TaskApiLoopAccess.cloudSyncedMessageTimestamps`, gate on
  `pending`, `relabelStreamedTextAsCompletion()`, comments.
- `src/core/task/__tests__/TaskApiLoop.text-completion-fallback.spec.ts`: gate tests updated
  (pending blocks, in_progress-only completes), relabel tests (in place, earlier turn untouched,
  still-partial text untouched).
- `.changeset/text-completion-single-result.md`.
- `ai_plans/2026-07-13_efficiency-stack-review-findings.md`: pointer under I-3.

## Verification

- `vitest run core/task/__tests__/TaskApiLoop.text-completion-fallback.spec.ts core/tools/__tests__/attemptCompletionTool.spec.ts`: 32 passed.
- `tsc --noEmit` in `src`: clean. `eslint`, `prettier --check`, `pnpm knip`: see the session log.
- Manual, after rebuilding the VSIX: run a task that keeps a reminder list whose last item stays
  In Progress and end with a text-only answer. Expected: one green "Task Completed" block, no
  extra `API Request` row, no "Tumble said" copy above it. Then answer in the feedback box and
  confirm the task continues.

## Appendix: the analysis script

Copy of `/tmp/notool_analysis.py` as run on 2026-09-10 against
`~/.config/Code/User/globalStorage/qub-it.tumble-code/tasks`. It scans every stored task,
finds each `noToolsUsed` retry, records the reminder table state in that message, what the
model did next, the similarity between the discarded text and a regenerated
`attempt_completion` result, and the retry duration.

```python
import json, os, re, difflib, glob, sys
root = "/home/krzych/.config/Code/User/globalStorage/qub-it.tumble-code/tasks"
rows = []
tasks_scanned = 0
for tdir in glob.glob(os.path.join(root, "*")):
    if not os.path.isdir(tdir): continue
    hp = os.path.join(tdir, "api_conversation_history.json")
    if not os.path.exists(hp): continue
    try:
        h = json.load(open(hp))
        hi = json.load(open(os.path.join(tdir, "history_item.json"))) if os.path.exists(os.path.join(tdir, "history_item.json")) else {}
    except Exception as e:
        continue
    tasks_scanned += 1
    for i, m in enumerate(h):
        if m.get("role") != "user": continue
        c = m.get("content")
        blocks = c if isinstance(c, list) else [{"type": "text", "text": c}]
        texts = [b.get("text", "") for b in blocks if b.get("type") == "text"]
        joined = "\n".join(texts)
        if "You did not use a tool in your previous response" not in joined: continue
        # reminders table in the same message
        tbl = re.findall(r"^\|\s*\d+\s*\|.*\|\s*(Pending|In Progress|Completed)\s*\|\s*$", joined, re.M)
        n_pending = sum(1 for s in tbl if s == "Pending")
        n_inprog = sum(1 for s in tbl if s == "In Progress")
        n_done = sum(1 for s in tbl if s == "Completed")
        # preceding assistant text
        prev = h[i-1] if i > 0 and h[i-1].get("role") == "assistant" else None
        prev_text = ""
        prev_tools = []
        if prev:
            pc = prev.get("content")
            if isinstance(pc, str): prev_text = pc
            else:
                for b in pc:
                    if b.get("type") == "text": prev_text += b.get("text", "")
                    if b.get("type") == "tool_use": prev_tools.append(b.get("name"))
        # next assistant
        nxt = h[i+1] if i+1 < len(h) and h[i+1].get("role") == "assistant" else None
        next_tools, next_text, result = [], "", None
        if nxt:
            nc = nxt.get("content")
            if isinstance(nc, str): next_text = nc
            else:
                for b in nc:
                    if b.get("type") == "tool_use":
                        next_tools.append(b.get("name"))
                        if b.get("name") == "attempt_completion":
                            result = (b.get("input") or {}).get("result")
                    if b.get("type") == "text": next_text += b.get("text", "")
        sim = None
        if result and prev_text:
            sim = round(difflib.SequenceMatcher(None, prev_text, result).ratio(), 2)
        dur = None
        if nxt and m.get("ts") and nxt.get("ts"):
            dur = round((nxt["ts"] - m["ts"]) / 1000, 1)
        rows.append({
            "task": os.path.basename(tdir)[:8], "ts": m.get("ts"), "mode": hi.get("mode"), "cfg": hi.get("apiConfigName"),
            "prev_len": len(prev_text.strip()), "prev_tools": prev_tools,
            "todo_pending": n_pending, "todo_inprog": n_inprog, "todo_done": n_done,
            "next_tools": next_tools, "next_text_len": len(next_text.strip()), "sim": sim, "retry_s": dur,
        })
rows.sort(key=lambda r: r["ts"] or 0)
print("tasks scanned:", tasks_scanned, " noToolsUsed occurrences:", len(rows))
import collections
def bucket(r):
    if not r["next_tools"] and r["next_text_len"] == 0: return "no-next/aborted"
    if "attempt_completion" in r["next_tools"]: return "attempt_completion"
    if r["next_tools"]: return "other-tool"
    return "text-again"
cnt = collections.Counter(bucket(r) for r in rows)
print("what followed the retry:", dict(cnt))
todo_split = collections.Counter((bucket(r), "todo-incomplete" if (r["todo_pending"] + r["todo_inprog"]) > 0 else ("todo-empty" if (r["todo_done"] == 0) else "todo-all-done")) for r in rows)
print("by todo state:")
for k, v in sorted(todo_split.items()): print("  ", k, v)
ac = [r for r in rows if bucket(r) == "attempt_completion"]
sims = [r["sim"] for r in ac if r["sim"] is not None]
if sims:
    print("attempt_completion retries: n=%d, similarity prev_text vs result: min=%.2f median=%.2f mean=%.2f, >=0.6: %d" % (len(sims), min(sims), sorted(sims)[len(sims)//2], sum(sims)/len(sims), sum(1 for s in sims if s >= 0.6)))
    durs = [r["retry_s"] for r in ac if r["retry_s"]]
    print("  retry durations (s): median=%.1f total=%.0f" % (sorted(durs)[len(durs)//2], sum(durs)))
ot = [r for r in rows if bucket(r) == "other-tool"]
print("other-tool retries: n=%d; prev text lengths: %s" % (len(ot), sorted(r["prev_len"] for r in ot)[:40]))
print("other-tool retries with prev_len==0 (pure empty/whitespace):", sum(1 for r in ot if r["prev_len"] == 0))
print("\n--- last 25 rows ---")
for r in rows[-25:]:
    print(r)
print("\n--- 'other-tool' rows with in-progress/pending todos and non-trivial prev text (the guard's protected case) ---")
for r in ot:
    if r["prev_len"] > 0 and (r["todo_pending"] + r["todo_inprog"]) > 0:
        print(r)
```
