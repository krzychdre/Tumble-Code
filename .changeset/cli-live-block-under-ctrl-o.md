---
"tumble-code": patch
---

In the CLI's expanded view (ctrl+o) the block that is still running now streams live: the reasoning of a thinking block, the output of a Bash command and the response of an MCP call show their newest lines under a "… +N lines" marker as they arrive, instead of staying collapsed until the block finished. The whole block still prints in full once it completes, and the collapsed view is unchanged.
