---
"tumble-code": patch
---

Security refresh of the libraries the extension ships: the MCP SDK moves from 1.26.0 to 1.30.1, and the XML parser used by the AWS SDK, the Word document reader behind `.docx` attachments (mammoth and @xmldom/xmldom), undici, ws, form-data, jws, js-yaml, tmp, underscore and socket.io-parser move to their patched releases. Behaviour change from the MCP SDK: a single message from a local (stdio) MCP server larger than 10 MB is now rejected with a clear error instead of being buffered without limit.
