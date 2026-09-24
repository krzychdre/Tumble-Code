---
"tumble-code": patch
---

The installed CLI now renders with exactly the versions of React, ink and zustand it was developed and tested with. They used to be installed from the registry at install time within a version range, without a lockfile, so an installation could get newer releases (React 19.3.0 instead of 19.2.3) and render differently from a development build. They are now bundled into the CLI, together with the packages ink depends on (the layout engine, the text width and wrapping helpers, the React reconciler), and the few dependencies that are still installed are pinned to exact versions. The release workflow now also writes the same list of dependencies as the local build script, which it did not do before (it left out execa).
