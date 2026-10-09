---
"tumble-code": patch
---

`web_fetch` now identifies itself as a desktop Chrome browser. Sites that refuse unknown clients, such as the crates.io API, used to answer "HTTP 403" and the model had no way to retry differently; they now return the page.
