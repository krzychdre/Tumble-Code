---
"tumble-code": patch
---

New CLI command `/mcp`: a panel with every MCP server of the session, global and project, showing whether each one is connected, how many tools it offers, and why it failed when it did. From the panel a server can be restarted (`r`), enabled or disabled (`space`, saved to its config file), and both config files can be reloaded after an edit (`R`). A server that fails to start is no longer silent: the terminal interface shows a notice pointing at `/mcp`, and print mode writes the reason to stderr.
