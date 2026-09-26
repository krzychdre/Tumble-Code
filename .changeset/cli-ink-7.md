---
"tumble-code": patch
---

The CLI's terminal renderer (ink) moves from 6.6 to 7.1.1. Holding Backspace in the prompt now deletes one character per repeat; before, repeats that the terminal delivered together were dropped. The Escape key now takes effect about 20 ms after the press, because the renderer waits that long to tell a lone Escape from the start of a key sequence. Streaming, long answers, tool rows, ctrl+o and resizing render as before.
