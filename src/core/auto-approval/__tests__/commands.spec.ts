import { containsDangerousSubstitution, getCommandDecision } from "../commands"

describe("containsDangerousSubstitution", () => {
	describe("zsh array assignments (should NOT be flagged)", () => {
		it("should return false for files=(a b c)", () => {
			expect(containsDangerousSubstitution("files=(a b c)")).toBe(false)
		})

		it("should return false for var=(item1 item2)", () => {
			expect(containsDangerousSubstitution("var=(item1 item2)")).toBe(false)
		})

		it("should return false for x=(hello)", () => {
			expect(containsDangerousSubstitution("x=(hello)")).toBe(false)
		})
	})

	describe("zsh process substitution (should be flagged)", () => {
		it("should return true for standalone =(whoami)", () => {
			expect(containsDangerousSubstitution("=(whoami)")).toBe(true)
		})

		it("should return true for =(ls) with leading space", () => {
			expect(containsDangerousSubstitution(" =(ls)")).toBe(true)
		})

		it("should return true for echo =(cat /etc/passwd)", () => {
			expect(containsDangerousSubstitution("echo =(cat /etc/passwd)")).toBe(true)
		})
	})
})

describe("getCommandDecision", () => {
	it("should auto_approve array assignment command with wildcard allowlist", () => {
		const command = 'files=(a.ts b.ts); for f in "${files[@]}"; do echo "$f"; done'
		const result = getCommandDecision(command, ["*"])
		expect(result).toBe("auto_approve")
	})
})

describe("containsDangerousSubstitution — node -e one-liner false positive regression", () => {
	const nodeOneLiner = `node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('prd.json','utf8'));const allowed=new Set(['pending','in-progress','complete','blocked']);const bad=(p.items||[]).filter(i=>!allowed.has(i.status));console.log('meta.status',p.meta?.status);console.log('workstreams', (p.workstreams||[]).length);console.log('items', (p.items||[]).length);console.log('statusCounts', (p.items||[]).reduce((a,i)=>(a[i.status]=(a[i.status]||0)+1,a),{}));console.log('invalidStatuses', bad.length);if(bad.length){console.log(bad.map(i=>i.id+':'+i.status).join('\\\\n'));process.exit(2);} "`

	it("should NOT flag the complex node -e one-liner as dangerous substitution", () => {
		expect(containsDangerousSubstitution(nodeOneLiner)).toBe(false)
	})
})

describe("containsDangerousSubstitution — arrow function patterns (should NOT be flagged)", () => {
	it("should return false for node -e with simple arrow function", () => {
		expect(containsDangerousSubstitution(`node -e "const a=(b)=>b"`)).toBe(false)
	})

	it("should return false for node -e with spaced arrow function", () => {
		expect(containsDangerousSubstitution(`node -e "const fn = (x) => x * 2"`)).toBe(false)
	})

	it("should return false for node -e with arrow function in method chain", () => {
		expect(containsDangerousSubstitution(`node -e "arr.filter(i=>!set.has(i))"`)).toBe(false)
	})
})

describe("containsDangerousSubstitution — true positives still caught", () => {
	it("should flag dangerous parameter expansion ${var@P}", () => {
		expect(containsDangerousSubstitution('echo "${var@P}"')).toBe(true)
	})

	it("should flag here-string with command substitution <<<$(…)", () => {
		expect(containsDangerousSubstitution("cat <<<$(whoami)")).toBe(true)
	})

	it("should flag indirect variable reference ${!var}", () => {
		expect(containsDangerousSubstitution("echo ${!prefix}")).toBe(true)
	})

	it("should flag zsh process substitution =(…) at start of token", () => {
		expect(containsDangerousSubstitution("echo =(cat /etc/passwd)")).toBe(true)
	})

	it("should flag zsh glob qualifier with code execution", () => {
		expect(containsDangerousSubstitution("ls *(e:whoami:)")).toBe(true)
	})
})

