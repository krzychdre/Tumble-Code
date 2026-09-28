---
"@tumble-code/cli": patch
---

New `/copy` and `/export` commands. `/copy` puts the last answer on the clipboard (`/copy code` only its last code block) through the OSC 52 terminal escape and says what to do if the terminal does not accept it. `/export` saves the conversation as a Markdown file in the workspace (or the file you name, never overwriting one) and prints its path.
