---
"tumble-code": patch
---

The system prompt has a new DOING TASKS section with engineering defaults for the code the agent writes: build only what a caller needs, guard only states that can really happen, fix the defect without stacking safety layers, reuse before creating, keep control flow flat, test only our own logic, keep comments short, and never commit or push unless asked. The compact profile gets the same rules in two lines, and the Code, Architect, Debug and Orchestrator modes were adjusted to match.
