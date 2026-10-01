---
---

Memory: the dream now checks notes that were true only for a while ("not merged yet", "VSIX rebuild owed", "jeszcze nie zmergowane"). The code finds such clauses, looks them up in git (PR on main, commit pushed, branch merged or squash-merged) and in newer notes, and asks the memory model one word (DONE or STILL) only when that evidence could settle the clause. A finished clause is marked `[resolved <date>: <evidence>]` in the note and dropped from its one-line description and MEMORY.md index line; the original goes to `.archive/` first. Recall also warns the agent about such clauses in memories older than a day.
