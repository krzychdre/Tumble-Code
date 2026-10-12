---
"@tumble-code/cli": patch
---

The CLI's terminal UI no longer decodes an image larger than 4096 x 4096 pixels or a file over 32 MB that the model points to: it shows the text placeholder instead. A small file with a huge header (a 380 KB PNG claiming 10000 x 10000) used to take about 470 MB and block the interface for a second, and a larger one could crash the CLI.
