---
"tumble-code": patch
"@tumble-code/cli": patch
---

When task sync to the cloud is on, an image the conversation points to by path (`![chart](monitoring/chart.png)`, resolved against the task's working directory as the CLI does) is uploaded next to its message, so the cloud web panel can show it instead of a broken image. Only PNG, JPEG, GIF and WebP files up to 10 MB are sent, each file once per message until it changes; a failed upload is logged and never holds up the conversation.
