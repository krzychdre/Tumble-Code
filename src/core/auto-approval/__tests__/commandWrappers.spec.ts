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
	])("%j is still auto-approved when everything it runs is allowed", (command, allow) => {
		expect(getCommandDecision(command, allow, ["rm", "git push"])).toBe("auto_approve")
	})

	it("stops following wrappers past a depth and asks", () => {
		const deep = `${"env ".repeat(12)}npm test`
		expect(getCommandDecision(deep, ["env", "npm test"], [])).toBe("ask_user")
	})
})
