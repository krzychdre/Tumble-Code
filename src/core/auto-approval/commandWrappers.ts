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
 * does not show (an expanded payload, a git config value naming a program).
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
}

const NOTHING: UnwrappedCommand = { commands: [], opaque: false, tails: [] }

/** The program a command word names, without its directory: `/usr/bin/env` is `env`. */
export function programName(word: string): string {
	return word.split(/[\\/]/).pop() ?? word
}

const raw = (words: ShellWord[]) => words.map((word) => word.raw).join(" ")

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
function runs(args: ShellWord[], start: number | null): Omit<UnwrappedCommand, "tails"> {
	if (start === null) {
		return { commands: [], opaque: true }
	}
	const rest = args.slice(start)
	return { commands: rest.length > 0 ? [raw(rest)] : [], opaque: false }
}

/** A payload a program hands to a shell: `sh -c PAYLOAD`, `git submodule foreach PAYLOAD`. */
function payload(words: ShellWord[]): Omit<UnwrappedCommand, "tails"> {
	if (words.length === 0) {
		return { commands: [], opaque: false }
	}
	const text = literalText(words)
	return text === null ? { commands: [], opaque: true } : { commands: [text], opaque: false }
}

const SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh", "ash", "mksh", "fish"])
const SHELL_VALUED = ["-o", "+o", "-O", "+O", "--rcfile", "--init-file", "-C", "--init-command"]

/** `bash -c 'cmd'`, `sh -ec 'cmd'`, `fish --command='cmd'`; a script file is a program like any other. */
function unwrapShell(args: ShellWord[]): Omit<UnwrappedCommand, "tails"> {
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
function unwrapEnv(args: ShellWord[]): Omit<UnwrappedCommand, "tails"> {
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
function unwrapFind(args: ShellWord[]): Omit<UnwrappedCommand, "tails"> {
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
	return { commands, opaque: false }
}

const GIT_VALUED = ["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--config-env", "--super-prefix"]

/**
 * `git -C dir push` is checked as `git push`. A config given on the command
 * line (`-c core.sshCommand=...`) or an exec path can name any program, so it
 * is never approved automatically; nor are the subcommands that run a command
 * they are given (`submodule foreach`, `rebase --exec`, `bisect run`), whose
 * command is checked too.
 */
function unwrapGit(args: ShellWord[]): Omit<UnwrappedCommand, "tails"> {
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
	let nested: Omit<UnwrappedCommand, "tails"> = { commands: [], opaque: false }
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
function unwrapPackageRunner(args: ShellWord[]): Omit<UnwrappedCommand, "tails"> {
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

type Unwrapper = (args: ShellWord[]) => Omit<UnwrappedCommand, "tails">

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
	taskset: (args) => {
		if (args.some((word) => word.literal === "-p" || word.literal === "--pid")) {
			return { commands: [], opaque: false }
		}
		const mask = afterOptions(args, [])
		return runs(args, mask === null ? null : mask + 1)
	},
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
const EXACT_UNWRAPPERS = new Set(["find", "git", "eval", "command"])

/** What the command `words` (its command word first) runs besides itself. */
export function unwrapCommand(words: ShellWord[]): UnwrappedCommand {
	const [commandWord, ...args] = words
	const name = commandWord?.literal === null || !commandWord ? undefined : programName(commandWord.literal)
	if (!name) {
		return NOTHING
	}

	let unwrapped: Omit<UnwrappedCommand, "tails"> | undefined
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
	} else if (name in RUNNER_SUBCOMMANDS) {
		const sub = afterOptions(args, [])
		const subcommand = sub === null ? null : args[sub]?.literal
		unwrapped =
			sub !== null && subcommand && RUNNER_SUBCOMMANDS[name].includes(subcommand)
				? unwrapPackageRunner(args.slice(sub + 1))
				: undefined
		exact = false
	} else if (name in UNWRAPPERS) {
		unwrapped = UNWRAPPERS[name](args)
		exact = EXACT_UNWRAPPERS.has(name)
	} else if (name in SIMPLE_WRAPPERS) {
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
