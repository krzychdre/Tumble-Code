// cd src && npx vitest run core/auto-approval/__tests__/commandWrappers.spec.ts

import { getCommandDecision } from "../commands"

// A command that runs another one must not carry a denied program past the
// deny list, nor get a program approved that only its wrapper was allowed for.
describe("getCommandDecision - commands that run other commands", () => {
	it.each([
		"rm -rf ~/x",
		"/bin/rm -rf ~/x",
		"env rm -rf ~/x",
		"env -i FOO=1 rm -rf ~/x",
		"env -u HOME -- rm -rf ~/x",
		"env -S 'rm -rf ~/x'",
		"nice rm -rf ~/x",
		"nice -n 10 rm -rf ~/x",
		"nohup rm -rf ~/x",
		"command rm -rf ~/x",
		"exec rm -rf ~/x",
		"builtin rm -rf ~/x",
		"time -p rm -rf ~/x",
		"/usr/bin/time rm -rf ~/x",
		"timeout 10 rm -rf ~/x",
		"timeout -s KILL 10 rm -rf ~/x",
		"stdbuf -o0 rm -rf ~/x",
		"setsid rm -rf ~/x",
		"sudo rm -rf ~/x",
		"sudo -u root env rm -rf ~/x",
		"sh -c 'rm -rf ~/x'",
		"bash -lc 'echo hi; rm -rf ~/x'",
		'zsh -c "rm -rf ~/x"',
		"sh -c 'sh -c \"nice rm -rf ~/x\"'",
		"fish --command='rm -rf ~/x'",
		"eval 'rm -rf ~/x'",
		"xargs rm -rf",
		"xargs -0 -n 1 rm -rf",
		"find . -name '*.tmp' -exec rm {} +",
		"find . -execdir rm -f {} ';'",
		"npx rm -rf ~/x",
		"npm exec -- rm -rf ~/x",
		"pnpm dlx rm -rf ~/x",
		"npx -c 'rm -rf ~/x'",
		"watch -n 1 rm -rf ~/x",
		"flock /tmp/lock rm -rf ~/x",
		"flock /tmp/lock -c 'rm -rf ~/x'",
		"chroot / rm -rf ~/x",
		"su -c 'rm -rf ~/x'",
		"su root -c 'rm -rf ~/x'",
		"su --command='rm -rf ~/x' root",
		"script -c 'rm -rf ~/x'",
		"script -qc 'rm -rf ~/x' /dev/null",
		"busybox rm -rf ~/x",
		"strace rm -rf ~/x",
		"strace -f -o /tmp/log rm -rf ~/x",
		"ltrace -e malloc rm -rf ~/x",
		"chrt 10 rm -rf ~/x",
		"chrt -f 10 rm -rf ~/x",
		"cpulimit -- rm -rf ~/x",
		"cpulimit -l 50 rm -rf ~/x",
		"fakeroot rm -rf ~/x",
		"firejail --noprofile rm -rf ~/x",
		"systemd-run --user -p Nice=5 rm -rf ~/x",
		"parallel rm -rf ::: a b",
		"parallel -j 4 rm -rf {} ::: a b",
		"parallel ::: 'rm -rf a' 'ls'",
		"ssh localhost rm -rf ~/x",
		"ssh -p 2222 host 'ls; rm -rf ~/x'",
		"gdb -batch -ex run --args rm -rf ~/x",
		"find . -name '*.tmp' -delete",
	])("%j is denied by a denied rm, even with the * allow list", (command) => {
		expect(getCommandDecision(command, ["*"], ["rm"])).toBe("auto_deny")
	})

	it.each([
		"git -C repo push --force",
		"git --no-pager push",
		"git submodule foreach 'git push --force'",
		"git submodule foreach --recursive git push",
		"git rebase -x 'git push' main",
		"git bisect run git push",
	])("%j is denied by a denied git push next to an allowed git", (command) => {
		expect(getCommandDecision(command, ["git"], ["git push"])).toBe("auto_deny")
	})

	it.each([
		["a git config naming a program", "git -c core.sshCommand='rm -rf ~/x' fetch", ["git"]],
		["a git config given with -c attached", "git -ccore.pager=evil log", ["git"]],
		["a payload only known after expansion", 'sh -c "$CMD"', ["*"]],
		["an eval of a variable", "eval $CMD", ["*"]],
		["an ANSI-C quoted payload", "bash -c $'rm\\x20-rf x'", ["*"]],
		["PowerShell running text", "pwsh -Command Remove-Item x", ["*"]],
		["a payload with an unterminated quote", 'sh -c "echo \'a"', ["*"]],
		["a denied program after options the parser does not know", "nice --weird 5 rm -rf x", ["*"]],
		["parallel reading its commands from stdin", "parallel -j 4", ["*"]],
		["an ssh option naming a local command", "ssh -o ProxyCommand='rm -rf x' host ls", ["*"]],
		["an ssh config file given on the command line", "ssh -F ./cfg host ls", ["*"]],
		["a denied program after ssh options the parser does not know", "ssh -vp 22 host rm -rf x", ["*"]],
		["gdb running a debugger command", "gdb -batch -ex 'shell rm -rf x'", ["*"]],
		["vim running an ex command", "vim -c '!rm -rf x' -c q", ["*"]],
		["vim running a +command", "vim '+!rm -rf x' file", ["*"]],
		["python inline code", "python3 -c 'import os; os.system(\"rm -rf x\")'", ["*"]],
		["node inline code", 'node -e \'require("fs").rmSync("x")\'', ["*"]],
		["node code in --eval=", "node --eval='process.exit(0)'", ["*"]],
		["perl inline code in an option cluster", "perl -ne 'system(\"rm -rf x\")' f", ["*"]],
		["ruby inline code", "ruby -e 'system(\"rm -rf x\")'", ["*"]],
		["an awk program calling system()", "awk 'BEGIN{system(\"rm -rf x\")}'", ["*"]],
		["an awk program piping into a command", "awk '{print | \"sh\"}' f", ["*"]],
	])("%s is never approved automatically: %j", (_label, command, allow) => {
		expect(getCommandDecision(command, allow, ["rm"])).toBe("ask_user")
	})

	it.each([
		["sh -c 'npm test'", ["sh"]],
		["env FOO=1 npm test", ["env"]],
		["xargs rm -f", ["xargs"]],
		["find . -exec rm {} +", ["find"]],
		["npx some-tool --fix", ["npx"]],
		["timeout 60 make deploy", ["timeout", "make test"]],
	])("%j asks: the wrapper is allowed but what it runs is not", (command, allow) => {
		expect(getCommandDecision(command, allow, [])).toBe("ask_user")
	})

	it.each([
		["sh -c 'npm test && git status'", ["sh", "npm test", "git status"]],
		["env CI=1 npm test", ["env", "npm test"]],
		["nice -n 5 npm test", ["nice", "npm test"]],
		["timeout 60 npm test", ["timeout", "npm test"]],
		["find . -name '*.ts' -exec grep -l foo {} +", ["find", "grep"]],
		["find . -name rm -print", ["find"]],
		["git log --grep rm", ["git"]],
		['git commit -m "rm the old file"', ["git"]],
		["git -C sub status", ["git"]],
		["git submodule foreach git status", ["git"]],
		["npx prettier --check .", ["npx", "prettier"]],
		["npm exec -- vitest run", ["npm exec", "vitest"]],
		["command -v rm", ["command"]],
		["xargs grep -l foo", ["xargs", "grep"]],
		["bash script.sh", ["bash"]],
		["strace -f ls", ["strace", "ls"]],
		["busybox ls", ["busybox", "ls"]],
		["parallel gzip ::: a b", ["parallel", "gzip"]],
		["ssh host git status", ["ssh", "git status"]],
		["chrt -p 10 1234", ["chrt"]],
		["su -", ["su"]],
		["find . -name '*.log' -print", ["find"]],
		["awk -F: '{print $1}' /etc/passwd", ["awk"]],
		["vim +10 notes.txt", ["vim"]],
		["python3 script.py", ["python3"]],
	])("%j is still auto-approved when everything it runs is allowed", (command, allow) => {
		expect(getCommandDecision(command, allow, ["rm", "git push"])).toBe("auto_approve")
	})

	it.each([
		["python3 -c 'print(1)'", ["python3"]],
		["awk 'BEGIN{system(\"date\")}'", ["awk"]],
		["gdb -batch -ex bt ./app core", ["gdb"]],
	])("%j is auto-approved by its allowed interpreter while the deny list is empty", (command, allow) => {
		expect(getCommandDecision(command, allow, [])).toBe("auto_approve")
	})

	it("stops following wrappers past a depth and asks", () => {
		const deep = `${"env ".repeat(12)}npm test`
		expect(getCommandDecision(deep, ["env", "npm test"], [])).toBe("ask_user")
	})
})
