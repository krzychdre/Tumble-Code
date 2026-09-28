---
"@tumble-code/cli": patch
---

Ctrl+R now searches your previous prompts, as in bash: type to narrow, press Ctrl+R again for older matches, Enter puts the match into the prompt and Escape gives back what you had typed. Before, Ctrl+R typed a literal "r". `tumble --resume` starts with the picker of this workspace's earlier tasks, and `/resume` opens it during a session (typing `#` still works).
