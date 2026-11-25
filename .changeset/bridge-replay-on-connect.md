---
"tumble-code": patch
---

Fixed: **Tasks started before the cloud connection keep their opening messages.** When the connection to Tumble Code Cloud comes up, or comes back, every open task sends what it has so far, so a task started right away (as `tumble -p` does) shows its request and title on the web and can be followed from the first message.
