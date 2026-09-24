import { type AnalyzedCommand, analyzeCommand } from "../../shared/parse-command"

/**
 * Detect dangerous parameter substitutions that could lead to command execution.
 * These patterns are never auto-approved and always require explicit user approval.
 *
 * Detected patterns:
 * - ${var@P} - Prompt string expansion (interprets escape sequences and executes embedded commands)
 * - ${var@Q} - Quote removal
 * - ${var@E} - Escape sequence expansion
 * - ${var@A} - Assignment statement
 * - ${var@a} - Attribute flags
 * - ${var=value} with escape sequences - Can embed commands via \140 (backtick), \x60, or \u0060
 * - ${!var} - Indirect variable references
 * - <<<$(...) or <<<`...` - Here-strings with command substitution
 * - =(...) - Zsh process substitution that executes commands (array assignments like `var=(...)` are excluded)
 * - *(e:...:) or similar - Zsh glob qualifiers with code execution
 *
 * @param source - The command string to analyze
 * @returns true if dangerous substitution patterns are detected, false otherwise
 */
export function containsDangerousSubstitution(source: string): boolean {
	// Check for dangerous parameter expansion operators that can execute commands
	// ${var@P} - Prompt string expansion (interprets escape sequences and executes embedded commands)
	// ${var@Q} - Quote removal
	// ${var@E} - Escape sequence expansion
	// ${var@A} - Assignment statement
	// ${var@a} - Attribute flags
	const dangerousParameterExpansion = /\$\{[^}]*@[PQEAa][^}]*\}/.test(source)

	// Check for parameter expansions with assignments that could contain escape sequences
	// ${var=value} or ${var:=value} can embed commands via escape sequences like \140 (backtick)
	// Also check for ${var+value}, ${var:-value}, ${var:+value}, ${var:?value}
	const parameterAssignmentWithEscapes =
		/\$\{[^}]*[=+\-?][^}]*\\[0-7]{3}[^}]*\}/.test(source) || // octal escapes
		/\$\{[^}]*[=+\-?][^}]*\\x[0-9a-fA-F]{2}[^}]*\}/.test(source) || // hex escapes
		/\$\{[^}]*[=+\-?][^}]*\\u[0-9a-fA-F]{4}[^}]*\}/.test(source) // unicode escapes

	// Check for indirect variable references that could execute commands
	// ${!var} performs indirect expansion which can be dangerous with crafted variable names
	const indirectExpansion = /\$\{![^}]+\}/.test(source)

	// Check for here-strings with command substitution
	// <<<$(...) or <<<`...` can execute commands
	const hereStringWithSubstitution = /<<<\s*(\$\(|`)/.test(source)

	// Check for zsh process substitution =(...) which executes commands
	// =(...) creates a temporary file containing the output of the command, but executes it
	const zshProcessSubstitution = /(?:(?<=^)|(?<=[\s;|&(<]))=\([^)]+\)/.test(source)

	// Check for zsh glob qualifiers with code execution (e:...:)
	// Patterns like *(e:whoami:) or ?(e:rm -rf /:) execute commands during glob expansion
	// This regex matches patterns like *(e:...:), ?(e:...:), +(e:...:), @(e:...:), !(e:...:)
	const zshGlobQualifier = /[*?+@!]\(e:[^:]+:\)/.test(source)

	// Return true if any dangerous pattern is detected
	return (
		dangerousParameterExpansion ||
		parameterAssignmentWithEscapes ||
		indirectExpansion ||
		hereStringWithSubstitution ||
		zshProcessSubstitution ||
		zshGlobQualifier
	)
}

/**
 * Find the longest matching prefix from a list of prefixes for a given command.
 *
 * This is the core function that implements the "longest prefix match" strategy.
 * It searches through all provided prefixes and returns the longest one that
 * matches the beginning of the command (case-insensitive).
 *
 * **Special Cases:**
 * - Wildcard "*" matches any command but is treated as length 1 for comparison
 * - Empty command or empty prefixes list returns null
 * - Matching is case-insensitive and uses startsWith logic
 *
 * **Examples:**
 * ```typescript
 * findLongestPrefixMatch("git push origin", ["git", "git push"])
 * // Returns "git push" (longer match)
 *
 * findLongestPrefixMatch("npm install", ["*", "npm"])
 * // Returns "npm" (specific match preferred over wildcard)
 *
 * findLongestPrefixMatch("unknown command", ["git", "npm"])
 * // Returns null (no match found)
 * ```
 *
 * @param command - The command to match against
 * @param prefixes - List of prefix patterns to search through
 * @returns The longest matching prefix, or null if no match found
 */
export function findLongestPrefixMatch(command: string, prefixes: string[]): string | null {
	if (!command || !prefixes?.length) {
		return null
	}

	const trimmedCommand = command.trim().toLowerCase()
	let longestMatch: string | null = null

	for (const prefix of prefixes) {
		const lowerPrefix = prefix.toLowerCase()
		// Handle wildcard "*" - it matches any command
		if (lowerPrefix === "*" || trimmedCommand.startsWith(lowerPrefix)) {
			if (!longestMatch || lowerPrefix.length > longestMatch.length) {
				longestMatch = lowerPrefix
			}
		}
	}

	return longestMatch
}

/**
 * Check if a single command should be auto-approved.
 * Returns true only for commands that explicitly match the allowlist
 * and either don't match the denylist or have a longer allowlist match.
 *
 * Special handling for wildcards: "*" in allowlist allows any command,
 * but denylist can still block specific commands.
 */
export function isAutoApprovedSingleCommand(
	command: string,
	allowedCommands: string[],
	deniedCommands?: string[],
): boolean {
	if (!command) {
		return true
	}

	// If no allowlist configured, nothing can be auto-approved
	if (!allowedCommands?.length) {
		return false
	}

	// Check if wildcard is present in allowlist
	const hasWildcard = allowedCommands.some((cmd) => cmd.toLowerCase() === "*")

	// If no denylist provided (undefined), use simple allowlist logic
	if (deniedCommands === undefined) {
		const trimmedCommand = command.trim().toLowerCase()

		return allowedCommands.some((prefix) => {
			const lowerPrefix = prefix.toLowerCase()
			// Handle wildcard "*" - it matches any command
			return lowerPrefix === "*" || trimmedCommand.startsWith(lowerPrefix)
		})
	}

	// Find longest matching prefix in both lists
	const longestDeniedMatch = findLongestPrefixMatch(command, deniedCommands)
	const longestAllowedMatch = findLongestPrefixMatch(command, allowedCommands)

	// Special case: if wildcard is present and no denylist match, auto-approve
	if (hasWildcard && !longestDeniedMatch) {
		return true
	}

	// Must have an allowlist match to be auto-approved
	if (!longestAllowedMatch) {
		return false
	}

	// If no denylist match, auto-approve
	if (!longestDeniedMatch) {
		return true
	}

	// Both have matches - allowlist must be longer to auto-approve
	return longestAllowedMatch.length > longestDeniedMatch.length
}

/**
 * Check if a single command should be auto-denied.
 * Returns true only for commands that explicitly match the denylist
 * and either don't match the allowlist or have a longer denylist match.
 */
export function isAutoDeniedSingleCommand(
	command: string,
	allowedCommands: string[],
	deniedCommands?: string[],
): boolean {
	if (!command) return false

	// If no denylist configured, nothing can be auto-denied
	if (!deniedCommands?.length) return false

	// Find longest matching prefix in both lists
	const longestDeniedMatch = findLongestPrefixMatch(command, deniedCommands)
	const longestAllowedMatch = findLongestPrefixMatch(command, allowedCommands || [])

	// Must have a denylist match to be auto-denied
	if (!longestDeniedMatch) return false

	// If no allowlist match, auto-deny
	if (!longestAllowedMatch) return true

	// Both have matches - denylist must be longer or equal to auto-deny
	return longestDeniedMatch.length >= longestAllowedMatch.length
}

/**
 * Command approval decision types
 */
export type CommandDecision = "auto_approve" | "auto_deny" | "ask_user" | "malformed_command"

/**
 * Unified command validation that implements the longest prefix match rule.
 * Returns a definitive decision for a command based on allowlist and denylist.
 *
 * This is the main entry point for command validation in the Command Denylist feature.
 * It handles complex command chains and applies the longest prefix match strategy
 * to resolve conflicts between allowlist and denylist patterns.
 *
 * **Decision Logic:**
 * 1. **Command Parsing**: Split the command into every command bash runs: chains (&&, ||, ;, |, |&, &),
 *    newlines, and the commands nested in substitutions, groups and unquoted heredoc bodies
 * 2. **Individual Validation**: For each sub-command, apply longest prefix match rule
 * 3. **Aggregation**: Combine decisions using "any denial blocks all" principle
 * 4. **Uncertain split and dangerous substitutions**: never auto-approved
 *
 * **Return Values:**
 * - `"auto_approve"`: All sub-commands are explicitly allowed and no dangerous patterns detected
 * - `"auto_deny"`: At least one sub-command is explicitly denied
 * - `"ask_user"`: Mixed or no matches found, requires user decision, contains dangerous patterns, or uses
 *   syntax the parser cannot split with certainty
 * - `"malformed_command"`: Command contains an unterminated quote -- a shell syntax error that must not be auto-approved
 *
 * **Examples:**
 * ```typescript
 * // Simple approval
 * getCommandDecision("git status", ["git"], [])
 * // Returns "auto_approve"
 *
 * // Dangerous pattern - never auto-approved
 * getCommandDecision('echo "${var@P}"', ["echo"], [])
 * // Returns "ask_user"
 *
 * // Longest prefix match - denial wins
 * getCommandDecision("git push origin", ["git"], ["git push"])
 * // Returns "auto_deny"
 *
 * // Command chain - any denial blocks all
 * getCommandDecision("git status && rm file", ["git"], ["rm"])
 * // Returns "auto_deny"
 *
 * // No matches - ask user
 * getCommandDecision("unknown command", ["git"], ["rm"])
 * // Returns "ask_user"
 * ```
 *
 * @param command - The full command string to validate
 * @param allowedCommands - List of allowed command prefixes
 * @param deniedCommands - Optional list of denied command prefixes
 * @returns Decision indicating whether to approve, deny, or ask user
 */
export function getCommandDecision(
	command: string,
	allowedCommands: string[],
	deniedCommands?: string[],
): CommandDecision {
	if (!command?.trim()) {
		return "auto_approve"
	}

	// Split into the commands bash will run, including the ones nested in
	// substitutions, groups and heredoc bodies. The analysis also detects
	// shell syntax errors (unterminated quotes, unclosed heredocs).
	const { commands: subCommands, parseError, uncertainty } = analyzeCommand(command)

	// Reject commands with a shell syntax error. An unterminated quote means
	// the shell would report a parse error; in a compound command it may
	// partially execute the well-formed prefix before aborting. Returning a
	// distinct decision lets callers surface a useful message to the agent
	// rather than silently presenting the command for user approval.
	if (parseError !== null) {
		return "malformed_command"
	}

	const decisions: CommandDecision[] = subCommands.map((cmd) =>
		getAnalyzedCommandDecision(cmd, allowedCommands, deniedCommands),
	)

	// If any sub-command is denied, deny the whole command
	if (decisions.includes("auto_deny")) {
		return "auto_deny"
	}

	// The split may differ from what bash runs, so nothing is proven allowed.
	if (uncertainty !== null) {
		return "ask_user"
	}

	// Require explicit user approval for dangerous patterns
	if (containsDangerousSubstitution(command)) {
		return "ask_user"
	}

	// If all sub-commands are approved, approve the whole command
	if (decisions.every((decision) => decision === "auto_approve")) {
		return "auto_approve"
	}

	// Otherwise, ask user
	return "ask_user"
}

/**
 * Decision for one analyzed sub-command. The deny list is matched against the
 * command as written and after quote removal (so `'r'm` or `FOO=1 rm` cannot
 * dodge a denied `rm`). The allow list is matched only when the command word
 * is a plain literal: a quoted, escaped or expanded command word could be any
 * program, so it is never auto-approved.
 */
function getAnalyzedCommandDecision(
	cmd: AnalyzedCommand,
	allowedCommands: string[],
	deniedCommands?: string[],
): CommandDecision {
	// Remove simple PowerShell-like redirections (e.g. 2>&1) before checking
	const text = cmd.text.replace(/\d*>&\d*/, "").trim()
	const matchText = cmd.matchText.replace(/\d*>&\d*/, "").trim()

	if (!text) return "auto_approve"

	const longestAllowedMatch = cmd.commandIsLiteral ? findLongestPrefixMatch(text, allowedCommands || []) : null
	const deniedMatches = [text, matchText]
		.map((form) => findLongestPrefixMatch(form, deniedCommands || []))
		.filter((match): match is string => match !== null)
	const longestDeniedMatch = deniedMatches.sort((a, b) => b.length - a.length)[0] ?? null

	if (longestDeniedMatch && (!longestAllowedMatch || longestDeniedMatch.length >= longestAllowedMatch.length)) {
		return "auto_deny"
	}
	return longestAllowedMatch ? "auto_approve" : "ask_user"
}

/**
 * Get the decision for a single command using longest prefix match rule.
 *
 * This is the core logic that implements the conflict resolution between
 * allowlist and denylist using the "longest prefix match" strategy.
 *
 * **Longest Prefix Match Algorithm:**
 * 1. Find the longest matching prefix in the allowlist
 * 2. Find the longest matching prefix in the denylist
 * 3. Compare lengths to determine which rule takes precedence
 * 4. Longer (more specific) match wins the conflict
 *
 * **Decision Matrix:**
 * | Allowlist Match | Denylist Match | Result | Reason |
 * |----------------|----------------|---------|---------|
 * | Yes | No | auto_approve | Only allowlist matches |
 * | No | Yes | auto_deny | Only denylist matches |
 * | Yes | Yes (shorter) | auto_approve | Allowlist is more specific |
 * | Yes | Yes (longer/equal) | auto_deny | Denylist is more specific |
 * | No | No | ask_user | No rules apply |
 *
 * **Examples:**
 * ```typescript
 * // Only allowlist matches
 * getSingleCommandDecision("git status", ["git"], ["npm"])
 * // Returns "auto_approve"
 *
 * // Denylist is more specific
 * getSingleCommandDecision("git push origin", ["git"], ["git push"])
 * // Returns "auto_deny" (denylist "git push" > allowlist "git")
 *
 * // Allowlist is more specific
 * getSingleCommandDecision("git push --dry-run", ["git push --dry-run"], ["git push"])
 * // Returns "auto_approve" (allowlist is longer)
 *
 * // No matches
 * getSingleCommandDecision("unknown", ["git"], ["npm"])
 * // Returns "ask_user"
 * ```
 *
 * @param command - Single command to validate (no chaining)
 * @param allowedCommands - List of allowed command prefixes
 * @param deniedCommands - Optional list of denied command prefixes
 * @returns Decision for this specific command
 */
export function getSingleCommandDecision(
	command: string,
	allowedCommands: string[],
	deniedCommands?: string[],
): CommandDecision {
	if (!command) return "auto_approve"

	// Find longest matching prefixes in both lists
	const longestAllowedMatch = findLongestPrefixMatch(command, allowedCommands || [])
	const longestDeniedMatch = findLongestPrefixMatch(command, deniedCommands || [])

	// If only allowlist has a match, auto-approve
	if (longestAllowedMatch && !longestDeniedMatch) {
		return "auto_approve"
	}

	// If only denylist has a match, auto-deny
	if (!longestAllowedMatch && longestDeniedMatch) {
		return "auto_deny"
	}

	// Both lists have matches - apply longest prefix match rule
	if (longestAllowedMatch && longestDeniedMatch) {
		return longestAllowedMatch.length > longestDeniedMatch.length ? "auto_approve" : "auto_deny"
	}

	// If neither list has a match, ask user
	return "ask_user"
}
