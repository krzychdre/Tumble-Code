---
"@tumble-code/vscode-webview": patch
---

Lazy-load heavy webview assets so the initial chat view loads lean (P4): the KaTeX stylesheet now rides the same lazy barrier as rehype-katex, posthog-js became a dynamic import fetched only when telemetry is enabled, and the Marketplace/Cloud and Modes/MCP tab views are React.lazy chunks with a progress-ring Suspense fallback.