describe("getCommandDecision — integration with dangerous substitution checks", () => {
	const allowedCommands = ["node", "echo"]

	it("should auto-approve the complex node -e one-liner when node is allowed", () => {
		const nodeOneLiner = `node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('prd.json','utf8'));const allowed=new Set(['pending','in-progress','complete','blocked']);const bad=(p.items||[]).filter(i=>!allowed.has(i.status));console.log('meta.status',p.meta?.status);console.log('workstreams', (p.workstreams||[]).length);console.log('items', (p.items||[]).length);console.log('statusCounts', (p.items||[]).reduce((a,i)=>(a[i.status]=(a[i.status]||0)+1,a),{}));console.log('invalidStatuses', bad.length);if(bad.length){console.log(bad.map(i=>i.id+':'+i.status).join('\\\\n'));process.exit(2);} "`

		expect(getCommandDecision(nodeOneLiner, allowedCommands)).toBe("auto_approve")
	})

	it("should ask user for echo $(whoami) because subshell whoami is not in the allowlist", () => {
		expect(getCommandDecision("echo $(whoami)", allowedCommands)).toBe("ask_user")
	})

	it("should ask user for dangerous parameter expansion even when command is allowed", () => {
		expect(getCommandDecision('echo "${var@P}"', allowedCommands)).toBe("ask_user")
	})
})

describe("getCommandDecision — multi-line script wrapped in a quoted argument", () => {
	// A wrapper command (e.g. sh -c '...') carrying a multi-line script as a
	// single quoted argument must be treated as one command. The embedded
	// newlines belong to the quoted string and must not be mistaken for a
	// multi-statement sequence that would defeat allowlist auto-approval.
	const wrappedSingleQuoted = [
		`sh -c 'kubectl exec pod -- python3 -c "`,
		`import urllib.request`,
		`url = \\"http://127.0.0.1:49527/\\"`,
		`try:`,
		`    with urllib.request.urlopen(url, timeout=10) as r:`,
		`        print(r.status)`,
		`except Exception as e:`,
		`    print(\\"fetch failed:\\", e)`,
		`"'`,
	].join("\n")

	it("auto-approves a multi-line single-quoted script when the wrapper prefix is allowed", () => {
		expect(getCommandDecision(wrappedSingleQuoted, ["sh"])).toBe("auto_approve")
	})

	it("auto-approves a multi-line double-quoted script when the wrapper prefix is allowed", () => {
		const wrappedDoubleQuoted = 'sh -c "echo line1\necho line2"'
		expect(getCommandDecision(wrappedDoubleQuoted, ["sh"])).toBe("auto_approve")
	})

	it("asks user when the wrapper prefix is not in the allowlist", () => {
		expect(getCommandDecision(wrappedSingleQuoted, ["git"])).toBe("ask_user")
	})

	it("still splits genuine multi-statement scripts and asks when a statement is not allowed", () => {
		// Real unquoted newlines separate independent statements; each must be on
		// the allowlist for auto-approval to engage.
		const multiStatement = "echo hello\nrm -rf /tmp/x"
		expect(getCommandDecision(multiStatement, ["echo"])).toBe("ask_user")
	})

	it("auto-approves a genuine multi-statement script when every statement is allowed", () => {
		const multiStatement = "echo hello\nls -la"
		expect(getCommandDecision(multiStatement, ["echo", "ls"])).toBe("auto_approve")
	})

	it("auto-approves an ANSI-C quoted ($'...') multi-line argument when the wrapper prefix is allowed", () => {
		const ansiC = "sh -c $'echo 1\necho 2'"
		expect(getCommandDecision(ansiC, ["sh"])).toBe("auto_approve")
	})

	it("returns malformed_command for a command with an unterminated quote regardless of allowlist", () => {
		// An unterminated quote is a shell syntax error. Even if the leading word
		// is on the allowlist (or the allowlist is the wildcard), or the exact
		// full command string is listed, the command must not be auto-approved --
		// the shell would report a syntax error and any prefix that ran before
		// the error could have unintended side effects.
		const malformed = "sh -c 'echo a\necho b"
		expect(getCommandDecision(malformed, ["sh"])).toBe("malformed_command")
		expect(getCommandDecision(malformed, ["*"])).toBe("malformed_command")
		expect(getCommandDecision(malformed, [malformed])).toBe("malformed_command")
	})
})

