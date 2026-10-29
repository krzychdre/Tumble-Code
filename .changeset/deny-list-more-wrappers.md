---
"tumble-code": patch
---

Fixed: **More wrappers can no longer carry a denied command past the deny list.** Commands run through `su -c`, `script -c`, `busybox`, `strace`, `chrt`, `cpulimit`, `fakeroot`, `firejail`, `systemd-run`, `parallel`, `ssh` and `gdb --args` are checked like the command itself, `find -delete` counts as `rm`, and inline code (`python3 -c`, `node -e`, `gdb -ex`, `vim -c`, an awk program calling `system()`) asks for approval while your deny list has entries.
