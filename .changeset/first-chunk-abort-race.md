---
"tumble-code": patch
---

Remove a leftover abort listener from every API request. The wait for the first streamed chunk used its own abort race, whose listener stayed on the request's signal until the stream ended; it now uses the same race as every later chunk, which removes its listener as soon as the chunk arrives. Cancelling before the first chunk behaves as before.
