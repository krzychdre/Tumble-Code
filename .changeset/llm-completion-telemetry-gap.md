---
---

Cloud metrics count all of the token usage again: since the cloud started in the background (P9), the cloud telemetry client never got the provider, so most events arrived without the app properties, failed validation and were dropped. A closed editor tab no longer takes the provider with it, and every task completion now states its own model, provider and mode instead of borrowing them from the sidebar's current task.
