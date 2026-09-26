---
"tumble-code": patch
---

Upgrade React across the monorepo to 19.3.0: webview-ui moves from react/react-dom 19.2.3 (with @types 19.2.x) to react/react-dom/@types 19.3.0, and the CLI's react range moves from ^19.1.0 to ^19.3.0. React 19.3 is additive-only (stable ViewTransition and Fragment refs, the browser() DOM entry point, Trusted Types support, RSC Context rendering) with no breaking changes against 19.2, so no source changes were needed; type-checks, lint, and both vitest suites pass on the new version.
