---
"@tumble-code/cli": patch
---

The diff preview of an edit in the terminal UI now shows what changed in a long line. A diff line longer than the band is still cut at the width, but when the changed columns of a modified line would fall beyond the cut, both the removed and the added band start just before the change, behind an ellipsis for the identical columns they skip. The columns a modified line differs in are painted in a stronger shade of the band's colour, in short lines too. Before, fixing a typo in column 300 of a 400-column sentence showed a removed band and an added band that read exactly the same, as if a duplicate line had been added.
