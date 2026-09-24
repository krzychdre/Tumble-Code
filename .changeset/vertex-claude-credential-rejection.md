---
"tumble-code": patch
---

A Google Vertex profile with a Claude model no longer causes an unhandled error when its Google credentials cannot be loaded (missing key file, no application default credentials). The Vertex client looks the credentials up as soon as it is created, so the failure used to surface as an unhandled promise rejection even when the profile was only read for model info (for example while exporting settings), which made the CLI exit. The error is now reported only on the first request, as a normal Vertex error.
