import type { ShellWord } from "@tumble-code/core/browser"

/**
 * Commands that run another command: `env rm -rf x`, `sh -c 'rm -rf x'`,
 * `find . -exec rm {} +`, `git -C repo push`. The allow and deny lists match
 * the start of a command, so without looking inside them a wrapper carries a
 * denied program past the deny list, and an allowed wrapper (`*`, `npm`) lets
 * any program through.
 *
 * `unwrapCommand` returns the commands a wrapper runs, as command text to be
 * checked like any other command, and says when it runs something the text
 * does not show (an expanded payload, a git config value naming a program)
 * or code in another language (`python3 -c`, `gdb -ex`, an awk program).
 */
export interface UnwrappedCommand {
	/** The commands the wrapper runs, each as shell text. */
	commands: string[]
	/** The wrapper runs something that cannot be read from the text: never auto-approve. */
	opaque: boolean
	/**
	 * For a wrapper whose command simply follows its options (`nice`, `env`,
	 * `xargs`...): every tail of its arguments, by value. A denied command found
	 * in one means the command is not approved automatically, even when the
	 * option parsing below guessed wrong about an option's value.
	 */
	tails: string[]
	/**
	 * Program text in another language that the command runs (`python3 -c
	 * CODE`, `node -e CODE`, `gdb -ex CMD`, `vim -c CMD`, an awk program that
	 * can run a program or open a file): whatever it runs or touches cannot be
	 * read from the text. Null for code only known after expansion.
	 */
	code: (string | null)[]
}

/** What a wrapper runs, before the tails and code are added. */
type Runs = Pick<UnwrappedCommand, "commands" | "opaque">

const NOTHING: Omit<UnwrappedCommand, "code"> = { commands: [], opaque: false, tails: [] }

/** The program a command word names, without its directory: `/usr/bin/env` is `env`. */
export function programName(word: string): string {
	return word.split(/[\\/]/).pop() ?? word
}

const raw = (words: ShellWord[]) => words.map((word) => word.raw).join(" ")

/**
 * The path a shell word names once the shell has expanded a leading `~`,
 * `~/`, `$HOME` or `${HOME}`, quotes removed. Null when the word holds another
 * expansion (`$DIR`, `$(...)`, backticks, `~user`): the path is only known
 * when the command runs. A glob (`sec*`) stays as written.
 */
