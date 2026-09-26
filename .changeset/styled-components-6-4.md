---
"tumble-code": patch
---

Upgrade styled-components from 6.1.13 to 6.4.4 in webview-ui for proper React 19 compatibility (6.1 predates React 19: forwardRef deprecation warnings, ref-as-prop support). No `@types/styled-components` existed (6.x ships its own types). Also removes the now-obsolete `as CSSObject` cast in `StyledPre` since 6.4 ships csstype 3.2.3, matching React 19's `CSSProperties`.
