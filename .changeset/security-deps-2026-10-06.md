---
"tumble-code": patch
---

Security updates: simple-git 4.0.2 (checkpoints; fixes command execution through git config includes, trailer settings and abbreviated options), axios 1.20.0 (ReDoS, prototype pollution and redirect SSRF fixes), and lodash-es 4.18.1 and proxy-addr 2.0.8 in dependencies. Checkpoints keep working when `VISUAL` or `GIT_CONFIG_PARAMETERS` is set in the environment: both are removed before git runs, as simple-git 4 refuses them.