export function expandedPath(word: ShellWord, home: string): string | null {
	if (word.literal !== null && !word.raw.startsWith("~")) {
		return word.literal
	}
	const prefix = /^(?:~(?=\/|$)|"?\$(?:\{HOME\}|HOME(?![A-Za-z0-9_])))/.exec(word.raw)?.[0] ?? ""
	const rest = word.raw.slice(prefix.length)
	if (/[$`]/.test(rest) || rest.startsWith("~")) {
		return null
	}
	return (prefix ? home : "") + rest.replace(/["']/g, "")
}

/** The words' values joined by spaces, or null when one is only known after expansion. */
function literalText(words: ShellWord[]): string | null {
	const values = words.map((word) => word.literal)
	return values.some((value) => value === null) ? null : values.join(" ")
}

/**
 * Index of the first argument after the options. The `valued` options take
 * the next argument unless written `-xVALUE` or `--long=VALUE`. Null when an
 * option word is expanded, so where the options end is unknown.
 */
function afterOptions(args: ShellWord[], valued: readonly string[], start = 0): number | null {
	let index = start
	while (index < args.length) {
		const arg = args[index].literal
		if (arg === null) {
			return null
		}
		if (arg === "--") {
			return index + 1
		}
		if (!arg.startsWith("-") || arg === "-") {
			return index
		}
		index += valued.includes(arg) ? 2 : 1
	}
	return index
}

/** The command in `args` from `start` on, as text; nothing when none is left. */
function runs(args: ShellWord[], start: number | null): Runs {
	if (start === null) {
		return { commands: [], opaque: true }
	}
	const rest = args.slice(start)
	return { commands: rest.length > 0 ? [raw(rest)] : [], opaque: false }
}

/** A payload a program hands to a shell: `sh -c PAYLOAD`, `git submodule foreach PAYLOAD`. */
function payload(words: ShellWord[]): Runs {
	if (words.length === 0) {
		return { commands: [], opaque: false }
	}
	const text = literalText(words)
	return text === null ? { commands: [], opaque: true } : { commands: [text], opaque: false }
}

const SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh", "ash", "mksh", "fish"])
const SHELL_VALUED = ["-o", "+o", "-O", "+O", "--rcfile", "--init-file", "-C", "--init-command"]

/** `bash -c 'cmd'`, `sh -ec 'cmd'`, `fish --command='cmd'`; a script file is a program like any other. */
function unwrapShell(args: ShellWord[]): Runs {
	for (let index = 0; index < args.length; index++) {
		const arg = args[index].literal
		if (arg === null) {
			return { commands: [], opaque: true }
		}
		if (arg.startsWith("--command=")) {
			return { commands: [arg.slice("--command=".length)], opaque: false }
		}
		if (arg === "--command") {
			return payload(args.slice(index + 1, index + 2))
		}
		if (arg === "--" || !/^[-+]/.test(arg)) {
			return { commands: [], opaque: false }
		}
		if (SHELL_VALUED.includes(arg)) {
			index++
			continue
		}
		if (!arg.startsWith("--") && arg.slice(1).includes("c")) {
			return payload(args.slice(index + 1, index + 2))
		}
	}
	return { commands: [], opaque: false }
}

/** `env [-i] [-u NAME] [NAME=VALUE...] cmd`, and `env -S 'cmd args'`. */
function unwrapEnv(args: ShellWord[]): Runs {
	let index = 0
	while (index < args.length) {
		const arg = args[index].literal
		if (arg === null) {
			return { commands: [], opaque: true }
		}
		if (arg === "-S" || arg === "--split-string") {
			return payload(args.slice(index + 1))
		}
		if (arg.startsWith("--split-string=") || (arg.startsWith("-S") && arg.length > 2)) {
			const split = arg.startsWith("-S") ? arg.slice(2) : arg.slice("--split-string=".length)
			const rest = literalText(args.slice(index + 1))
			return rest === null
				? { commands: [], opaque: true }
				: { commands: [`${split} ${rest}`.trim()], opaque: false }
		}
		if (arg === "--") {
			index++
			break
		}
		if (!arg.startsWith("-") || arg === "-") {
			break
		}
		index += ["-u", "--unset", "-C", "--chdir"].includes(arg) ? 2 : 1
	}
	while (index < args.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(args[index].literal ?? "")) {
		index++
	}
	return runs(args, index)
}

/** `find ... -exec cmd {} ;` and `-execdir`, `-ok`, `-okdir`, as many as there are. */
function unwrapFind(args: ShellWord[]): Runs {
	const commands: string[] = []
	for (let index = 0; index < args.length; index++) {
		if (!["-exec", "-execdir", "-ok", "-okdir"].includes(args[index].literal ?? "")) {
			continue
		}
		const start = index + 1
		let end = start
		while (end < args.length && args[end].literal !== ";" && args[end].literal !== "+") {
			end++
		}
		if (end > start) {
			commands.push(raw(args.slice(start, end)))
		}
		index = end
	}
	if (args.some((word) => word.literal === "-delete")) {
		commands.push("rm")
	}
	return { commands, opaque: false }
}

/** The payload of `-c CMD`, also written `-qc CMD`, `--command CMD` or `--command=CMD` (`su`, `script`). */
function commandOption(args: ShellWord[], long: readonly string[]): Runs {
	for (let index = 0; index < args.length; index++) {
		const arg = args[index].literal
		if (arg === null) {
			return { commands: [], opaque: true }
		}
		const attached = long.find((name) => arg.startsWith(`${name}=`))
		if (attached) {
			return { commands: [arg.slice(attached.length + 1)], opaque: false }
		}
		if (long.includes(arg) || /^-[A-Za-z]*c$/.test(arg)) {
			return payload(args.slice(index + 1, index + 2))
		}
	}
	return { commands: [], opaque: false }
}

/** `taskset MASK cmd`, `chrt PRIORITY cmd`; with `-p` they act on a running process and run nothing. */
function afterOneValue(args: ShellWord[], valued: readonly string[]): Runs {
	if (args.some((word) => word.literal === "-p" || word.literal === "--pid")) {
		return { commands: [], opaque: false }
	}
	const value = afterOptions(args, valued)
	return runs(args, value === null ? null : value + 1)
}

const PARALLEL_VALUED = [
	"-j",
	"--jobs",
	"-S",
	"--sshlogin",
	"-a",
	"--arg-file",
	"-d",
	"--delimiter",
	"-E",
	"-I",
	"-n",
	"--max-args",
	"-N",
	"-L",
	"--max-lines",
	"--colsep",
	"--delay",
	"--timeout",
	"--joblog",
	"--results",
	"--tmpdir",
	"--workdir",
	"--env",
	"--halt",
]

/**
 * `parallel [options] cmd ::: args`. Without a command, each argument after
 * `:::` is a command, and with no `:::` either the commands come from stdin.
 */
function unwrapParallel(args: ShellWord[]): Runs {
	const start = afterOptions(args, PARALLEL_VALUED)
	if (start === null) {
		return { commands: [], opaque: true }
	}
	const marker = args.findIndex((word, index) => index >= start && /^::::?\+?$/.test(word.literal ?? ""))
	const end = marker === -1 ? args.length : marker
	if (end > start) {
		return { commands: [raw(args.slice(start, end))], opaque: false }
	}
	if (marker === -1) {
		return { commands: [], opaque: true }
	}
	const inputs = args.slice(marker + 1).filter((word) => !/^::::?\+?$/.test(word.literal ?? ""))
	if (inputs.some((word) => word.literal === null)) {
		return { commands: [], opaque: true }
	}
	return { commands: inputs.map((word) => word.literal as string), opaque: false }
}

const SSH_VALUED = [
	"-b",
	"-c",
	"-D",
	"-E",
	"-e",
	"-F",
	"-I",
	"-i",
	"-J",
	"-L",
	"-l",
	"-m",
	"-O",
	"-o",
	"-p",
	"-Q",
	"-R",
	"-S",
	"-W",
	"-w",
	"-B",
]

/**
 * `ssh host cmd args` runs `cmd args` in the remote shell. An `-o` option
 * naming a command (`ProxyCommand`, `LocalCommand`) or another config file
 * (`-F`) can run a local program, so it is never approved automatically.
 */
function unwrapSsh(args: ShellWord[]): Runs {
	const host = afterOptions(args, SSH_VALUED)
	if (host === null) {
		return { commands: [], opaque: true }
	}
	const options = args.slice(0, host).map((word, index, all) => {
		const option = word.literal ?? ""
		return option === "-o" ? `-o${all[index + 1]?.literal ?? ""}` : option
	})
	const opaque = options.some((option) => /^-F/.test(option) || /^-o.*command/i.test(option))
	const command = payload(args.slice(host + 1))
	return { commands: command.commands, opaque: opaque || command.opaque }
}

/** `gdb [options] --args program args` debugs (runs) the program. */
function unwrapGdb(args: ShellWord[]): Runs {
	const program = args.findIndex((word) => word.literal === "--args")
	return program === -1 ? { commands: [], opaque: false } : runs(args, program + 1)
}

const GIT_VALUED = ["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--config-env", "--super-prefix"]

/**
 * `git -C dir push` is checked as `git push`. A config given on the command
 * line (`-c core.sshCommand=...`) or an exec path can name any program, so it
 * is never approved automatically; nor are the subcommands that run a command
 * they are given (`submodule foreach`, `rebase --exec`, `bisect run`), whose
 * command is checked too.
 */
function unwrapGit(args: ShellWord[]): Runs {
	const start = afterOptions(args, GIT_VALUED)
	if (start === null) {
		return { commands: [], opaque: true }
	}
	const options = args.slice(0, start).map((word) => word.literal ?? "")
	const opaque = options.some(
		(option) =>
			option === "-c" ||
			option === "--config-env" ||
			option.startsWith("--config-env=") ||
			option.startsWith("--exec-path") ||
			(option.startsWith("-c") && option.length > 2),
	)
	const rest = args.slice(start)
	const commands = start > 0 && rest.length > 0 ? [`git ${raw(rest)}`] : []

	const subcommand = rest[0]?.literal
	const subArgs = rest.slice(1)
	let nested: Runs = { commands: [], opaque: false }
	if (subcommand === "submodule") {
		const foreach = subArgs.findIndex((word) => word.literal === "foreach")
		if (foreach !== -1) {
			const after = afterOptions(subArgs, [], foreach + 1)
			nested = after === null ? { commands: [], opaque: true } : payload(subArgs.slice(after))
		}
	} else if (subcommand === "rebase") {
		for (let index = 0; index < subArgs.length; index++) {
			const arg = subArgs[index].literal
			if (arg === null) {
				nested = { commands: [], opaque: true }
				break
			}
			if (arg === "-x" || arg === "--exec") {
				const command = payload(subArgs.slice(index + 1, index + 2))
				nested = {
					commands: [...nested.commands, ...command.commands],
					opaque: nested.opaque || command.opaque,
				}
				index++
			} else if (arg.startsWith("--exec=")) {
				nested = { ...nested, commands: [...nested.commands, arg.slice("--exec=".length)] }
			}
		}
	} else if (subcommand === "bisect" && subArgs[0]?.literal === "run") {
		nested = runs(subArgs, 1)
	}

	return { commands: [...commands, ...nested.commands], opaque: opaque || nested.opaque }
}

/** `npx [-y] [-p pkg] cmd`, `npx -c 'cmd'`, and the same after `npm exec`, `pnpm dlx` and the like. */
function unwrapPackageRunner(args: ShellWord[]): Runs {
	for (let index = 0; index < args.length; index++) {
		const arg = args[index].literal
		if (arg === "-c" || arg === "--call") {
			return payload(args.slice(index + 1, index + 2))
		}
		if (arg?.startsWith("--call=")) {
			return { commands: [arg.slice("--call=".length)], opaque: false }
		}
	}
	return runs(args, afterOptions(args, ["-p", "--package", "--filter", "-F", "-C", "--dir", "--cwd"]))
}

/** Package managers whose subcommand runs a program: `npm exec`, `pnpm dlx`, `yarn exec`, `bun x`. */
const RUNNER_SUBCOMMANDS: Record<string, string[]> = {
	npm: ["exec", "x"],
	pnpm: ["exec", "dlx"],
	yarn: ["exec", "dlx"],
	bun: ["x", "exec"],
}

type Unwrapper = (args: ShellWord[]) => Runs

/** Each wrapper with the options that take a value; its command follows the options. */
const SIMPLE_WRAPPERS: Record<string, readonly string[]> = {
	nohup: [],
	setsid: [],
	builtin: [],
	unbuffer: [],
	nice: ["-n", "--adjustment"],
	exec: ["-a"],
	time: ["-f", "--format", "-o", "--output"],
	stdbuf: ["-i", "-o", "-e", "--input", "--output", "--error"],
	ionice: ["-c", "--class", "-n", "--classdata"],
	busybox: [],
	firejail: [],
	fakeroot: ["-l", "--lib", "--faked", "-s", "-i", "-b"],
	strace: ["-e", "-o", "-p", "-s", "-u", "-E", "-a", "-b", "-I", "-O", "-S", "-P", "-X"],
	ltrace: ["-e", "-o", "-p", "-s", "-u", "-a", "-n", "-l", "-x", "-A", "-D", "-F"],
	cpulimit: ["-l", "--limit", "-p", "--pid", "-e", "--exe", "-P", "--path", "-c", "--cpu", "-s", "--signal"],
	"systemd-run": [
		"-p",
		"--property",
		"-u",
		"--unit",
		"-E",
		"--setenv",
		"-M",
		"--machine",
		"-H",
		"--host",
		"--description",
		"--slice",
		"--uid",
		"--gid",
		"--nice",
		"--working-directory",
	],
	doas: ["-u", "-C"],
	sudo: [
		"-u",
		"--user",
		"-g",
		"--group",
		"-h",
		"--host",
		"-p",
		"--prompt",
		"-C",
		"--close-from",
		"-D",
		"--chdir",
		"-r",
		"--role",
		"-t",
		"--type",
		"-U",
		"--other-user",
		"-T",
		"--command-timeout",
	],
}

const UNWRAPPERS: Record<string, Unwrapper> = {
	env: unwrapEnv,
	find: unwrapFind,
	git: unwrapGit,
	eval: (args) => payload(args),
	npx: unwrapPackageRunner,
	pnpx: unwrapPackageRunner,
	bunx: unwrapPackageRunner,
	command: (args) =>
		args.some((word) => word.literal === "-v" || word.literal === "-V")
			? { commands: [], opaque: false }
			: runs(args, afterOptions(args, [])),
	timeout: (args) => {
		const duration = afterOptions(args, ["-s", "--signal", "-k", "--kill-after"])
		return runs(args, duration === null ? null : duration + 1)
	},
	chroot: (args) => {
		const root = afterOptions(args, ["--userspec", "--groups"])
		return runs(args, root === null ? null : root + 1)
	},
	taskset: (args) => afterOneValue(args, []),
	chrt: (args) => afterOneValue(args, ["-T", "--sched-runtime", "-P", "--sched-period", "-D", "--sched-deadline"]),
	su: (args) => commandOption(args, ["--command", "--session-command"]),
	script: (args) => commandOption(args, ["--command"]),
	parallel: unwrapParallel,
	ssh: unwrapSsh,
	gdb: unwrapGdb,
	xargs: (args) => {
		const start = afterOptions(args, [
			"-a",
			"--arg-file",
			"-d",
			"--delimiter",
			"-E",
			"-I",
			"-L",
			"-n",
			"--max-args",
			"-P",
			"--max-procs",
			"-s",
			"--max-chars",
			"--process-slot-var",
		])
		return runs(args, start)
	},
	watch: (args) => runs(args, afterOptions(args, ["-n", "--interval", "-q", "--equexit"])),
	flock: (args) => {
		const file = afterOptions(args, ["-w", "--timeout", "-E", "--conflict-exit-code"])
		if (file === null) {
			return { commands: [], opaque: true }
		}
		const next = args[file + 1]?.literal
		return next === "-c" || next === "--command" ? payload(args.slice(file + 2, file + 3)) : runs(args, file + 1)
	},
}

/** The unwrappers that read their payload exactly (see `tails`). */
const EXACT_UNWRAPPERS = new Set(["find", "git", "eval", "command", "su", "script", "gdb"])

/** Interpreters and the options that hand them program text; `+` is vim's `+CMD`. */
const CODE_OPTIONS: Record<string, readonly string[]> = {
	python: ["-c"],
	python2: ["-c"],
	python3: ["-c"],
	pypy: ["-c"],
	pypy3: ["-c"],
	node: ["-e", "--eval", "-p", "--print"],
	nodejs: ["-e", "--eval", "-p", "--print"],
	perl: ["-e", "-E"],
	ruby: ["-e"],
	php: ["-r"],
	lua: ["-e"],
	luajit: ["-e"],
	Rscript: ["-e"],
	osascript: ["-e"],
	gdb: [
		"-ex",
		"--ex",
		"-iex",
		"--iex",
		"-eval-command",
		"--eval-command",
		"-init-eval-command",
		"--init-eval-command",
	],
	vi: ["-c", "--cmd", "+"],
	vim: ["-c", "--cmd", "+"],
	nvim: ["-c", "--cmd", "+"],
	ex: ["-c", "--cmd", "+"],
	view: ["-c", "--cmd", "+"],
}

/**
 * The code words of an interpreter: the word after an option (`-c CODE`, a
 * short-option cluster ending in it such as perl's `-ne CODE`), or attached
 * (`--eval=CODE`, `-eCODE`, vim's `+CMD`; a bare line number `+10` is no code).
 */
function codeOptions(args: ShellWord[], options: readonly string[]): (string | null)[] {
	const code: (string | null)[] = []
	for (let index = 0; index < args.length; index++) {
		const arg = args[index].literal
		if (arg === null) {
			continue
		}
		for (const option of options) {
			const letter = /^-[A-Za-z]$/.test(option) ? option[1] : null
			if (arg === option || (letter && new RegExp(`^-[A-Za-z0-9]*${letter}$`).test(arg))) {
				code.push(args[index + 1]?.literal ?? null)
				index++
				break
			}
			if (arg.startsWith(`${option}=`)) {
				code.push(arg.slice(option.length + 1))
				break
			}
			if ((letter || option === "+") && arg.startsWith(option) && arg.length > option.length) {
				if (option !== "+" || !/^\+\d*$/.test(arg)) {
					code.push(arg.slice(option.length))
				}
				break
			}
		}
	}
	return code
}

const AWKS = new Set(["awk", "gawk", "mawk", "nawk"])
/** What lets an awk program run a program (`system()`, `| "cmd"`) or open a file (`getline <`, `print >`). */
const AWK_REACH = /system|getline|[|>]/

/** The program text of `awk [-F sep] [-v var=value] 'program' files`, when it can reach beyond its input. */
function awkProgram(args: ShellWord[]): (string | null)[] {
	const code: (string | null)[] = []
	let fromFile = false
	let index = 0
	while (index < args.length) {
		const arg = args[index].literal
		if (arg === "-f" || arg === "--file") {
			fromFile = true
		} else if (arg === "-e" || arg === "--source") {
			code.push(args[index + 1]?.literal ?? null)
		} else if (arg === "--") {
			index++
			break
		} else if (arg === null || !arg.startsWith("-") || arg === "-") {
			break
		}
		index += ["-f", "--file", "-e", "--source", "-v", "-F"].includes(arg) ? 2 : 1
	}
	if (!fromFile && code.length === 0 && index < args.length) {
		code.push(args[index].literal)
	}
	return code.filter((text) => text === null || AWK_REACH.test(text))
}

/** What the command `words` (its command word first) runs besides itself. */
export function unwrapCommand(words: ShellWord[]): UnwrappedCommand {
	const [commandWord, ...args] = words
	const name = commandWord?.literal === null || !commandWord ? undefined : programName(commandWord.literal)
	if (!name) {
		return { ...NOTHING, code: [] }
	}
	const code = AWKS.has(name)
		? awkProgram(args)
		: Object.hasOwn(CODE_OPTIONS, name)
			? codeOptions(args, CODE_OPTIONS[name])
			: []
	return { ...unwrapWrapper(name, args), code }
}

function unwrapWrapper(name: string, args: ShellWord[]): Omit<UnwrappedCommand, "code"> {
	let unwrapped: Runs | undefined
	// Wrappers whose payload is one argument or a marked span (a shell's -c,
	// find's -exec, git's subcommands) are read exactly; their other arguments
	// are data, so no tails.
	let exact = true
	if (SHELLS.has(name)) {
		unwrapped = unwrapShell(args)
	} else if (name === "pwsh" || name === "powershell" || name === "powershell.exe") {
		// PowerShell is not shell syntax this analysis can read.
		const runsText = args.some((word) =>
			["-c", "-command", "-encodedcommand", "-e", "-ec"].includes((word.literal ?? "-c").toLowerCase()),
		)
		unwrapped = { commands: [], opaque: runsText }
	} else if (Object.hasOwn(RUNNER_SUBCOMMANDS, name)) {
		const sub = afterOptions(args, [])
		const subcommand = sub === null ? null : args[sub]?.literal
		unwrapped =
			sub !== null && subcommand && RUNNER_SUBCOMMANDS[name].includes(subcommand)
				? unwrapPackageRunner(args.slice(sub + 1))
				: undefined
		exact = false
	} else if (Object.hasOwn(UNWRAPPERS, name)) {
		unwrapped = UNWRAPPERS[name](args)
		exact = EXACT_UNWRAPPERS.has(name)
	} else if (Object.hasOwn(SIMPLE_WRAPPERS, name)) {
		unwrapped = runs(args, afterOptions(args, SIMPLE_WRAPPERS[name]))
		exact = false
	}

	if (!unwrapped) {
		return NOTHING
	}
	const tails = exact
		? []
		: args.map((_, index) =>
				args
					.slice(index)
					.map((word) => word.literal ?? word.raw)
					.join(" "),
			)
	return { ...unwrapped, tails }
}
