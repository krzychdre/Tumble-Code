---
"tumble-code": patch
---

Security updates: @modelcontextprotocol/sdk 1.32.1 (the OAuth client no longer sends stored credentials to an authorization server chosen by the MCP server) and shell-quote 1.12.0 in the chat view's command parser. Remote MCP servers over HTTP now follow redirects only within the same origin; a server whose URL redirects to another host or port needs its final URL in the MCP settings.
