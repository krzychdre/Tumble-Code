---
"tumble-code": minor
---

Tumble Code now requires VS Code 1.102 or newer (previously 1.84). Editors older than 1.102 run extensions on Node 18 or 20, and the libraries the extension depends on have moved to Node 22; VS Code 1.102 is the first release whose extension host runs Node 22. Users on an older VS Code keep the version they have installed but no longer receive updates, which is why this is a minor release. The Tumble Code CLI now needs Node.js 22 or newer as well. With the newer floor the AWS SDK used for Amazon Bedrock is refreshed to its current release, which no longer needs the XML parser that had open security advisories.
