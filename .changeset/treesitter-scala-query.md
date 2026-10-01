---
"tumble-code": patch
---

Scala files are parsed with the Scala grammar query again. They were parsed with the Lua query, which does not fit the Scala grammar, so listing the definitions of a Scala file failed instead of showing its classes, objects, traits and methods.