// DEF-S1: the splitter must see the same sub-commands bash runs. Every case
// below was checked against bash: the denied command after the operator runs.
// A split that hides it lets a denied command ride on an allowed one.
describe("getCommandDecision - denied commands the splitter must not hide (DEF-S1)", () => {
	const deny = ["rm", "git push"]

	it.each([
		["escaped single quote", "echo \\' && rm -rf /tmp/x \\'", ["echo"]],
		["escaped double quote", 'echo \\" && rm -rf /tmp/x \\"', ["echo"]],
		["escaped backtick", "echo \\` && rm -rf /tmp/x \\`", ["*"]],
		["$( inside single quotes", "echo '$(x' && rm y && echo ')'", ["*"]],
		["backtick inside single quotes", "echo '`' && rm y && echo '`'", ["*"]],
		["escaped backtick inside double quotes", 'echo "\\`" && rm y && echo "\\`"', ["*"]],
		["command substitution inside double quotes", 'echo "$(rm -rf x)"', ["echo"]],
		["command substitution in an unquoted heredoc body", "cat <<EOF\n$(rm -rf x)\nEOF", ["cat"]],
		["operator after a heredoc opener", "cat <<EOF && rm -rf x\nbody\nEOF", ["cat"]],
		["command substitution in a parameter default", "echo ${x:-$(rm -rf x)}", ["echo"]],
		["command substitution in arithmetic", "echo $((1 + $(rm -rf x)))", ["echo"]],
		["nested backticks", "echo `echo \\`rm -rf x\\``", ["echo"]],
		["|& pipe", "echo a |& rm -rf x", ["echo"]],
		["subshell group", "(rm -rf x)", ["*"]],
		["brace group", "{ rm -rf x; }", ["*"]],
		["if/then body", "if true; then rm -rf x; fi", ["*"]],
		["loop body", "for f in a; do rm $f; done", ["*"]],
		["negation", "! rm -rf x", ["*"]],
		["coproc", "coproc rm -rf x", ["*"]],
		["function body", "f() { rm -rf x; }; f", ["*"]],
		["quoted command name", "'r'm -rf x", ["*"]],
		["escaped command name", "r\\m -rf x", ["*"]],
		["quoted argument of a denied prefix", 'git "push" origin', ["git"]],
		["environment assignment before the command", "FOO=1 rm -rf x", ["*"]],
		["line continuation before the operator", "echo a \\\n&& rm x", ["echo"]],
	])("%s: %j is denied", (_label, command, allow) => {
		expect(getCommandDecision(command, allow, deny)).toBe("auto_deny")
	})

	// A command word whose value is only known once the shell expands it cannot
	// be matched against either list, so it is never auto-approved.
	it.each([
		["variable as the command", "$CMD -rf x"],
		["ANSI-C quoted command name", "$'\\x72m' -rf x"],
		["glob in the command name", "/bin/r? -rf x"],
		["case statement", "case x in a) echo y;; esac"],
	])("%s: %j asks the user even with the * allow list", (_label, command) => {
		expect(getCommandDecision(command, ["*"], deny)).toBe("ask_user")
	})

	it.each([
		["plain chain", "git status && git log --oneline", ["git"]],
		["apostrophe inside double quotes", `echo "don't" && echo ok`, ["echo"]],
		["substitution whose command is allowed", "ls $(pwd)", ["ls", "pwd"]],
		["parameter expansion without a command", 'echo "$HOME"', ["echo"]],
		["redirection and pipe", "npm test 2>&1 | tail -20", ["npm test", "tail"]],
		["output redirection", "echo a > /tmp/out 2>&1", ["echo"]],
		["quoted heredoc delimiter keeps the body literal", "cat <<'EOF' > out.txt\n$(rm -rf x)\nEOF", ["cat"]],
		["single-quoted script argument", "sh -c 'echo a && rm b'", ["sh"]],
		["cd then build", "cd src && npm run build", ["cd", "npm run"]],
		[
			"commit message from a quoted heredoc inside a substitution",
			"git commit -m \"$(cat <<'EOF'\nfix: it's done\nEOF\n)\"",
			["git commit", "cat"],
		],
	])("%s: %j is still auto-approved", (_label, command, allow) => {
		expect(getCommandDecision(command, allow, deny)).toBe("auto_approve")
	})

	it("asks when a substitution inside a commit message runs a command that is not allowed", () => {
		const command = "git commit -m \"$(cat <<'EOF'\nfix: it's done\nEOF\n)\""
		expect(getCommandDecision(command, ["git commit"], deny)).toBe("ask_user")
	})
})
