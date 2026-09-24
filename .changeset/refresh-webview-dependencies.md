---
"tumble-code": patch
---

Security refresh of the libraries the chat panel ships: mermaid 11.17.2 (with DOMPurify 3.4.16) for diagrams, the Markdown renderer's mdast-util-to-hast 13.2.1, shell-quote 1.10.0 for command parsing, and axios 1.20.0 move to their patched releases. Mermaid 11.17 also recognises a few new diagram types. The build tools (Tailwind CSS 4.3.3, Vite 8.3.1) are refreshed too, which removes the vulnerable `tar` from the build.
