---
"tumble-code": minor
---

New: **Organizations in the self-hosted cloud.** An Authentik group with the attribute `tumble_organization` is an organization (a second group with `tumble_organization_admins` names its admins), and a task belongs to the organization selected in Tumble Code when it starts. Settings list your organizations and their members with a link to Authentik, where they are managed; the cloud now needs `AUTHENTIK_API_TOKEN` in `.env` (see its README).
