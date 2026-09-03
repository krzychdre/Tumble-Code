---
"tumble-code": patch
---

The memory directory validator now rejects a bare filesystem root on Windows too. "/" is an absolute path there (the current drive's root) and used to slip past the check that only looked for a drive letter, so a misconfigured auto memory directory could point memory writes at the root of the drive. Five unit test files that compared product paths against POSIX string literals were also fixed so the Windows CI job passes.
