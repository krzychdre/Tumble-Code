# Claude Code's File-Based Memory System — Full Reference & Implementation Guide for Roo-Code

This document is a complete, code-level reference for Claude Code's memory system (from the leaked `memdir/` source) and an explicit, copy-pasteable implementation plan for porting it into **Roo-Code** (`~/Projekty/QUB-IT/Roo-Code`). It contains the actual source excerpts so an implementer can rebuild the system by reading this document alone.

---

## Table of Contents

1. [Overview & Design Philosophy](#1-overview--design-philosophy)
2. [Storage Layout & Path Resolution](#2-storage-layout--path-resolution)
3. [The Type Taxonomy & Frontmatter Format](#3-the-type-taxonomy--frontmatter-format)
4. [The Memory Prompt (Behavioral Instructions)](#4-the-memory-prompt-behavioral-instructions)
5. [Loading `MEMORY.md` Into the System Prompt](#5-loading-memorymd-into-the-system-prompt)
6. [Relevant-Memory Surfacing (Recall Engine)](#6-relevant-memory-surfacing-recall-engine)
7. [Background Write Path #1 — `extractMemories`](#7-background-write-path-1--extractmemories)
8. [Background Write Path #2 — `autoDream` Consolidation](#8-background-write-path-2--autodream-consolidation)
9. [Tool Integration (No Dedicated Memory Tool)](#9-tool-integration-no-dedicated-memory-tool)
10. [Team Memory (Optional, P3)](#10-team-memory-optional-p3)
11. [Roo-Code Integration Points (Audited)](#11-roo-code-integration-points-audited)
12. [Phased Porting Plan with Copy-Paste Code](#12-phased-porting-plan-with-copy-paste-code)

---

## Round-Trip 2 — Deep-Dive Addenda (gap-filling)

13. [Feature Flags & Build Gates — Complete Map](#13-feature-flags--build-gates--complete-map)
14. [Trigger Wiring & Lifecycle — Where Everything Fires](#14-trigger-wiring--lifecycle--where-everything-fires)
15. [Team Memory Internals — Deep Dive](#15-team-memory-internals--deep-dive)
16. [autoDream — Lock & Scheduling Internals](#16-autodream--lock--scheduling-internals)
17. [extractMemories — Run Loop & State Machine](#17-extractmemories--run-loop--state-machine)
18. [Supporting Primitives (`sideQuery`, frontmatter, bounded read, detection)](#18-supporting-primitives-sidequery-frontmatter-bounded-read-detection)
19. [Filesystem & Tool Integration Hooks](#19-filesystem--tool-integration-hooks)
20. [KAIROS Daily-Log Mode & the SessionMemory Distinction](#20-kairos-daily-log-mode--the-sessionmemory-distinction)
21. [Corrected/Refined Facts from Round 1](#21-correctedrefined-facts-from-round-1)

---

## Round-Trip 3 — Primitive-Level Deep Dive (gap-filling)

22. [`runForkedAgent` & `CacheSafeParams` — the shared fork primitive](#22-runforkedagent--cachesafeparams--the-shared-fork-primitive)
23. [Recall Pipeline — complete code](#23-recall-pipeline--complete-code)
24. [`MemorySavedMessage` + UI rendering](#24-memorysavedmessage--ui-rendering)
25. [`buildSearchingPastContextSection` — the grep recipes](#25-buildsearchingpastcontextsection--the-grep-recipes)
26. [Session counting & lock internals — full code](#26-session-counting--lock-internals--full-code)
27. [Bash/shell memory detection — `isShellCommandTargetingMemory()`](#27-bashshell-memory-detection--isshellcommandtargetingmemory)
28. [Agent-Memory System — full deep dive](#28-agent-memory-system--full-deep-dive)
29. [Corrected/Refined Facts from Round 2](#29-correctedrefined-facts-from-round-2)

---

## Round-Trip 4 — Final Black-Boxes (session counter internals, DreamTask UI, claudemd cache-invalidation)

30. [`listCandidates` — the session-counter primitive](#30-listcandidates--the-session-counter-primitive)
31. [`DreamTask` — UI progress state machine + kill → lock rollback](#31-dreamtask--ui-progress-state-machine--kill--lock-rollback)
32. [`claudemd.ts` cache-invalidation & `filterInjectedMemoryFiles`](#32-claudemdts-cache-invalidation--filterinjectedmemoryfiles)

---

## Round-Trip 5 — UI Surface & Roo-Code Integration Re-Verification

33. [The `/memory` Command — the user-facing control surface](#33-the-memory-command--the-user-facing-control-surface)
34. [Saved-memory rendering & the large-file warning](#34-saved-memory-rendering--the-large-file-warning)
35. [Roo-Code Integration Points — re-verified against live checkout](#35-roo-code-integration-points--re-verified-against-live-checkout)

---

## 1. Overview & Design Philosophy

Claude Code's memory is a **persistent, file-based, model-managed** system. Key facts:

- **There is NO dedicated `MemoryTool`.** The model reads/writes memory with the ordinary `Read`, `Write`, `Edit`, `Grep`, `Glob` file tools against a special directory.
- **`MEMORY.md` is an index**, not a store. Actual content lives in per-topic `.md` files with YAML frontmatter.
- **Closed 4-type taxonomy**: `user`, `feedback`, `project`, `reference`. Anything derivable from code/git (architecture, conventions, recent changes) is explicitly _excluded_.
- **Two background sub-agents** keep memory healthy: `extractMemories` (end of each turn) and `autoDream` (periodic consolidation).
- **A recall engine** runs a separate "side query" to a fast model (Sonnet) to rank which memory files are relevant to the current user prompt, injecting the top ~5 as hidden `<system-reminder>` attachments.

The harness provides three things on top of the model's own file operations:

1. **System-prompt instructions** telling the model _what/when/how_ to save and _what NOT_ to save.
2. **Always-on `MEMORY.md` index** loaded into the system prompt (capped 200 lines / 25 KB).
3. **Relevant-memory surfacing** as a non-blocking prefetch.

---

## 2. Storage Layout & Path Resolution

Source: [`memdir/paths.ts`](memdir/paths.ts:1). The full path-resolution code:

```typescript
// memdir/paths.ts (abridged to the essentials)
import memoize from "lodash-es/memoize.js"
import { homedir } from "os"
import { isAbsolute, join, normalize, sep } from "path"

const AUTO_MEM_DIRNAME = "memory"
const AUTO_MEM_ENTRYPOINT_NAME = "MEMORY.md"

// Enable gate: default ON. Priority: env var > SIMPLE/bare > remote-without-storage > settings > default ON
export function isAutoMemoryEnabled(): boolean {
	const envVal = process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY
	if (isEnvTruthy(envVal)) return false
	if (isEnvDefinedFalsy(envVal)) return true
	if (isEnvTruthy(process.env.CLAUDE_CODE_SIMPLE)) return false
	if (isEnvTruthy(process.env.CLAUDE_CODE_REMOTE) && !process.env.CLAUDE_CODE_REMOTE_MEMORY_DIR) return false
	const settings = getInitialSettings()
	if (settings.autoMemoryEnabled !== undefined) return settings.autoMemoryEnabled
	return true
}

// Base dir: env override, else ~/.claude (getClaudeConfigHomeDir)
export function getMemoryBaseDir(): string {
	if (process.env.CLAUDE_CODE_REMOTE_MEMORY_DIR) return process.env.CLAUDE_CODE_REMOTE_MEMORY_DIR
	return getClaudeConfigHomeDir()
}

// Canonical git root so all worktrees share one memory dir
function getAutoMemBase(): string {
	return findCanonicalGitRoot(getProjectRoot()) ?? getProjectRoot()
}

// Memoized. Returns dir WITH a trailing separator, NFC-normalized.
export const getAutoMemPath = memoize(
	(): string => {
		const override = getAutoMemPathOverride() ?? getAutoMemPathSetting()
		if (override) return override
		const projectsDir = join(getMemoryBaseDir(), "projects")
		return (join(projectsDir, sanitizePath(getAutoMemBase()), AUTO_MEM_DIRNAME) + sep).normalize("NFC")
	},
	() => getProjectRoot(),
)

export function getAutoMemEntrypoint(): string {
	return join(getAutoMemPath(), AUTO_MEM_ENTRYPOINT_NAME)
}

// Containment check (used by filesystem write carve-out + tool sandbox)
export function isAutoMemPath(absolutePath: string): boolean {
	const normalizedPath = normalize(absolutePath)
	return normalizedPath.startsWith(getAutoMemPath())
}
```

### Security validation (path traversal defense)

[`validateMemoryPath()`](memdir/paths.ts:109) rejects: relative paths, root/near-root (`length < 3`), Windows drive-root (`C:`), UNC paths (`\\`/`//`), null bytes, and trivial-tilde expansions that would resolve to `$HOME`. Returns the normalized path with exactly one trailing separator, NFC-normalized.

**Settings.json override** only trusts policy/local/user sources — **project settings excluded** (a malicious repo could otherwise set `autoMemoryDirectory: "~/.ssh"` and gain silent write access via the filesystem carve-out).

---

## 3. The Type Taxonomy & Frontmatter Format

Source: [`memdir/memoryTypes.ts`](memdir/memoryTypes.ts:1). This file is **the single source of truth** for all memory prompt content. Port it near-verbatim.

### 3.1 The four types

```typescript
export const MEMORY_TYPES = ["user", "feedback", "project", "reference"] as const
export type MemoryType = (typeof MEMORY_TYPES)[number]

export function parseMemoryType(raw: unknown): MemoryType | undefined {
	if (typeof raw !== "string") return undefined
	return MEMORY_TYPES.find((t) => t === raw)
}
```

### 3.2 Frontmatter example (the format every topic file uses)

````typescript
export const MEMORY_FRONTMATTER_EXAMPLE: readonly string[] = [
	"```markdown",
	"---",
	"name: {{memory name}}",
	"description: {{one-line description — used to decide relevance in future conversations, so be specific}}",
	`type: {{${MEMORY_TYPES.join(", ")}}}`,
	"---",
	"",
	"{{memory content — for feedback/project types, structure as: rule/fact, then **Why:** and **How to apply:** lines}}",
	"```",
]
````

So a real topic file looks like:

```markdown
---
name: Database testing policy
description: Integration tests must hit a real DB; mocking burned us in 2025-Q3 migration
type: feedback
---

Integration tests must hit a real database, not mocks.

**Why:** In 2025-Q3, mocked tests passed but the prod migration failed silently — mock/prod divergence masked the bug.
**How to apply:** When writing or reviewing tests that touch the data layer, reject mock-based DB setups. Flag PRs that introduce them.
```

### 3.3 The type-section blocks (`TYPES_SECTION_INDIVIDUAL`)

This is the largest block — a full `<types>…</types>` XML structure with `<name>`, `<description>`, `<when_to_save>`, `<how_to_use>`, `<body_structure>`, `<examples>` for each type. The complete content lives in [`memoryTypes.ts` lines 113-178](memdir/memoryTypes.ts:113). Key excerpts:

- **user**: "Contain information about the user's role, goals, responsibilities, and knowledge." Save "when you learn any details about the user's role, preferences, responsibilities, or knowledge."
- **feedback**: "Guidance the user has given you about how to approach work — both what to avoid and what to keep doing." Save "any time the user corrects your approach OR confirms a non-obvious approach worked." `<body_structure>`: "Lead with the rule itself, then a **Why:** line … and a **How to apply:** line."
- **project**: "Ongoing work, goals, initiatives, bugs, or incidents … not otherwise derivable from the code or git history." Save "when you learn who is doing what, why, or by when. Always convert relative dates … to absolute dates."
- **reference**: "Pointers to where information can be found in external systems." Save "when you learn about resources in external systems and their purpose."

Each type includes 2-3 worked `user:` / `assistant: [saves X memory: …]` examples. A `TYPES_SECTION_COMBINED` variant adds `<scope>` tags (private/team) for team-memory mode.

### 3.4 Shared sections (port verbatim)

```typescript
export const WHAT_NOT_TO_SAVE_SECTION: readonly string[] = [
	"## What NOT to save in memory",
	"",
	"- Code patterns, conventions, architecture, file paths, or project structure — these can be derived by reading the current project state.",
	"- Git history, recent changes, or who-changed-what — `git log` / `git blame` are authoritative.",
	"- Debugging solutions or fix recipes — the fix is in the code; the commit message has the context.",
	"- Anything already documented in CLAUDE.md files.",
	"- Ephemeral task details: in-progress work, temporary state, current conversation context.",
	"",
	"These exclusions apply even when the user explicitly asks you to save. If they ask you to save a PR list or activity summary, ask what was *surprising* or *non-obvious* about it — that is the part worth keeping.",
]

export const MEMORY_DRIFT_CAVEAT =
	"- Memory records can become stale over time. Use memory as context for what was true at a given point in time. Before answering the user or building assumptions based solely on information in memory records, verify that the memory is still correct and up-to-date by reading the current state of the files or resources. If a recalled memory conflicts with current information, trust what you observe now — and update or remove the stale memory rather than acting on it."

export const WHEN_TO_ACCESS_SECTION: readonly string[] = [
	"## When to access memories",
	"- When memories seem relevant, or the user references prior-conversation work.",
	"- You MUST access memory when the user explicitly asks you to check, recall, or remember.",
	"- If the user says to *ignore* or *not use* memory: proceed as if MEMORY.md were empty. Do not apply remembered facts, cite, compare against, or mention memory content.",
	MEMORY_DRIFT_CAVEAT,
]

export const TRUSTING_RECALL_SECTION: readonly string[] = [
	"## Before recommending from memory",
	"",
	"A memory that names a specific function, file, or flag is a claim that it existed *when the memory was written*. It may have been renamed, removed, or never merged. Before recommending it:",
	"",
	"- If the memory names a file path: check the file exists.",
	"- If the memory names a function or flag: grep for it.",
	"- If the user is about to act on your recommendation (not just asking about history), verify first.",
	"",
	'"The memory says X exists" is not the same as "X exists now."',
	"",
	"A memory that summarizes repo state (activity logs, architecture snapshots) is frozen in time. If the user asks about *recent* or *current* state, prefer `git log` or reading the code over recalling the snapshot.",
]
```

### 3.5 Staleness text helpers — [`memdir/memoryAge.ts`](memdir/memoryAge.ts:1) (verbatim)

```typescript
export function memoryAgeDays(mtimeMs: number): number {
	return Math.max(0, Math.floor((Date.now() - mtimeMs) / 86_400_000))
}

export function memoryAge(mtimeMs: number): string {
	const d = memoryAgeDays(mtimeMs)
	if (d === 0) return "today"
	if (d === 1) return "yesterday"
	return `${d} days ago`
}

export function memoryFreshnessText(mtimeMs: number): string {
	const d = memoryAgeDays(mtimeMs)
	if (d <= 1) return ""
	return (
		`This memory is ${d} days old. ` +
		`Memories are point-in-time observations, not live state — ` +
		`claims about code behavior or file:line citations may be outdated. ` +
		`Verify against current code before asserting as fact.`
	)
}

export function memoryFreshnessNote(mtimeMs: number): string {
	const text = memoryFreshnessText(mtimeMs)
	if (!text) return ""
	return `<system-reminder>${text}</system-reminder>\n`
}
```

---

## 4. The Memory Prompt (Behavioral Instructions)

Source: [`memdir/memdir.ts`](memdir/memdir.ts:1).

### 4.1 Entrypoint truncation

```typescript
export const ENTRYPOINT_NAME = 'MEMORY.md'
export const MAX_ENTRYPOINT_LINES = 200
export const MAX_ENTRYPOINT_BYTES = 25_000

export function truncateEntrypointContent(raw: string): EntrypointTruncation {
  const trimmed = raw.trim()
  const contentLines = trimmed.split('\n')
  const lineCount = contentLines.length
  const byteCount = trimmed.length

  const wasLineTruncated = lineCount > MAX_ENTRYPOINT_LINES
  const wasByteTruncated = byteCount > MAX_ENTRYPOINT_BYTES

  if (!wasLineTruncated && !wasByteTruncated) {
    return { content: trimmed, lineCount, byteCount, wasLineTruncated, wasByteTruncated }
  }

  let truncated = wasLineTruncated
    ? contentLines.slice(0, MAX_ENTRYPOINT_LINES).join('\n')
    : trimmed

  if (truncated.length > MAX_ENTRYPOINT_BYTES) {
    const cutAt = truncated.lastIndexOf('\n', MAX_ENTRYPOINT_BYTES)
    truncated = truncated.slice(0, cutAt > 0 ? cutAt : MAX_ENTRYPOINT_BYTES)
  }

  const reason = /* …formats which cap fired… */
  return {
    content: truncated + `\n\n> WARNING: ${ENTRYPOINT_NAME} is ${reason}. Only part of it was loaded. Keep index entries to one line under ~200 chars; move detail into topic files.`,
    lineCount, byteCount, wasLineTruncated, wasByteTruncated,
  }
}
```

### 4.2 `buildMemoryLines()` — the full behavioral prompt body

This is the core function that produces the instructions injected into the system prompt. It assembles: a header naming the directory, the type taxonomy, the "what NOT to save" section, the two-step "how to save" instructions (write topic file → add `MEMORY.md` pointer), the "when to access" section, the "trusting recall" section, and the "memory vs other persistence" section.

```typescript
export const DIR_EXISTS_GUIDANCE =
  'This directory already exists — write to it directly with the Write tool (do not run mkdir or check for its existence).'

export async function ensureMemoryDirExists(memoryDir: string): Promise<void> {
  // mkdir -p, swallow EEXIST, log real errors (EACCES/EPERM/EROFS)
  try { await fs.mkdir(memoryDir) } catch (e) { logForDebugging(…) }
}

export function buildMemoryLines(
  displayName: string,
  memoryDir: string,
  extraGuidelines?: string[],
  skipIndex = false,
): string[] {
  const howToSave = [
    '## How to save memories',
    '',
    'Saving a memory is a two-step process:',
    '',
    '**Step 1** — write the memory to its own file (e.g., `user_role.md`, `feedback_testing.md`) using this frontmatter format:',
    '',
    ...MEMORY_FRONTMATTER_EXAMPLE,
    '',
    `**Step 2** — add a pointer to that file in \`${ENTRYPOINT_NAME}\`. \`${ENTRYPOINT_NAME}\` is an index, not a memory — each entry should be one line, under ~150 characters: \`- [Title](file.md) — one-line hook\`. It has no frontmatter. Never write memory content directly into \`${ENTRYPOINT_NAME}\`.`,
    '',
    `- \`${ENTRYPOINT_NAME}\` is always loaded into your conversation context — lines after ${MAX_ENTRYPOINT_LINES} will be truncated, so keep the index concise`,
    '- Keep the name, description, and type fields in memory files up-to-date with the content',
    '- Organize memory semantically by topic, not chronologically',
    '- Update or remove memories that turn out to be wrong or outdated',
    '- Do not write duplicate memories. First check if there is an existing memory you can update before writing a new one.',
  ]

  const lines: string[] = [
    `# ${displayName}`,
    '',
    `You have a persistent, file-based memory system at \`${memoryDir}\`. ${DIR_EXISTS_GUIDANCE}`,
    '',
    "You should build up this memory system over time so that future conversations can have a complete picture of who the user is, how they'd like to collaborate with you, what behaviors to avoid or repeat, and the context behind the work the user gives you.",
    '',
    'If the user explicitly asks you to remember something, save it immediately as whichever type fits best. If they ask you to forget something, find and remove the relevant entry.',
    '',
    ...TYPES_SECTION_INDIVIDUAL,
    ...WHAT_NOT_TO_SAVE_SECTION,
    '',
    ...howToSave,
    '',
    ...WHEN_TO_ACCESS_SECTION,
    '',
    ...TRUSTING_RECALL_SECTION,
    '',
    '## Memory and other forms of persistence',
    'Memory is one of several persistence mechanisms … should not be used for persisting information that is only useful within the scope of the current conversation.',
    '- When to use or update a plan instead of memory: … use a Plan rather than saving this information to memory.',
    '- When to use or update tasks instead of memory: … use tasks instead of saving to memory.',
    '',
    ...(extraGuidelines ?? []),
    '',
  ]

  lines.push(...buildSearchingPastContextSection(memoryDir))
  return lines
}
```

### 4.3 `loadMemoryPrompt()` — the dispatcher

```typescript
export async function loadMemoryPrompt(): Promise<string | null> {
	const autoEnabled = isAutoMemoryEnabled()
	// KAIROS daily-log mode (assistant sessions) — defer for Roo port
	// TEAMMEM combined mode — defer for Roo port (P3)
	if (autoEnabled) {
		const autoDir = getAutoMemPath()
		await ensureMemoryDirExists(autoDir) // harness guarantees dir exists
		return buildMemoryLines("auto memory", autoDir, extraGuidelines, skipIndex).join("\n")
	}
	return null
}
```

This is registered into the system prompt as a cached section in [`constants/prompts.ts`](constants/prompts.ts:495):

```typescript
systemPromptSection('memory', () => loadMemoryPrompt()),
```

---

## 5. Loading `MEMORY.md` Into the System Prompt

Source: [`utils/claudemd.ts`](utils/claudemd.ts:790). `getMemoryFiles()` (memoized) walks CLAUDE.md files up the tree and **appends the auto-memory entrypoint as an `AutoMem`-typed entry**:

```typescript
// utils/claudemd.ts (the memory-specific tail of getMemoryFiles)
if (isAutoMemoryEnabled()) {
	const { info: memdirEntry } = await safelyReadMemoryFileAsync(getAutoMemEntrypoint(), "AutoMem")
	if (memdirEntry) {
		const normalizedPath = normalizePathForComparison(memdirEntry.path)
		if (!processedPaths.has(normalizedPath)) {
			processedPaths.add(normalizedPath)
			result.push(memdirEntry) // content already truncated to MAX_ENTRYPOINT_LINES/BYTES
		}
	}
}
// Team memory entrypoint added here too (TEAMMEM only)
```

[`getClaudeMds()`](utils/claudemd.ts:1153) then joins all entries into one block prefixed by:

```typescript
const MEMORY_INSTRUCTION_PROMPT =
	"Codebase and user instructions are shown below. Be sure to adhere to these instructions. IMPORTANT: These instructions OVERRIDE any default behavior and you MUST follow them exactly as written."
```

AutoMem content gets the description `"(user's auto-memory, persists across conversations)"`.

---

## 6. Relevant-Memory Surfacing (Recall Engine)

This is the most novel piece. Four stages: **scan → rank → read → surface**, run as a non-blocking prefetch.

### 6.1 Scan — [`memdir/memoryScan.ts`](memdir/memoryScan.ts:1) (verbatim)

```typescript
import { readdir } from "fs/promises"
import { basename, join } from "path"
import { parseFrontmatter } from "../utils/frontmatterParser.js"
import { readFileInRange } from "../utils/readFileInRange.js"
import { type MemoryType, parseMemoryType } from "./memoryTypes.js"

export type MemoryHeader = {
	filename: string
	filePath: string
	mtimeMs: number
	description: string | null
	type: MemoryType | undefined
}

const MAX_MEMORY_FILES = 200
const FRONTMATTER_MAX_LINES = 30

export async function scanMemoryFiles(memoryDir: string, signal: AbortSignal): Promise<MemoryHeader[]> {
	try {
		const entries = await readdir(memoryDir, { recursive: true })
		const mdFiles = entries.filter((f) => f.endsWith(".md") && basename(f) !== "MEMORY.md")

		const headerResults = await Promise.allSettled(
			mdFiles.map(async (relativePath): Promise<MemoryHeader> => {
				const filePath = join(memoryDir, relativePath)
				const { content, mtimeMs } = await readFileInRange(
					filePath,
					0,
					FRONTMATTER_MAX_LINES,
					undefined,
					signal,
				)
				const { frontmatter } = parseFrontmatter(content, filePath)
				return {
					filename: relativePath,
					filePath,
					mtimeMs,
					description: frontmatter.description || null,
					type: parseMemoryType(frontmatter.type),
				}
			}),
		)

		return headerResults
			.filter((r): r is PromiseFulfilledResult<MemoryHeader> => r.status === "fulfilled")
			.map((r) => r.value)
			.sort((a, b) => b.mtimeMs - a.mtimeMs)
			.slice(0, MAX_MEMORY_FILES)
	} catch {
		return []
	}
}

export function formatMemoryManifest(memories: MemoryHeader[]): string {
	return memories
		.map((m) => {
			const tag = m.type ? `[${m.type}] ` : ""
			const ts = new Date(m.mtimeMs).toISOString()
			return m.description ? `- ${tag}${m.filename} (${ts}): ${m.description}` : `- ${tag}${m.filename} (${ts})`
		})
		.join("\n")
}
```

> **Note on `readdir({ recursive: true })`**: Node 18.17+ supports this. If Roo-Code targets older Node, replace with a manual recursive walk.

> **`readFileInRange`** reads a bounded line range efficiently and returns `{ content, mtimeMs, totalLines, truncatedByBytes }`. For the port, a simpler `fs.readFile` + slice + `fs.stat` for mtime is acceptable (the single-pass stat optimization is a perf nicety).

> **`parseFrontmatter`** ([`utils/frontmatterParser.ts`](utils/frontmatterParser.ts:130)): regex `^---\s*\n([\s\S]*?)---\s*\n?` extracts the YAML block, parsed with a YAML lib (with a fallback that quotes problematic values). For the port, use the `gray-matter` npm package or a minimal YAML parser.

### 6.2 Rank — [`memdir/findRelevantMemories.ts`](memdir/findRelevantMemories.ts:1) (verbatim)

```typescript
const SELECT_MEMORIES_SYSTEM_PROMPT = `You are selecting memories that will be useful to Claude Code as it processes a user's query. You will be given the user's query and a list of available memory files with their filenames and descriptions.

Return a list of filenames for the memories that will clearly be useful to Claude Code as it processes the user's query (up to 5). Only include memories that you are certain will be helpful based on their name and description.
- If you are unsure if a memory will be useful in processing the user's query, then do not include it in your list. Be selective and discerning.
- If there are no memories in the list that would clearly be useful, feel free to return an empty list.
- If a list of recently-used tools is provided, do not select memories that are usage reference or API documentation for those tools (Claude Code is already exercising them). DO still select memories containing warnings, gotchas, or known issues about those tools — active use is exactly when those matter.
`

export async function findRelevantMemories(
	query: string,
	memoryDir: string,
	signal: AbortSignal,
	recentTools: readonly string[] = [],
	alreadySurfaced: ReadonlySet<string> = new Set(),
): Promise<RelevantMemory[]> {
	const memories = (await scanMemoryFiles(memoryDir, signal)).filter((m) => !alreadySurfaced.has(m.filePath))
	if (memories.length === 0) return []

	const selectedFilenames = await selectRelevantMemories(query, memories, signal, recentTools)
	const byFilename = new Map(memories.map((m) => [m.filename, m]))
	const selected = selectedFilenames
		.map((filename) => byFilename.get(filename))
		.filter((m): m is MemoryHeader => m !== undefined)

	return selected.map((m) => ({ path: m.filePath, mtimeMs: m.mtimeMs }))
}

async function selectRelevantMemories(
	query: string,
	memories: MemoryHeader[],
	signal: AbortSignal,
	recentTools: readonly string[],
): Promise<string[]> {
	const validFilenames = new Set(memories.map((m) => m.filename))
	const manifest = formatMemoryManifest(memories)
	const toolsSection = recentTools.length > 0 ? `\n\nRecently used tools: ${recentTools.join(", ")}` : ""

	try {
		const result = await sideQuery({
			// ← a lightweight separate API call to a fast model
			model: getDefaultSonnetModel(),
			system: SELECT_MEMORIES_SYSTEM_PROMPT,
			skipSystemPromptPrefix: true,
			messages: [
				{
					role: "user",
					content: `Query: ${query}\n\nAvailable memories:\n${manifest}${toolsSection}`,
				},
			],
			max_tokens: 256,
			output_format: {
				type: "json_schema",
				schema: {
					type: "object",
					properties: { selected_memories: { type: "array", items: { type: "string" } } },
					required: ["selected_memories"],
					additionalProperties: false,
				},
			},
			signal,
			querySource: "memdir_relevance",
		})

		const textBlock = result.content.find((block) => block.type === "text")
		if (!textBlock || textBlock.type !== "text") return []
		const parsed: { selected_memories: string[] } = jsonParse(textBlock.text)
		return parsed.selected_memories.filter((f) => validFilenames.has(f))
	} catch (e) {
		if (signal.aborted) return []
		logForDebugging(`[memdir] selectRelevantMemories failed: ${errorMessage(e)}`, { level: "warn" })
		return []
	}
}
```

**For the Roo port**: replace `sideQuery` with a direct Anthropic SDK call (Haiku or a fast model) using JSON mode / tool-use-forced schema. Roo already has an API layer at [`src/api/`](../Roo-Code/src/api/). The JSON-schema-constrained output is critical — it guarantees parseable `{ "selected_memories": [...] }`.

### 6.3 Read + surface — [`utils/attachments.ts`](utils/attachments.ts:2279)

```typescript
export async function readMemoriesForSurfacing(
	selected: ReadonlyArray<{ path: string; mtimeMs: number }>,
	signal?: AbortSignal,
): Promise<Array<{ path: string; content: string; mtimeMs: number; header: string; limit?: number }>> {
	const results = await Promise.all(
		selected.map(async ({ path: filePath, mtimeMs }) => {
			try {
				const result = await readFileInRange(filePath, 0, MAX_MEMORY_LINES, MAX_MEMORY_BYTES, signal, {
					truncateOnByteLimit: true,
				})
				const truncated = result.totalLines > MAX_MEMORY_LINES || result.truncatedByBytes
				const content = truncated
					? result.content +
						`\n\n> This memory file was truncated (…). Use the read_file tool to view the complete file at: ${filePath}`
					: result.content
				return {
					path: filePath,
					content,
					mtimeMs,
					header: memoryHeader(filePath, mtimeMs),
					limit: truncated ? result.lineCount : undefined,
				}
			} catch {
				return null
			}
		}),
	)
	return results.filter((r) => r !== null) as NonNullable<(typeof results)[0]>[]
}

export function memoryHeader(path: string, mtimeMs: number): string {
	const staleness = memoryFreshnessText(mtimeMs)
	return staleness ? `${staleness}\n\nMemory: ${path}:` : `Memory (saved ${memoryAge(mtimeMs)}): ${path}:`
}
```

### 6.4 Dedup + throttle — [`utils/attachments.ts`](utils/attachments.ts:2251)

```typescript
export function collectSurfacedMemories(messages: ReadonlyArray<Message>): { paths: Set<string>; totalBytes: number } {
	const paths = new Set<string>()
	let totalBytes = 0
	for (const m of messages) {
		if (m.type === "attachment" && m.attachment.type === "relevant_memories") {
			for (const mem of m.attachment.memories) {
				paths.add(mem.path)
				totalBytes += mem.content.length
			}
		}
	}
	return { paths, totalBytes }
}
```

### 6.5 Prefetch lifecycle — [`utils/attachments.ts`](utils/attachments.ts:2361) + [`query.ts`](query.ts:301)

```typescript
export type MemoryPrefetch = {
	promise: Promise<Attachment[]>
	settledAt: number | null
	consumedOnIteration: number
	[Symbol.dispose](): void
}

export function startRelevantMemoryPrefetch(
	messages: ReadonlyArray<Message>,
	toolUseContext: ToolUseContext,
): MemoryPrefetch | undefined {
	if (!isAutoMemoryEnabled() || !getFeatureValue_CACHED_MAY_BE_STALE("tengu_moth_copse", false)) return undefined

	const lastUserMessage = messages.findLast((m) => m.type === "user" && !m.isMeta)
	if (!lastUserMessage) return undefined
	const input = getUserMessageText(lastUserMessage)
	if (!input || !/\s/.test(input.trim())) return undefined // skip single-word prompts

	const surfaced = collectSurfacedMemories(messages)
	if (surfaced.totalBytes >= RELEVANT_MEMORIES_CONFIG.MAX_SESSION_BYTES) return undefined

	const controller = createChildAbortController(toolUseContext.abortController)
	const firedAt = Date.now()
	const promise = getRelevantMemoryAttachments(
		input,
		toolUseContext.options.agentDefinitions.activeAgents,
		toolUseContext.readFileState,
		collectRecentSuccessfulTools(messages, lastUserMessage),
		controller.signal,
		surfaced.paths,
	).catch((e) => {
		if (!isAbortError(e)) logError(e)
		return []
	})

	const handle: MemoryPrefetch = {
		promise,
		settledAt: null,
		consumedOnIteration: -1,
		[Symbol.dispose]() {
			controller.abort()
			/* telemetry */
		},
	}
	void promise.finally(() => {
		handle.settledAt = Date.now()
	})
	return handle
}
```

**Consume point** in [`query.ts`](query.ts:1599) (zero-wait poll each loop iteration):

```typescript
if (
	pendingMemoryPrefetch &&
	pendingMemoryPrefetch.settledAt !== null &&
	pendingMemoryPrefetch.consumedOnIteration === -1
) {
	const memoryAttachments = filterDuplicateMemoryAttachments(
		await pendingMemoryPrefetch.promise,
		toolUseContext.readFileState,
	)
	if (memoryAttachments.length > 0) {
		/* inject as attachments */
	}
	pendingMemoryPrefetch.consumedOnIteration = turnCount - 1
}
```

### 6.6 Rendering — [`utils/messages.ts`](utils/messages.ts:3708)

```typescript
case 'relevant_memories': {
  return wrapMessagesInSystemReminder(
    attachment.memories.map(m => {
      const header = m.header ?? memoryHeader(m.path, m.mtimeMs)
      return createUserMessage({ content: `${header}\n\n${m.content}`, isMeta: true })
    }),
  )
}
```

Each memory becomes a hidden `<system-reminder>` user message: `${staleness note}\n\nMemory: <path>:\n\n<content>`.

### 6.7 `collectRecentSuccessfulTools()` — [`utils/attachments.ts`](utils/attachments.ts:2465)

Scans backward from the last user message; collects tool names whose `tool_use` succeeded (no error) since the previous human turn. Passed to the selector to suppress usage-docs for tools already working (but keeps gotchas/warnings about them).

---

## 7. Background Write Path #1 — `extractMemories`

Source: [`services/extractMemories/extractMemories.ts`](services/extractMemories/extractMemories.ts:1). Runs **once at the end of each complete query loop** via `handleStopHooks`.

### 7.1 Tool sandbox — [`createAutoMemCanUseTool()`](services/extractMemories/extractMemories.ts:171) (the critical gate)

```typescript
export function createAutoMemCanUseTool(memoryDir: string): CanUseToolFn {
	return async (tool: Tool, input: Record<string, unknown>) => {
		if (tool.name === REPL_TOOL_NAME) return { behavior: "allow", updatedInput: input }
		// Read/Grep/Glob unrestricted
		if (tool.name === FILE_READ_TOOL_NAME || tool.name === GREP_TOOL_NAME || tool.name === GLOB_TOOL_NAME) {
			return { behavior: "allow", updatedInput: input }
		}
		// Bash: only read-only commands (ls/find/cat/stat/wc/head/tail)
		if (tool.name === BASH_TOOL_NAME) {
			const parsed = tool.inputSchema.safeParse(input)
			if (parsed.success && tool.isReadOnly(parsed.data)) return { behavior: "allow", updatedInput: input }
			return denyAutoMemTool(tool, "Only read-only shell commands are permitted …")
		}
		// Edit/Write: only inside the memory dir
		if ((tool.name === FILE_EDIT_TOOL_NAME || tool.name === FILE_WRITE_TOOL_NAME) && "file_path" in input) {
			const filePath = input.file_path
			if (typeof filePath === "string" && isAutoMemPath(filePath))
				return { behavior: "allow", updatedInput: input }
		}
		return denyAutoMemTool(
			tool,
			`only Read/Grep/Glob, read-only Bash, and Edit/Write within ${memoryDir} are allowed`,
		)
	}
}
```

### 7.2 Mutual exclusion — [`hasMemoryWritesSince()`](services/extractMemories/extractMemories.ts:121)

If the main agent already wrote to a memory path this turn, the fork is skipped and the cursor advances. Main agent and background agent are mutually exclusive per turn.

### 7.3 The run loop (closure-scoped state)

- `lastMemoryMessageUuid` cursor → each run only considers messages since the previous extraction.
- `inProgress` overlap guard; `pendingContext` stashed for one trailing run.
- `turnsSinceLastExtraction` throttle (GB-tunable, default every turn).
- `maxTurns: 5` — expects read-all (turn 1) → write-all (turn 2) parallelism.
- Pre-injects the existing memory manifest so the agent doesn't `ls`.

### 7.4 The extraction prompt — [`services/extractMemories/prompts.ts`](services/extractMemories/prompts.ts:50)

`buildExtractAutoOnlyPrompt(newMessageCount, existingMemories, skipIndex)` produces:

- An opener: "You are now acting as the memory extraction subagent. Analyze the most recent ~N messages above … Available tools: Read, Grep, Glob, read-only Bash, and Edit/Write for paths inside the memory directory only … turn budget … read-all turn 1 → write-all turn 2 …"
- The existing-memory manifest ("Check this list before writing — update an existing file rather than creating a duplicate").
- "If the user explicitly asks you to remember something, save it immediately."
- `TYPES_SECTION_INDIVIDUAL` + `WHAT_NOT_TO_SAVE_SECTION` + the how-to-save steps.

### 7.5 Completion

On success, advances the cursor, extracts written paths, logs usage, and (if memories were saved) appends a `MemorySavedMessage` system message to the transcript. [`drainPendingExtraction()`](services/extractMemories/extractMemories.ts:611) awaits in-flight extractions with a 60s soft timeout before shutdown.

---

## 8. Background Write Path #2 — `autoDream` Consolidation

Source: [`services/autoDream/autoDream.ts`](services/autoDream/autoDream.ts:1). Periodic (≥24h + ≥5 sessions) consolidation: prunes, merges, re-indexes `MEMORY.md`, deletes contradicted facts.

### 8.1 Gates (cheapest first)

1. **Time**: hours since `lastConsolidatedAt` ≥ `minHours` (default 24h).
2. **Sessions**: transcript count with mtime > last ≥ `minSessions` (default 5).
3. **Lock**: `tryAcquireConsolidationLock()` (file-mtime-based, cross-process).
   Scan throttled to every 10 min when time-gate passes but session-gate doesn't.

### 8.2 The consolidation prompt — [`services/autoDream/consolidationPrompt.ts`](services/autoDream/consolidationPrompt.ts:10) (self-contained, port verbatim)

```typescript
export function buildConsolidationPrompt(memoryRoot: string, transcriptDir: string, extra: string): string {
	return `# Dream: Memory Consolidation

You are performing a dream — a reflective pass over your memory files. Synthesize what you've learned recently into durable, well-organized memories so that future sessions can orient quickly.

Memory directory: \`${memoryRoot}\`
${DIR_EXISTS_GUIDANCE}

Session transcripts: \`${transcriptDir}\` (large JSONL files — grep narrowly, don't read whole files)

---

## Phase 1 — Orient
- \`ls\` the memory directory to see what already exists
- Read \`${ENTRYPOINT_NAME}\` to understand the current index
- Skim existing topic files so you improve them rather than creating duplicates
- If \`logs/\` or \`sessions/\` subdirectories exist, review recent entries there

## Phase 2 — Gather recent signal
Sources in rough priority order:
1. **Daily logs** (\`logs/YYYY/MM/YYYY-MM-DD.md\`) if present
2. **Existing memories that drifted** — facts that contradict something you see in the codebase now
3. **Transcript search** — \`grep -rn "<narrow term>" ${transcriptDir}/ --include="*.jsonl" | tail -50\`
Don't exhaustively read transcripts.

## Phase 3 — Consolidate
For each thing worth remembering, write or update a memory file at the top level of the memory directory. Use the memory file format and type conventions from your system prompt's auto-memory section.
Focus on:
- Merging new signal into existing topic files rather than creating near-duplicates
- Converting relative dates ("yesterday", "last week") to absolute dates
- Deleting contradicted facts — if today's investigation disproves an old memory, fix it at the source

## Phase 4 — Prune and index
Update \`${ENTRYPOINT_NAME}\` so it stays under ${MAX_ENTRYPOINT_LINES} lines AND under ~25KB. It's an **index**, not a dump — each entry one line under ~150 characters: \`- [Title](file.md) — one-line hook\`. Never write memory content directly into it.
- Remove pointers to memories that are now stale, wrong, or superseded
- Demote verbose entries: if an index line is over ~200 chars, shorten the line, move the detail
- Add pointers to newly important memories
- Resolve contradictions — if two files disagree, fix the wrong one

---

Return a brief summary of what you consolidated, updated, or pruned. If nothing changed, say so.${extra ? `\n\n## Additional context\n\n${extra}` : ""}`
}
```

Runs as a forked sub-agent with the same `createAutoMemCanUseTool` sandbox; registers a `DreamTask` for UI progress; emits an "Improved N memories" system message on completion; rolls back the lock mtime on failure so the time-gate re-passes.

---

## 9. Tool Integration (No Dedicated Memory Tool)

Across [`tools/`](tools/) there is **no `MemoryTool`**. Confirmed by grep: only `isAutoMemFile()` detection hooks exist.

- [`isAutoMemFile()`](utils/memoryFileDetection.ts:87) is used in `FileReadTool` to track mtimes for freshness UI.
- The filesystem layer has a **write carve-out**: when `isAutoMemPath()` returns true, the dangerous-directory restriction is bypassed (gated on `!hasAutoMemPathOverride()`).
- Sub-agents with a `memory` field get Read/Write/Edit injected ([`loadAgentsDir.ts`](tools/AgentTool/loadAgentsDir.ts:456)) with a per-agent memory dir.

**For the Roo port**: Roo already has `read_file`, `write_to_file`, `edit_file`/`search_replace`, `search_files`, `list_files`. The prompt's "How to save" section just names these tools. Add a write carve-out in the tool approval path for `isAutoMemPath()`.

---

## 10. Team Memory (Optional, P3)

Source: [`memdir/teamMemPaths.ts`](memdir/teamMemPaths.ts:84) + [`services/teamMemorySync/`](services/teamMemorySync/index.ts:1). Subdirectory `<memDir>/team/` of auto-memory, scoped per-repo, enabled by GB flag `tengu_herring_clock`. Has its own `MEMORY.md`. Combined prompt adds a `## Memory scope` section and per-type `<scope>` (private/team) guidance. Sensitivity rule: never save secrets in team memories. HTTP sync to Anthropic backend keyed by git remote hash (pull = server wins per-key; push = delta upload by content hash; deletions don't propagate). **Defer for the Roo port** — needs a backend.

---

## 11. Roo-Code Integration Points (Audited)

### 11.1 System prompt assembly — [`src/core/prompts/system.ts`](../Roo-Code/src/core/prompts/system.ts:115)

Roo builds its prompt in `generatePrompt()` by concatenating sections:

```typescript
const basePrompt = `${roleDefinition}

${markdownFormattingSection()}

${getSharedToolUseSection()}${toolsCatalog}

	${getToolUseGuidelinesSection()}

${getCapabilitiesSection(cwd, hasMcpGroup ? mcpHub : undefined, allowedMcpServers)}
${deferredToolsSection ? `\n${deferredToolsSection}\n` : ""}
${modesSection}
${skillsSection ? `\n${skillsSection}` : ""}
${getRulesSection(cwd, settings)}

${getSystemInfoSection(cwd)}

${getObjectiveSection()}

${await addCustomInstructions(baseInstructions, globalCustomInstructions || "", cwd, mode, { language, rooIgnoreInstructions, settings })}`
```

**Injection point**: add a `getMemorySection(cwd, settings)` between `getRulesSection` and `getSystemInfoSection` (mirrors Claude Code's `systemPromptSection('memory', …)`). The `MEMORY.md` _content_ goes alongside custom instructions in `addCustomInstructions` or a sibling `getMemoryIndexSection()`.

### 11.2 Sections registry — [`src/core/prompts/sections/index.ts`](../Roo-Code/src/core/prompts/sections/index.ts:1)

```typescript
export { getRulesSection } from "./rules"
export { getSystemInfoSection } from "./system-info"
// … add: export { getMemorySection } from "./memory"
```

### 11.3 Custom-instructions loader — [`src/core/prompts/sections/custom-instructions.ts`](../Roo-Code/src/core/prompts/sections/custom-instructions.ts:1)

Uses `getRooDirectoriesForCwd`, `getGlobalRooDirectory` from [`src/services/roo-config`](../Roo-Code/src/services/roo-config). Reads `.roo/rules/*.md` and `.clinerules` files. **This is the place to add the `MEMORY.md` read** — it already does async `fs.readFile` with `safeReadFile()`.

### 11.4 Tool names (audited from [`src/core/tools/`](../Roo-Code/src/core/tools/))

| Claude Code | Roo-Code equivalent            |
| ----------- | ------------------------------ |
| `Read`      | `read_file`                    |
| `Write`     | `write_to_file`                |
| `Edit`      | `edit_file` / `search_replace` |
| `Grep`      | `search_files`                 |
| `Glob`      | `list_files`                   |
| `Bash`      | `execute_command`              |

### 11.5 Tool validation — [`src/core/tools/validateToolUse.ts`](../Roo-Code/src/core/tools/validateToolUse.ts:1)

`validateToolUse(toolName, mode, customModes, toolRequirements, toolParams, experiments, includedTools)` throws `FileRestrictionError` on disallowed writes. **Add the memory-path carve-out here** (or in the individual `WriteToFileTool`/`EditFileTool` path check): if `isAutoMemPath(file_path)` → allow regardless of workspace containment.

### 11.6 Config — [`src/core/config/ContextProxy.ts`](../Roo-Code/src/core/config/ContextProxy.ts:1)

Add `autoMemoryEnabled` (default `true`) and `autoMemoryDirectory` (trusted sources only) settings.

### 11.7 Task loop — [`src/core/task/`](../Roo-Code/src/core/task/)

The `Task` class is Roo's equivalent of `query.ts`. The relevant-memory prefetch would start on user-message submit and be consumed (zero-wait) before the next assistant iteration. Hook into `TaskLifecycle.ts` completion for `extractMemories`.

---

## 12. Phased Porting Plan with Copy-Paste Code

### Phase 0 (MVP — single PR, durable memory, no recall, no background agents)

**Goal**: Model reads `MEMORY.md` each task, writes topic files with frontmatter, manages its own index.

#### Step 0.1 — Create `src/core/memory/paths.ts`

Adapt [`memdir/paths.ts`](memdir/paths.ts:1). Replace `getClaudeConfigHomeDir()` with VS Code's `context.globalStorageUri` (pass the extension context into a factory or store globally). Replace `findCanonicalGitRoot` with Roo's git util. Key functions to port: `isAutoMemoryEnabled`, `getMemoryBaseDir`, `getAutoMemPath` (memoized), `getAutoMemEntrypoint`, `isAutoMemPath`, `validateMemoryPath`.

```typescript
// src/core/memory/paths.ts (skeleton)
import * as path from "path"
import * as vscode from "vscode"

let _context: vscode.ExtensionContext | undefined
export function initMemoryPaths(context: vscode.ExtensionContext) {
	_context = context
}

export function isAutoMemoryEnabled(): boolean {
	// env override > settings > default true
	const cfg = vscode.workspace.getConfiguration("roo")
	return cfg.get<boolean>("autoMemoryEnabled", true)
}

export function getMemoryBaseDir(): string {
	if (!_context) throw new Error("Memory paths not initialized")
	return path.join(_context.globalStorageUri.fsPath, "memory")
}

// Per-workspace key: use the workspace folder URI, sanitized
export function getAutoMemPath(cwd: string): string {
	const sanitized = cwd.replace(/[^a-zA-Z0-9]/g, "_")
	return path.join(getMemoryBaseDir(), "projects", sanitized, "memory") + path.sep
}

export function getAutoMemEntrypoint(cwd: string): string {
	return path.join(getAutoMemPath(cwd), "MEMORY.md")
}

export function isAutoMemPath(absolutePath: string, cwd: string): boolean {
	return path.normalize(absolutePath).startsWith(getAutoMemPath(cwd))
}
```

#### Step 0.2 — Create `src/core/memory/memoryTypes.ts`

**Copy [`memdir/memoryTypes.ts`](memdir/memoryTypes.ts:1) near-verbatim** (all 272 lines: `MEMORY_TYPES`, `parseMemoryType`, `TYPES_SECTION_INDIVIDUAL`, `WHAT_NOT_TO_SAVE_SECTION`, `MEMORY_DRIFT_CAVEAT`, `WHEN_TO_ACCESS_SECTION`, `TRUSTING_RECALL_SECTION`, `MEMORY_FRONTMATTER_EXAMPLE`). Drop `TYPES_SECTION_COMBINED` (team memory, P3). This file has no external deps — pure data.

#### Step 0.3 — Create `src/core/memory/memoryAge.ts`

**Copy [`memdir/memoryAge.ts`](memdir/memoryAge.ts:1) verbatim** (pure functions, no deps).

#### Step 0.4 — Create `src/core/memory/memoryPrompt.ts`

Adapt [`buildMemoryLines()`](memdir/memdir.ts:199) + [`truncateEntrypointContent()`](memdir/memdir.ts:57) + [`ensureMemoryDirExists()`](memdir/memdir.ts:129). Replace tool names (`Write`→`write_to_file`, etc.) in the "Searching past context" section. Replace `fs.mkdir` with `vscode.workspace.fs.createDirectory` or `fs/promises.mkdir({ recursive: true })`.

```typescript
// src/core/memory/memoryPrompt.ts (key pieces)
export const ENTRYPOINT_NAME = "MEMORY.md"
export const MAX_ENTRYPOINT_LINES = 200
export const MAX_ENTRYPOINT_BYTES = 25_000

export const DIR_EXISTS_GUIDANCE =
	"This directory already exists — write to it directly with the write_to_file tool (do not run mkdir or check for its existence)."

export async function ensureMemoryDirExists(memoryDir: string): Promise<void> {
	try {
		await fs.mkdir(memoryDir, { recursive: true })
	} catch (e) {
		/* log, continue */
	}
}

export function truncateEntrypointContent(raw: string) {
	/* copy from memdir.ts:57 verbatim */
}

export function buildMemoryLines(
	displayName: string,
	memoryDir: string,
	extraGuidelines?: string[],
	skipIndex = false,
): string[] {
	// Copy buildMemoryLines from memdir.ts:199, replacing:
	//   "the Write tool" → "the write_to_file tool"
	//   buildSearchingPastContextSection's GREP_TOOL_NAME → "search_files"
}

export async function loadMemoryPrompt(cwd: string): Promise<string | null> {
	if (!isAutoMemoryEnabled(cwd)) return null
	const autoDir = getAutoMemPath(cwd)
	await ensureMemoryDirExists(autoDir)
	return buildMemoryLines("auto memory", autoDir).join("\n")
}

// The MEMORY.md content loader (replaces claudemd.ts's AutoMem entry)
export async function loadMemoryIndex(cwd: string): Promise<string> {
	if (!isAutoMemoryEnabled(cwd)) return ""
	let content = ""
	try {
		content = await fs.readFile(getAutoMemEntrypoint(cwd), "utf-8")
	} catch {
		/* not yet created */
	}
	if (!content.trim()) return ""
	const t = truncateEntrypointContent(content)
	return `\nContents of ${getAutoMemEntrypoint(cwd)} (user's auto-memory, persists across conversations):\n\n${t.content}`
}
```

#### Step 0.5 — Create `src/core/prompts/sections/memory.ts`

```typescript
// src/core/prompts/sections/memory.ts
import { loadMemoryPrompt, loadMemoryIndex } from "../../memory/memoryPrompt"

export async function getMemorySection(cwd: string): Promise<string> {
	const prompt = await loadMemoryPrompt(cwd)
	return prompt ?? ""
}

export async function getMemoryIndexSection(cwd: string): Promise<string> {
	return loadMemoryIndex(cwd)
}
```

Register in [`sections/index.ts`](../Roo-Code/src/core/prompts/sections/index.ts:1):

```typescript
export { getMemorySection, getMemoryIndexSection } from "./memory"
```

#### Step 0.6 — Inject into [`system.ts`](../Roo-Code/src/core/prompts/system.ts:115)

Add to the imports at the top of `system.ts`:

```typescript
import { getMemorySection, getMemoryIndexSection } from "./sections"
```

Modify `basePrompt` assembly — insert the memory behavioral section after `getRulesSection` and append the index alongside custom instructions:

```typescript
const memorySection = await getMemorySection(cwd)
const memoryIndex = await getMemoryIndexSection(cwd)

const basePrompt = `${roleDefinition}

${markdownFormattingSection()}

${getSharedToolUseSection()}${toolsCatalog}

	${getToolUseGuidelinesSection()}

${getCapabilitiesSection(cwd, hasMcpGroup ? mcpHub : undefined, allowedMcpServers)}
${deferredToolsSection ? `\n${deferredToolsSection}\n` : ""}
${modesSection}
${skillsSection ? `\n${skillsSection}` : ""}
${getRulesSection(cwd, settings)}
${memorySection ? `\n${memorySection}` : ""}

${getSystemInfoSection(cwd)}

${getObjectiveSection()}

${await addCustomInstructions(baseInstructions, globalCustomInstructions || "", cwd, mode, {
	language: language ?? formatLanguage(vscode.env.language),
	rooIgnoreInstructions,
	settings,
})}
${memoryIndex}`
```

(Alternatively, prepend `memoryIndex` inside `addCustomInstructions` with the `MEMORY_INSTRUCTION_PROMPT` prefix — closer to Claude Code's model.)

#### Step 0.7 — Filesystem write carve-out

In [`src/core/tools/validateToolUse.ts`](../Roo-Code/src/core/tools/validateToolUse.ts:1) (or in `WriteToFileTool`/`EditFileTool`'s path validation), add: if `isAutoMemPath(file_path, cwd)` → bypass the workspace-containment / `FileRestrictionError` check. Mirror Claude Code's carve-out.

#### Step 0.8 — Config

In [`src/core/config/ContextProxy.ts`](../Roo-Code/src/core/config/ContextProxy.ts:1) (and package.json contributes), add `autoMemoryEnabled` boolean (default `true`).

**End of Phase 0.** The model now has durable, model-managed memory.

---

### Phase 1 — Relevant-memory surfacing (recall)

#### Step 1.1 — Create `src/core/memory/memoryScan.ts`

Copy [`memoryScan.ts`](memdir/memoryScan.ts:1) verbatim. Replace `readFileInRange` with a simple `fs.readFile` + `fs.stat` for mtime (or implement a bounded read). Replace `parseFrontmatter` with `gray-matter`:

```typescript
import matter from "gray-matter"
// …
const { data: frontmatter } = matter(content)
return {
	filename: relativePath,
	filePath,
	mtimeMs: stat.mtimeMs,
	description: frontmatter.description ?? null,
	type: parseMemoryType(frontmatter.type),
}
```

`readdir({ recursive: true })` works on Node 18.17+ (Roo requires recent Node).

#### Step 1.2 — Create `src/core/memory/relevance.ts`

Copy [`findRelevantMemories.ts`](memdir/findRelevantMemories.ts:1). Replace `sideQuery` with an Anthropic Haiku call using Roo's API handler ([`src/api/`](../Roo-Code/src/api/)). Use JSON mode:

```typescript
import Anthropic from "@anthropic-ai/sdk"
// …
const client = new Anthropic(/* Roo's API config */)
const result = await client.messages.create({
	model: "claude-haiku-…", // fast model
	max_tokens: 256,
	system: SELECT_MEMORIES_SYSTEM_PROMPT,
	messages: [{ role: "user", content: `Query: ${query}\n\nAvailable memories:\n${manifest}${toolsSection}` }],
	// force JSON output:
})
const parsed = JSON.parse(result.content[0].text)
return parsed.selected_memories.filter((f) => validFilenames.has(f))
```

#### Step 1.3 — Create `src/core/memory/surfacing.ts`

Port `readMemoriesForSurfacing`, `memoryHeader`, `collectSurfacedMemories` from [`attachments.ts`](utils/attachments.ts:2279). Define a Roo-side attachment/message format (a hidden user message wrapped in `<system-reminder>` tags — Roo injects environment details this way already).

#### Step 1.4 — Prefetch lifecycle in the Task loop

In Roo's `Task` class ([`src/core/task/`](../Roo-Code/src/core/task/)), on user-message submit:

- Find last real user message; skip single-word prompts.
- Start the ranking promise (non-blocking) with an `AbortController` tied to task abort.
- Each assistant-iteration boundary: poll `settledAt`; if settled and not consumed, `await` the promise, dedup against files already read/written, inject as a `<system-reminder>` user message, mark consumed.
- On task abort/exit: abort the controller.

Roo has no `using`/Disposable; use explicit try/finally.

#### Step 1.5 — `collectRecentSuccessfulTools`

Port [`collectRecentSuccessfulTools()`](utils/attachments.ts:2465) to scan Roo's message format (assistant `tool_use` blocks + user `tool_result` blocks). Pass to the selector.

---

### Phase 2 — Background extraction & consolidation

#### Step 2.1 — `src/core/memory/extractMemories.ts`

On task completion (hook into [`TaskLifecycle.ts`](../Roo-Code/src/core/task/TaskLifecycle.ts:1)):

- Gate: `isAutoMemoryEnabled` + main-agent-only.
- Check `hasMemoryWritesSince` (did the main task already write a memory file? if so, skip).
- Spawn a sub-`Task` with a sandboxed tool-approval gate (port [`createAutoMemCanUseTool()`](services/extractMemories/extractMemories.ts:171) → Roo's tool approval: allow `read_file`/`search_files`/`list_files` unrestricted; `execute_command` read-only; `write_to_file`/`edit_file` only inside `isAutoMemPath`).
- Feed the extraction prompt ([`buildExtractAutoOnlyPrompt`](services/extractMemories/prompts.ts:50), ported) + the recent message transcript + the existing memory manifest.
- `maxTurns: 5`. On completion, emit a "Saved N memories" notification.

#### Step 2.2 — `src/core/memory/autoDream.ts`

Periodic background task (a `setInterval` or on-task-completion check), gated on time (≥24h) + session count (≥5 sessions from [`TaskHistoryStore`](../Roo-Code/src/core/task-persistence/TaskHistoryStore.ts:1) newer than `lastConsolidatedAt`). Lock file in `globalStoragePath`. Run as a sub-`Task` with the same sandbox, using [`buildConsolidationPrompt()`](services/autoDream/consolidationPrompt.ts:10) (copy verbatim — it's self-contained).

---

### Phase 3 — Team memory (defer)

Needs a backend sync service. Port [`teamMemPaths.ts`](memdir/teamMemPaths.ts:84) + [`teamMemorySync/`](services/teamMemorySync/index.ts:1) only if Roo-Code adds a cloud backend. The combined prompt ([`buildCombinedMemoryPrompt`](memdir/teamMemPrompts.ts:22)) adds the `<scope>` guidance.

---

### What to drop for Roo

- `bun:bundle` `feature()` flags → Roo's `experiments` system (`Record<string, boolean>`) or static booleans.
- GrowthBook runtime flags → static config or Roo settings.
- `sideQuery`'s prompt-cache nuances → a fresh Haiku call is fine.
- The `bun:bundle` tree-shaking `require()` pattern → plain ESM imports.
- Telemetry (`logEvent`) → Roo's telemetry or no-op.
- KAIROS daily-log mode → niche; defer.

---

## Quick Reference: Files to Read First When Porting

1. [`memdir/memoryTypes.ts`](memdir/memoryTypes.ts:1) — copy nearly verbatim (pure data, no deps).
2. [`memdir/paths.ts`](memdir/paths.ts:1) — adapt storage root to VS Code globalStorage.
3. [`memdir/memdir.ts`](memdir/memdir.ts:199) `buildMemoryLines()` — the prompt body.
4. [`memdir/memoryScan.ts`](memdir/memoryScan.ts:35) — the scan primitive (pure FS).
5. [`memdir/findRelevantMemories.ts`](memdir/findRelevantMemories.ts:39) — the recall ranker (replace sideQuery).
6. [`utils/attachments.ts`](utils/attachments.ts:2361) `startRelevantMemoryPrefetch` — prefetch lifecycle.
7. [`services/extractMemories/extractMemories.ts`](services/extractMemories/extractMemories.ts:171) `createAutoMemCanUseTool` — tool sandbox.
8. [`services/autoDream/consolidationPrompt.ts`](services/autoDream/consolidationPrompt.ts:10) — consolidation prompt (copy verbatim).
9. [`memdir/memoryAge.ts`](memdir/memoryAge.ts:1) — staleness helpers (copy verbatim).

---

## Appendix A: A Complete `MEMORY.md` Example

```markdown
- [User role](user_role.md) — Senior backend engineer, prefers functional style, deep Go/Postgres
- [Testing policy](feedback_db_tests.md) — Integration tests must hit real DB, not mocks (2025-Q3 incident)
- [Merge freeze](project_merge_freeze.md) — Merge freeze 2026-03-05 for mobile release cut
- [Pipeline bugs](reference_pipeline_bugs.md) — Tracked in Linear project "INGEST"
```

## Appendix B: A Complete Topic File Example

```markdown
---
name: Testing policy
description: Integration tests must hit a real DB; mocking burned us in 2025-Q3 migration
type: feedback
---

Integration tests must hit a real database, not mocks.

**Why:** In 2025-Q3, mocked tests passed but the prod migration failed silently — mock/prod divergence masked the bug.
**How to apply:** When writing or reviewing tests that touch the data layer, reject mock-based DB setups. Flag PRs that introduce them.
```

---

# Round-Trip 2 — Deep-Dive Addenda (gap-filling)

> The sections below were added in a second analysis pass over the leaked source. They fill gaps the Round-1 document left as hand-waves ("defer for the Roo port", "verbatim", "the run loop") by quoting the actual code and behaviour. Where a Round-1 statement is corrected or sharpened, see [§21](#21-correctedrefined-facts-from-round-1).

---

## 13. Feature Flags & Build Gates — Complete Map

Claude Code's memory system is gated by **two layers**: compile-time `bun:bundle` `feature()` flags (tree-shaken out of external builds) and **runtime GrowthBook flags** (`getFeatureValue_CACHED_MAY_BE_STALE`). Round 1 mentioned both but never enumerated them. Here is the complete map.

### 13.1 Compile-time `feature()` flags ([`bun:bundle`](https://bun.sh/docs/bundlers/bun-build))

| Flag               | What it gates                                                                                                                                                                                                                                                       | Where it's checked                                                                                                                                                                                                                                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `EXTRACT_MEMORIES` | The entire `extractMemories` background agent (init + execute + drain). When off, the module is `require`-stubbed to `null` so it's tree-shaken.                                                                                                                    | [`utils/backgroundHousekeeping.ts:34`](utils/backgroundHousekeeping.ts:34), [`query/stopHooks.ts:142`](query/stopHooks.ts:142), [`cli/print.ts:967`](cli/print.ts:967)                                                                                                                                               |
| `TEAMMEM`          | All team-memory code paths: combined prompt builder, sync service, watcher, secret guard, combined extract prompt, team-path detection. Every consumer uses a `feature('TEAMMEM') ? require(...) : null` pattern so the team code is excluded from external builds. | every file in [`services/teamMemorySync/`](services/teamMemorySync/index.ts:1), [`memdir/teamMemPaths.ts`](memdir/teamMemPaths.ts:1), [`memdir/teamMemPrompts.ts`](memdir/teamMemPrompts.ts:1), [`memdir/memdir.ts:448`](memdir/memdir.ts:448), [`utils/memoryFileDetection.ts:17`](utils/memoryFileDetection.ts:17) |
| `KAIROS`           | The append-only daily-log prompt variant for assistant sessions.                                                                                                                                                                                                    | [`memdir/memdir.ts:432`](memdir/memdir.ts:432)                                                                                                                                                                                                                                                                       |

> **Critical pattern**: because `feature()` must appear _directly in an `if` condition_ to tree-shake, helpers like `isExtractModeActive()` ([`memdir/paths.ts:69`](memdir/paths.ts:69)) explicitly note that they **cannot** encapsulate the `feature('EXTRACT_MEMORIES')` check — callers must gate on it themselves.

### 13.2 Runtime GrowthBook flags

All read via `getFeatureValue_CACHED_MAY_BE_STALE(flagName, defaultValue)` — non-blocking, may be stale until GB initializes.

| Flag name              | Default                  | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tengu_passport_quail` | `false`                  | **Master switch for `extractMemories`**. Without it, extraction is a no-op (and a one-shot `tengu_extract_memories_gate_disabled` event fires for `ant` users).                                                                                                                                                                                                                                                                                                                    |
| `tengu_slate_thimble`  | `false`                  | Allows `extractMemories` to run in **non-interactive** (`-p`/SDK) sessions. Without it, extraction only runs interactively ([`memdir/paths.ts:73`](memdir/paths.ts:73)).                                                                                                                                                                                                                                                                                                           |
| `tengu_moth_copse`     | `false`                  | **Recall/index tradeoff**. When on: (a) the `findRelevantMemories` prefetch is active ([`utils/attachments.ts:2367`](utils/attachments.ts:2367)), (b) the `MEMORY.md` index is **no longer injected** into the system prompt ([`utils/claudemd.ts:1145`](utils/claudemd.ts:1145) `filterInjectedMemoryFiles`), (c) the `skipIndex` path is used in both the prompt and extract builders (single-file save, no `MEMORY.md` pointer step). This is the "recall replaces index" mode. |
| `tengu_bramble_lintel` | `null`→`1`               | Throttle: run extraction only every **N eligible turns**. `null` falls back to `1` (every turn). Trailing runs skip the throttle ([`services/extractMemories/extractMemories.ts:380`](services/extractMemories/extractMemories.ts:380)).                                                                                                                                                                                                                                           |
| `tengu_onyx_plover`    | `null`→`{enabled:false}` | **autoDream master switch + scheduling knobs**. Shape `{ enabled?: boolean, minHours?: number, minSessions?: number }`. The user's `settings.json` `autoDreamEnabled` overrides the `enabled` field when explicitly set ([`services/autoDream/config.ts:13`](services/autoDream/config.ts:13)). Defaults: `minHours: 24`, `minSessions: 5` ([`services/autoDream/autoDream.ts:63`](services/autoDream/autoDream.ts:63)).                                                           |
| `tengu_herring_clock`  | `false`                  | **Team memory master switch** ([`memdir/teamMemPaths.ts:77`](memdir/teamMemPaths.ts:77)). Also used in the disabled-path telemetry to detect "was this user in the cohort at all" ([`memdir/memdir.ts:503`](memdir/memdir.ts:503)).                                                                                                                                                                                                                                                |
| `tengu_coral_fern`     | `false`                  | Adds the "Searching past context" section to the memory prompt (grep recipes for memory dir + transcripts) ([`memdir/memdir.ts:376`](memdir/memdir.ts:376)).                                                                                                                                                                                                                                                                                                                       |
| `tengu_paper_halyard`  | `false`                  | **Unrelated to memory** — skips project-level CLAUDE.md files. Documented here only to disambiguate from the `tengu_*` family.                                                                                                                                                                                                                                                                                                                                                     |

### 13.3 Settings.json keys

| Key                   | Type                   | Source-trusted?                                            | Purpose                                                                                                                                                                                                                                         |
| --------------------- | ---------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `autoMemoryEnabled`   | `boolean \| undefined` | any source (incl. **project** — supports per-repo opt-out) | Overrides the default-on `isAutoMemoryEnabled()` ([`memdir/paths.ts:51`](memdir/paths.ts:51)).                                                                                                                                                  |
| `autoMemoryDirectory` | `string \| undefined`  | **policy/flag/local/user only — project EXCLUDED**         | Full override of the auto-mem dir path. Project settings are excluded so a malicious repo can't point `autoMemoryDirectory: "~/.ssh"` and gain silent write access via the filesystem carve-out ([`memdir/paths.ts:179`](memdir/paths.ts:179)). |
| `autoDreamEnabled`    | `boolean \| undefined` | any source                                                 | Overrides `tengu_onyx_plover.enabled` ([`services/autoDream/config.ts:14`](services/autoDream/config.ts:14)).                                                                                                                                   |

### 13.4 Environment variables

| Var                                                            | Effect                                                                                                                                                                                                                                                                                     |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `CLAUDE_CODE_DISABLE_AUTO_MEMORY`                              | `1`/`true` → memory OFF; `0`/`false` → memory ON (overrides everything else) ([`memdir/paths.ts:31`](memdir/paths.ts:31)).                                                                                                                                                                 |
| `CLAUDE_CODE_SIMPLE` (`--bare`)                                | Memory OFF ([`memdir/paths.ts:41`](memdir/paths.ts:41)). `stopHooks` also skips extraction/dream under bare mode ([`query/stopHooks.ts:136`](query/stopHooks.ts:136)).                                                                                                                     |
| `CLAUDE_CODE_REMOTE` (without `CLAUDE_CODE_REMOTE_MEMORY_DIR`) | Memory OFF — remote sessions have no persistent storage by default ([`memdir/paths.ts:44`](memdir/paths.ts:44)).                                                                                                                                                                           |
| `CLAUDE_CODE_REMOTE_MEMORY_DIR`                                | Base-dir override used in remote mode ([`memdir/paths.ts:86`](memdir/paths.ts:86)).                                                                                                                                                                                                        |
| `CLAUDE_COWORK_MEMORY_PATH_OVERRIDE`                           | Full auto-mem path override (Cowork SDK). Does **not** get the filesystem write carve-out (`hasAutoMemPathOverride()` returns true → carve-out is skipped) ([`memdir/paths.ts:161`](memdir/paths.ts:161), [`utils/permissions/filesystem.ts:1572`](utils/permissions/filesystem.ts:1572)). |
| `CLAUDE_COWORK_MEMORY_EXTRA_GUIDELINES`                        | Extra memory-policy text threaded into all prompt builders ([`memdir/memdir.ts:442`](memdir/memdir.ts:442)).                                                                                                                                                                               |
| `USER_TYPE=ant`                                                | Enables one-shot gate-failure telemetry logging only ([`services/extractMemories/extractMemories.ts:537`](services/extractMemories/extractMemories.ts:537)).                                                                                                                               |

### 13.5 Session-mode gates

`isExtractModeActive()` ([`memdir/paths.ts:69`](memdir/paths.ts:69)) = `tengu_passport_quail` **AND** (interactive **OR** `tengu_slate_thimble`). Additionally, both extract and dream:

- skip in **remote mode** (`getIsRemoteMode()`),
- skip for **subagents** (`context.toolUseContext.agentId` truthy — only the main agent runs them),
- require `isAutoMemoryEnabled()`.

**For the Roo port**: replace `feature()` with static `true`/`false` constants or the existing `experiments` map; replace GrowthBook with a settings-driven config object (the flag values map cleanly to Roo config keys). The `null`-defaults-that-fall-back-to-a-constant pattern is worth keeping — it lets you ship a flag off-by-default and flip it per-user later.

---

## 14. Trigger Wiring & Lifecycle — Where Everything Fires

Round 1 described _what_ each subsystem does but not _when/where it's invoked_. This section maps the full lifecycle.

### 14.1 Startup — [`utils/backgroundHousekeeping.ts`](utils/backgroundHousekeeping.ts:31)

`startBackgroundHousekeeping()` runs once at startup and **initializes** the closure-scoped state for both background writers:

```typescript
export function startBackgroundHousekeeping(): void {
	void initMagicDocs()
	void initSkillImprovement()
	if (feature("EXTRACT_MEMORIES")) {
		extractMemoriesModule!.initExtractMemories() // creates cursor, inFlight set, drainer
	}
	initAutoDream() // creates runner closure + scan throttle state
	void autoUpdateMarketplacesAndPluginsInBackground()
	// ...slow ops deferred 10 min...
}
```

Both `initExtractMemories()` and `initAutoDream()` are **idempotent but not re-entrant** — they assign module-level `extractor`/`runner` closures. Tests call them in `beforeEach` for isolation.

Team memory sync starts separately in [`setup.ts:366`](setup.ts:366):

```typescript
void import("./services/teamMemorySync/watcher.js").then((m) => m.startTeamMemoryWatcher())
```

This does an initial pull then starts `fs.watch` on the team dir (see [§15.3](#153-watcher--debounce-lifecycle)).

### 14.2 Per-turn end — [`query/stopHooks.ts`](query/stopHooks.ts:136)

`handleStopHooks` fires when the model produces a final response with no tool calls. Under non-bare mode, it **fire-and-forgets** both background writers (only for the main agent):

```typescript
if (!isBareMode()) {
	if (!isEnvDefinedFalsy(process.env.CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION)) {
		void executePromptSuggestion(stopHookContext)
	}
	if (feature("EXTRACT_MEMORIES") && !toolUseContext.agentId && isExtractModeActive()) {
		// Fire-and-forget in both interactive and non-interactive. For -p/SDK,
		// print.ts drains the in-flight promise after flushing the response
		// but before gracefulShutdownSync (see drainPendingExtraction).
		void extractMemoriesModule!.executeExtractMemories(stopHookContext, toolUseContext.appendSystemMessage)
	}
	if (!toolUseContext.agentId) {
		void executeAutoDream(stopHookContext, toolUseContext.appendSystemMessage)
	}
}
```

Note the ordering and gates: `extractMemories` requires `feature('EXTRACT_MEMORIES')` + `isExtractModeActive()`; `autoDream` only requires main-agent. Both are best-effort `void` calls — they don't block the response.

### 14.3 Shutdown drain — [`cli/print.ts:967`](cli/print.ts:967)

For `-p`/SDK (non-interactive) calls, the process would otherwise exit before the fire-and-forget extraction completes. So after flushing the response but **before** `gracefulShutdownSync`, `print.ts` awaits in-flight extractions:

```typescript
if (feature("EXTRACT_MEMORIES") && isExtractModeActive()) {
	await extractMemoriesModule!.drainPendingExtraction()
}
```

`drainPendingExtraction()` ([`services/extractMemories/extractMemories.ts:611`](services/extractMemories/extractMemories.ts:611)) races `Promise.all(inFlightExtractions)` against a 60 s soft timeout (`.unref()`'d so it never blocks exit). `autoDream` has no equivalent drain — a dream killed mid-fork rolls back its lock mtime so the time-gate re-passes next session.

### 14.4 Per-turn prefetch — [`query.ts`](query.ts:301) + [`query.ts:1599`](query.ts:1599)

The recall prefetch uses the `using` (Explicit Resource Management) pattern so it auto-disposes on all generator exit paths:

```typescript
// query.ts:301 — fired ONCE per user turn (prompt is invariant across iterations)
using pendingMemoryPrefetch = startRelevantMemoryPrefetch(state.messages, state.toolUseContext)
```

Inside the `while (true)` loop, the consume point **polls without blocking**:

```typescript
// query.ts:1599 — each iteration
if (
	pendingMemoryPrefetch &&
	pendingMemoryPrefetch.settledAt !== null &&
	pendingMemoryPrefetch.consumedOnIteration === -1
) {
	const memoryAttachments = filterDuplicateMemoryAttachments(
		await pendingMemoryPrefetch.promise, // already settled, so this is instant
		toolUseContext.readFileState, // dedup vs files already read/written
	)
	for (const memAttachment of memoryAttachments) {
		const msg = createAttachmentMessage(memAttachment)
		yield msg
		toolResults.push(msg)
	}
	pendingMemoryPrefetch.consumedOnIteration = turnCount - 1
}
```

`filterDuplicateMemoryAttachments` ([`utils/attachments.ts`](utils/attachments.ts:1)) is the cross-iteration dedup — it checks against the _full_ accumulated `readFileState`, not just the current iteration's tool blocks, so a memory surfaced in iteration 1 won't be re-injected after the model reads it in iteration 2.

### 14.5 Manual entry points (slash commands)

- **`/dream`** skill — calls [`buildConsolidationPrompt`](services/autoDream/consolidationPrompt.ts:10) directly in the main loop (full permissions, not sandboxed). [`recordConsolidation()`](services/autoDream/consolidationLock.ts:130) optimistically stamps the lock mtime at prompt-build time so the auto-trigger doesn't immediately re-fire (best-effort — no completion hook).
- **`/remember`** — Round 1 didn't find a dedicated memory tool; explicit "remember X" requests are handled by the _prompt instructions_ ("If the user explicitly asks you to remember something, save it immediately") driving the ordinary Write/Edit tools. The harness provides no special command for it.

**For the Roo port**: Roo's `Task` lifecycle hooks (`TaskLifecycle.ts` completion) are the analog of `handleStopHooks`. Start the prefetch on user-message submit (Roo has no `using` — use explicit `try/finally` + `AbortController`); consume at the assistant-iteration boundary; drain in-flight extractions on task completion.

---

## 15. Team Memory Internals — Deep Dive

Round 1 covered team memory at headline level. The security and sync machinery is substantial and worth quoting.

### 15.1 Path validation — the symlink-escape defense ([`memdir/teamMemPaths.ts`](memdir/teamMemPaths.ts:1))

Team memory paths are validated **twice** because `path.resolve()` does NOT resolve symlinks — an attacker who can place a symlink inside `teamDir` pointing to `~/.ssh/authorized_keys` would pass a `resolve()`-based check. The two passes:

1. **String-level**: `resolve()` + `startsWith(teamDir)` (with separator-after-prefix to defeat `/foo/team-evil` matching `/foo/team`). [`validateTeamMemWritePath`](memdir/teamMemPaths.ts:228) and [`validateTeamMemKey`](memdir/teamMemPaths.ts:265).
2. **Real-path-level**: `realpathDeepestExisting()` walks up the tree until `realpath()` succeeds (handling ENOENT for not-yet-created files, ENOTDIR, ELOOP, dangling-symlink detection via `lstat`), then rejoins the non-existing tail and checks `isRealPathWithinTeamDir()`. If `teamDir` doesn't exist yet, the real-path check is skipped (no symlink possible in a nonexistent dir).

`sanitizePathKey()` rejects: null bytes, URL-encoded traversals (`%2e%2e%2f`), Unicode-normalization attacks (fullwidth `．．／` → ASCII `../` under NFKC), backslashes, absolute paths. All throw `PathTraversalError` (a named `Error` subclass).

### 15.2 Secret scanner — [`services/teamMemorySync/secretScanner.ts`](services/teamMemorySync/secretScanner.ts:1)

A **client-side** gitleaks-curated ruleset (~30 high-confidence rules: AWS/GCP/Azure/Anthropic/OpenAI/GitHub/GitLab/Slack/Stripe/etc. + PEM private keys). Compiled lazily on first scan. Key design points:

- The Anthropic key prefix is **assembled at runtime** (`['sk','ant','api'].join('-')`) so the literal byte sequence isn't in the external bundle (excluded-strings check).
- `scanForSecrets()` returns `{ ruleId, label }` matches — **never the matched text**. Labels come from `ruleIdToLabel()` with a `specialCase` map (`aws`→`AWS`, `github`→`GitHub`, etc.).
- `redactSecrets()` replaces only the captured group with `[REDACTED]`, preserving boundary chars.

The guard that uses it — [`checkTeamMemSecrets()`](services/teamMemorySync/teamMemSecretGuard.ts:15) — is called from **both** `FileWriteTool` and `FileEditTool` `validateInput` ([`tools/FileWriteTool/FileWriteTool.ts:157`](tools/FileWriteTool/FileWriteTool.ts:157)). It returns an error message that blocks the write; the message names the rule labels ("Content contains potential secrets (GitHub PAT, AWS Access Token) and cannot be written to team memory."). Inert when `feature('TEAMMEM')` is off.

### 15.3 Watcher + debounce lifecycle — [`services/teamMemorySync/watcher.ts`](services/teamMemorySync/watcher.ts:1)

- **Initial pull** runs before `fs.watch` starts so its disk writes don't trigger a push.
- **`fs.watch({ recursive: true })`** is used instead of chokidar: chokidar 4+ dropped fsevents, and Bun's `fs.watch` fallback uses kqueue (one fd per file — 500+ team files = 500+ held fds, confirmed via lsof). Recursive watch is O(1) fds on macOS (FSEvents), O(subdirs) on Linux (inotify).
- **Debounce**: 2000 ms after last change before pushing (`schedulePush`).
- **Permanent-failure suppression**: if a push fails with `no_oauth`/`no_repo` or a 4xx (except 409 conflict / 429 rate limit), `pushSuppressedReason` is set and further pushes are skipped **until an unlink is detected** (recovery action for too-many-entries) or session restart. This exists because one `no_oauth` device emitted 167K push events over 2.5 days (BQ Mar 14-16). `fs.watch` doesn't distinguish unlink from add/write — the watcher `stat`s the filename; ENOENT clears suppression.
- **`notifyTeamMemoryWrite()`** is called from PostToolUse hooks as a belt-and-suspenders push trigger (fs.watch may miss same-tick writes or coalesce rapid writes).

### 15.4 Sync semantics — [`services/teamMemorySync/index.ts`](services/teamMemorySync/index.ts:1)

API contract (anthropic/anthropic#250711 + #283027):

- `GET /api/claude_code/team_memory?repo={owner/repo}` → full `TeamMemoryData` (entries + `entryChecksums`)
- `GET ...?view=hashes` → metadata + per-key checksums only (no bodies) — cheap refresh during 412 conflict resolution
- `PUT ...` → delta upload (upsert semantics)
- `404` = no data; `304` = ETag matched (conditional GET via `If-None-Match`)

Semantics:

- **Pull = server wins per-key** (overwrites local files with server content).
- **Push = delta upload** — only keys whose `sha256:<hex>` differs from `serverChecksums` are uploaded. Server upsert-merges; keys not in the PUT are preserved.
- **Deletions don't propagate** — deleting a local file won't remove it server-side, and the next pull restores it locally.
- **Size caps**: `MAX_FILE_SIZE_BYTES = 250_000` per entry (pre-filter to save bandwidth); `MAX_PUT_BODY_BYTES = 200_000` — batches larger than this are split into sequential PUTs (server upsert makes that safe). The ~200KB threshold is tuned to stay under the API gateway's ~256-512KB unstructured-413 HTML rejection.
- **No client-side entry-count cap** — the server's cap is GB-tunable per-org (`claude_code_team_memory_limits`), learned from a structured 413's `extra_details.max_entries` and cached in `SyncState.serverMaxEntries`.
- **Conflict (412)**: resolved by fetching hashes (`?view=hashes`), updating `serverChecksums`, and retrying (up to `MAX_CONFLICT_RETRIES = 2`).
- **Auth**: requires first-party OAuth with both `CLAUDE_AI_INFERENCE_SCOPE` and `CLAUDE_AI_PROFILE_SCOPE`. Non-github.com remotes are skipped early (`no_repo` would otherwise fire forever).
- **State**: `SyncState` (`lastKnownChecksum`, `serverChecksums` map, `serverMaxEntries`) is created once per session by the watcher and threaded through every call — no module-level mutable state, so tests get isolation.

### 15.5 Combined prompt — [`memdir/teamMemPrompts.ts`](memdir/teamMemPrompts.ts:22)

`buildCombinedMemoryPrompt()` differs from the individual prompt ([`memdir/memdir.ts`](memdir/memdir.ts:1) `buildMemoryLines`) in four ways:

1. Names **two** directories (private + team) and uses `DIRS_EXIST_GUIDANCE` ("Both directories already exist…") instead of `DIR_EXISTS_GUIDANCE`.
2. Adds a `## Memory scope` section defining `private` vs `team` (private persists per-user; team is synced at session start, shared across the org).
3. Uses `TYPES_SECTION_COMBINED` (per-type `<scope>` tags baked into each type block) instead of `TYPES_SECTION_INDIVIDUAL`.
4. Appends the sensitivity rule: "You MUST avoid saving sensitive data within shared team memories. For example, never save API keys or user credentials."

The combined prompt is only built when `feature('TEAMMEM') && isTeamMemoryEnabled()` ([`memdir/memdir.ts:448`](memdir/memdir.ts:448)).

### 15.6 The KAIROS/TEAMMEM precedence

`loadMemoryPrompt()` dispatches in this order ([`memdir/memdir.ts:419`](memdir/memdir.ts:419)):

1. KAIROS daily-log mode (takes precedence over TEAMMEM — append-only logs don't compose with team sync's shared `MEMORY.md`).
2. Combined auto+team (if `feature('TEAMMEM') && isTeamMemoryEnabled()`).
3. Auto-only (default).
4. `null` + `tengu_memdir_disabled` telemetry.

---

## 16. autoDream — Lock & Scheduling Internals

### 16.1 The lock file IS the timestamp — [`services/autoDream/consolidationLock.ts`](services/autoDream/consolidationLock.ts:1)

The lock file (`.consolidate-lock`, lives inside `getAutoMemPath()` so it keys on git-root like memory does) has a dual purpose: **its mtime IS `lastConsolidatedAt`**. The body is the holder's PID.

- `readLastConsolidatedAt()` = one `stat` → mtime (0 if absent). Per-turn cost.
- `tryAcquireConsolidationLock()`:
    1. `stat` + `readFile` the lock. If mtime < `HOLDER_STALE_MS` (1 hour) and the PID is live (`isProcessRunning`), bail (return null). Dead PID or unparseable body → reclaim.
    2. `writeFile(path, String(process.pid))`. mkdir the mem dir first if needed.
    3. **Race guard**: re-read the file; if our PID isn't what's there, we lost the race → bail.
    4. Returns the pre-acquire mtime (for rollback).
- `rollbackConsolidationLock(priorMtime)`: on fork failure, rewind mtime to pre-acquire so the time-gate re-passes. `priorMtime === 0` → unlink (restore no-file). Also clears the PID body so our still-running process doesn't look like a holder.
- `recordConsolidation()`: optimistic stamp from manual `/dream` (no completion hook).

The 1-hour `HOLDER_STALE_MS` is a PID-reuse guard — even if the PID is live, if the lock is older than an hour, reclaim.

### 16.2 The gate cascade — [`services/autoDream/autoDream.ts`](services/autoDream/autoDream.ts:122)

`initAutoDream()` creates the `runner` closure with `lastSessionScanAt = 0`. Each invocation (`executeAutoDream` from stopHooks) runs:

1. **`isGateOpen()`**: KAIROS off (uses disk-skill dream), remote off, auto-memory on, `isAutoDreamEnabled()` (settings > `tengu_onyx_plover.enabled`).
2. **Time gate**: `hoursSince = (now - readLastConsolidatedAt()) / 3.6e6` ≥ `cfg.minHours` (default 24). One stat.
3. **Scan throttle**: if time-gate passed but we scanned < 10 min ago (`SESSION_SCAN_INTERVAL_MS`), skip — otherwise the time-gate would pass every turn while waiting for the session-gate.
4. **Session gate**: `listSessionsTouchedSince(lastAt)` (transcripts with mtime > lastAt, current session excluded) ≥ `cfg.minSessions` (default 5). Uses mtime (sessions touched), not birthtime (0 on ext4).
5. **Lock**: `tryAcquireConsolidationLock()`.

On failure (non-abort), `failDreamTask` + `rollbackConsolidationLock` so the time-gate re-passes (scan throttle is the backoff). On user-kill from the bg-tasks dialog, `DreamTask.kill` already aborted + rolled back — the catch detects `abortController.signal.aborted` and returns without double-rollback.

### 16.3 The fork + progress watcher

```typescript
const result = await runForkedAgent({
	promptMessages: [createUserMessage({ content: prompt })],
	cacheSafeParams: createCacheSafeParams(context), // shares parent's prompt cache
	canUseTool: createAutoMemCanUseTool(memoryRoot), // same sandbox as extractMemories
	querySource: "auto_dream",
	forkLabel: "auto_dream",
	skipTranscript: true,
	overrides: { abortController },
	onMessage: makeDreamProgressWatcher(taskId, setAppState),
})
```

The `extra` string appended to the consolidation prompt names the tool constraints (read-only Bash) **and** lists the sessions to review (so the agent doesn't grep blindly). `makeDreamProgressWatcher` extracts text + tool-use counts + Edit/Write file_paths per assistant turn for UI progress (`addDreamTurn`). On success, if `filesTouched.length > 0`, an inline `createMemorySavedMessage` with `verb: 'Improved'` is appended to the main transcript (same surface as extractMemories's "Saved N memories").

---

## 17. extractMemories — Run Loop & State Machine

Round 1 listed the closure-scoped state but didn't show the full state machine. Here it is.

### 17.1 State ([`services/extractMemories/extractMemories.ts:296`](services/extractMemories/extractMemories.ts:296))

```typescript
const inFlightExtractions = new Set<Promise<void>>() // for drain
let lastMemoryMessageUuid: string | undefined // cursor
let hasLoggedGateFailure = false // one-shot telemetry
let inProgress = false // overlap guard
let turnsSinceLastExtraction = 0 // throttle counter
let pendingContext: { context; appendSystemMessage } | undefined // stashed trailing run
```

### 17.2 The `executeExtractMemoriesImpl` flow ([`:527`](services/extractMemories/extractMemories.ts:527))

1. **Subagent guard**: `if (context.toolUseContext.agentId) return` — main agent only.
2. **Gate**: `tengu_passport_quail` (one-shot log if ant-user), `isAutoMemoryEnabled()`, `!getIsRemoteMode()`.
3. **Overlap guard**: if `inProgress`, stash `{context, appendSystemMessage}` in `pendingContext` (overwrites any prior stash — only the latest matters since it has the most messages) and return. Logs `tengu_extract_memories_coalesced`.
4. Else call `runExtraction({context, appendSystemMessage})` and track the promise in `inFlightExtractions` (for drain).

### 17.3 The `runExtraction` flow ([`:329`](services/extractMemories/extractMemories.ts:329))

1. **`newMessageCount`** = `countModelVisibleMessagesSince(messages, lastMemoryMessageUuid)`. If the cursor UUID wasn't found (e.g. removed by compaction), falls back to counting **all** visible messages — never returns 0 (which would permanently disable extraction).
2. **Mutual exclusion**: `hasMemoryWritesSince(messages, lastMemoryMessageUuid)` — if the main agent already wrote to an auto-mem path this turn, skip the fork AND advance the cursor past this range (so the next extraction only considers messages _after_ the main agent's write). Logs `tengu_extract_memories_skipped_direct_write`.
3. **Throttle** (non-trailing runs only): increment `turnsSinceLastExtraction`; if `< tengu_bramble_lintel ?? 1`, return. Then reset to 0.
4. **Pre-inject manifest**: `formatMemoryManifest(await scanMemoryFiles(...))` so the agent doesn't spend a turn on `ls`. Placed **after** the throttle so skipped turns don't pay the scan cost.
5. **Build prompt**: `buildExtractCombinedPrompt` (if TEAMMEM + enabled) else `buildExtractAutoOnlyPrompt`, both with `skipIndex = tengu_moth_copse`.
6. **Fork**: `runForkedAgent({ maxTurns: 5, skipTranscript: true, querySource: 'extract_memories', ... })`. The opener prompt instructs: "turn 1 — issue all Reads in parallel; turn 2 — issue all Writes in parallel. Do not interleave."
7. **Advance cursor only on success** — on error the cursor stays put so those messages are reconsidered next time.
8. **Extract written paths**, filter out `MEMORY.md` (index updates are mechanical; the user-visible "memory" is the topic file). If TEAMMEM, count team vs personal via `isTeamMemPath`.
9. **Telemetry**: `tengu_extract_memories_extraction` with token usage (input/output/cache-read/cache-create), message_count, turn_count, files_written, memories_saved, team_memories_saved, duration_ms. Cache hit % is logged separately for debugging.
10. **Notify**: if `memoryPaths.length > 0`, `appendSystemMessage(createMemorySavedMessage(memoryPaths))` — the "Saved N memories" UI message.
11. **`finally`**: clear `inProgress`; if `pendingContext` was stashed, run a **trailing extraction** with `isTrailingRun: true` (which skips the throttle — already-committed work shouldn't be throttled). The trailing run computes its `newMessageCount` relative to the just-advanced cursor, so it only picks up messages added between the two calls.

### 17.4 The opener prompt — [`services/extractMemories/prompts.ts:29`](services/extractMemories/prompts.ts:29)

The shared `opener()` is the part Round 1 paraphrased. Verbatim key lines:

- "You are now acting as the memory extraction subagent. Analyze the most recent ~N messages above…"
- "Available tools: Read, Grep, Glob, read-only Bash (ls/find/cat/stat/wc/head/tail and similar), and Edit/Write for paths inside the memory directory only. Bash rm is not permitted. All other tools — MCP, Agent, write-capable Bash, etc — will be denied."
- "You have a limited turn budget. Edit requires a prior Read of the same file, so the efficient strategy is: turn 1 — issue all Read calls in parallel for every file you might update; turn 2 — issue all Write/Edit calls in parallel. Do not interleave reads and writes across multiple turns."
- "You MUST only use content from the last ~N messages to update your persistent memories. Do not waste any turns attempting to investigate or verify that content further — no grepping source files, no reading code to confirm a pattern exists, no git commands."
- Then the existing-memory manifest + "Check this list before writing — update an existing file rather than creating a duplicate."

The comment at the top of `prompts.ts` is important: the extraction agent runs as a **perfect fork** sharing the parent's prompt cache, and the main agent's system prompt always has full save instructions — so when the main agent writes memories, `hasMemoryWritesSince` skips the fork. The extraction prompt fires only when the main agent _didn't_ write, making the save-criteria overlap harmless.

`buildExtractCombinedPrompt` mirrors the individual variant but uses `TYPES_SECTION_COMBINED` (per-type `<scope>`) and adds the sensitivity rule. When `feature('TEAMMEM')` is off it delegates straight to `buildExtractAutoOnlyPrompt`.

---

## 18. Supporting Primitives (`sideQuery`, frontmatter, bounded read, detection)

### 18.1 `sideQuery` — [`utils/sideQuery.ts`](utils/sideQuery.ts:107)

Round 1 called it "a lightweight separate API call." The actual wrapper is the canonical entry point for all out-of-loop model calls (memory ranking, permission explainer, session search, model validation). It handles:

- **OAuth fingerprint + attribution header** (`computeFingerprint` on first user message text, `getAttributionHeader`), placed in its own `TextBlockParam` so server-side parsing extracts `cc_entrypoint` cleanly.
- **CLI system prompt prefix** (skippable via `skipSystemPromptPrefix` — the memory ranker uses this since it provides its own prompt).
- **Betas**: `getModelBetas(model)` + `STRUCTURED_OUTPUTS_BETA_HEADER` if `output_format` set and model supports structured outputs.
- **Model normalization** (strips `[1m]` suffix via `normalizeModelStringForAPI`).
- **Telemetry**: `tengu_api_success` with `querySource` (memory uses `memdir_relevance`), token counts, `timeSinceLastApiCallMs`, and updates `setLastApiCompletionTimestamp`.

The memory ranker calls it with `max_tokens: 256`, `output_format: { type: 'json_schema', schema: { selected_memories: string[] } }`, `skipSystemPromptPrefix: true` — so the JSON output is **schema-constrained**, not just JSON mode.

**For the Roo port**: Roo's API handler at [`src/api/`](../Roo-Code/src/api/) doesn't need all the OAuth machinery, but the structured-output (JSON-schema-constrained) call is the load-bearing part — it guarantees `{ selected_memories: [...] }` parses. Use the Anthropic SDK's `output_config.format` (or forced tool-use as a fallback) rather than plain `response_format: { type: 'json_object' }`.

### 18.2 Frontmatter parser — [`utils/frontmatterParser.ts`](utils/frontmatterParser.ts:130)

`FRONTMATTER_REGEX = /^---\s*\n([\s\S]*?)---\s*\n?/`. Parses with `parseYaml`, with a **fallback**: if YAML parsing throws, it pre-processes via `quoteProblematicValues()` (quotes values containing `{ } [ ] * & # ! | > % @ \` `or`: `— the colon-space pattern so`12:34`times and`https://` URLs stay unquoted) and retries. Still-failures log a warning with the source path.

`FrontmatterData` is a union type covering memory fields (`description`, `type`) plus slash-command/agent/skill fields (`allowed-tools`, `argument-hint`, `model`, `skills`, `hooks`, `effort`, `context: 'inline'|'fork'`, `paths`, `shell`). Memory only reads `description` and `type`; `parseMemoryType()` narrows `type` to the 4-value union.

**For the Roo port**: `gray-matter` is the easy choice, but it doesn't do the colon-space-aware quoting fallback. For memory files specifically (simple key:value YAML), a minimal hand-rolled parser is fine and avoids a dep.

### 18.3 `readFileInRange` — [`utils/readFileInRange.ts`](utils/readFileInRange.ts:73)

Two code paths:

- **Fast path** (regular files < 10 MB): `readFile` whole file, split lines in memory, select range. ~2x faster than streaming for typical source files.
- **Streaming path** (large files, pipes, devices): `createReadStream` with manual `\n` scanning. Content is only accumulated for lines **inside** the requested range — lines outside are counted (for `totalLines`) but discarded, so reading line 1 of a 100 GB file won't balloon RSS. All event handlers are module-level named functions with zero closures (state in a `StreamState` object, accessed via `this`).

Both paths strip UTF-8 BOM and `\r` (CRLF→LF). `mtimeMs` comes from `fstat`/`stat` on the already-open fd — no extra open. `maxBytes` behavior depends on `options.truncateOnByteLimit`: `false` (default) throws `FileTooLargeError` if the file/streamed bytes exceed it; `true` caps the **selected output** at maxBytes (stops at last complete line that fits, sets `truncatedByBytes`).

Memory uses it three ways:

- `scanMemoryFiles`: `readFileInRange(filePath, 0, 30, undefined, signal)` — first 30 lines (frontmatter only).
- `readMemoriesForSurfacing`: `readFileInRange(filePath, 0, MAX_MEMORY_LINES, MAX_MEMORY_BYTES, signal, { truncateOnByteLimit: true })` — truncate mode so a huge memory file is clipped not errored.

**For the Roo port**: a simple `fs.readFile` + `fs.stat` + slice is acceptable (Round 1 said this). The streaming path only matters if you expect multi-GB memory files, which you won't.

### 18.4 File detection & freshness UI — [`utils/memoryFileDetection.ts`](utils/memoryFileDetection.ts:1)

- `isAutoMemFile(path)` = `isAutoMemoryEnabled() && isAutoMemPath(path)` — used by `FileReadTool` to record mtimes.
- `memoryScopeForPath(path)` returns `'team'` | `'personal'` | `null` — **checks team first** because the team dir is a subdirectory of the auto-mem dir (a team path matches both). Used for scope-keyed telemetry.
- `isAutoManagedMemoryFile(path)` = auto-mem OR team-mem OR session-memory/transcript OR agent-memory — used by collapse/badge logic so user-managed files (CLAUDE.md) show full diffs but managed memory files collapse.
- `isMemoryDirectory(dirPath)` — the Grep/Glob counterpart (takes a directory, not a file); handles the `CLAUDE_COWORK_MEMORY_PATH_OVERRIDE`, agent-memory dirs (`/agent-memory/`, `/agent-memory-local/`), session-memory, team, and `projects/` transcript dirs.
- `detectSessionFileType` / `detectSessionPatternType` — distinguish `session-memory/*.md` from `projects/*.jsonl` transcripts (used by `isShellCommandTargetingMemory`).

**Freshness UI** ([`tools/FileReadTool/FileReadTool.ts:747`](tools/FileReadTool/FileReadTool.ts:747)): a `WeakMap<object, number>` (`memoryFileMtimes`) side-channels the mtime from `call()` to `mapToolResultToToolResultBlockParam` (avoids adding a presentation-only field to the SDK output schema, avoids sync fs in the mapper). `memoryFileFreshnessPrefix()` returns `memoryFreshnessNote(mtimeMs)` — the `<system-reminder>…is N days old…</system-reminder>` staleness text prepended to memory file read results.

### 18.5 `teamMemoryOps.ts` — UI summary helpers

[`utils/teamMemoryOps.ts`](utils/teamMemoryOps.ts:1) re-exports `isTeamMemFile` and adds `isTeamMemorySearch` (Grep/Glob targeting team mem), `isTeamMemoryWriteOrEdit` (Write/Edit targeting team mem), and `appendTeamMemorySummaryParts` (the "Recalling N team memories / Searched team memories / Wrote N team memories" verb logic for `getSearchReadSummaryText`). Pure presentation; no behavioral effect on memory itself.

---

## 19. Filesystem & Tool Integration Hooks

### 19.1 The write carve-out — [`utils/permissions/filesystem.ts`](utils/permissions/filesystem.ts:1572)

Round 1 mentioned the carve-out exists. The precise behavior:

- **Write carve-out** (step ~4 of the permission cascade): `if (!hasAutoMemPathOverride() && isAutoMemPath(normalizedPath))` → `allow` with reason "auto memory files are allowed for writing". This exists because the **default** mem dir is under `~/.claude/`, which is in `DANGEROUS_DIRECTORIES` — without the carve-out every memory write would prompt. The `CLAUDE_COWORK_MEMORY_PATH_OVERRIDE` path gets **no** special treatment (it's an arbitrary caller-designated dir with no `~/.claude/` conflict) — SDK callers wanting silent memory pass an allow rule for the override path.
- **Read carve-out** (separate, a few steps later): `if (isAutoMemPath(normalizedPath))` → `allow` with reason "auto memory files are allowed for reading". Note the read carve-out does **not** check `hasAutoMemPathOverride()` — reads are always allowed regardless of override.

### 19.2 Secret guard on Write/Edit — [`tools/FileWriteTool/FileWriteTool.ts:157`](tools/FileWriteTool/FileWriteTool.ts:157)

`validateInput` calls `checkTeamMemSecrets(fullFilePath, content)` **first**, before any permission-rule check. If it returns an error string, the write is rejected with `errorCode: 0`. `FileEditTool` has the same guard. This is the only place secrets are blocked at write time — the sync watcher's `pushTeamMemory` also scans (`scanForSecrets`) before upload as a second line of defense, populating `skippedSecrets` in the push result.

### 19.3 Agent-memory injection — [`tools/AgentTool/loadAgentsDir.ts`](tools/AgentTool/loadAgentsDir.ts:456)

Sub-agents with a `memory` field in their frontmatter get Read/Write/Edit injected with a per-agent memory dir (`isAgentMemoryPath`). This is a **separate** memory store from auto-memory (lives under `/agent-memory/` or `/agent-memory-local/`), detected by `isAgentMemFile` / `isAgentMemoryPath`. It uses `buildMemoryPrompt` (the variant that includes `MEMORY.md` content inline, since agents have no `getClaudeMds()` equivalent) rather than `loadMemoryPrompt`.

### 19.4 No `MemoryTool` (confirmed)

A grep across [`tools/`](tools/) confirms: there is no `MemoryTool`. The model interacts with memory purely through `Read`/`Write`/`Edit`/`Grep`/`Glob` against the mem dir, gated by the prompt instructions + the filesystem carve-out + (for the background agents) `createAutoMemCanUseTool`.

---

## 20. KAIROS Daily-Log Mode & the SessionMemory Distinction

### 20.1 KAIROS daily-log prompt — [`memdir/memdir.ts:327`](memdir/memdir.ts:327)

`buildAssistantDailyLogPrompt()` is a **different paradigm** for long-lived assistant sessions (which are effectively perpetual, so maintaining `MEMORY.md` as a live index doesn't fit). Instead:

- The agent **appends** timestamped bullets to a date-named log file: `<memDir>/logs/YYYY/MM/YYYY-MM-DD.md`.
- The path is described as a **pattern** (not today's literal path) because the prompt is cached by `systemPromptSection('memory', ...)` and NOT invalidated on date change — the model derives today's date from the `date_change` attachment (appended at midnight rollover) rather than the user-context message (intentionally left stale to preserve the prompt-cache prefix across midnight).
- The log is **append-only** — "Do not rewrite or reorganize the log." A separate nightly process (the `/dream` skill in KAIROS mode) distills logs into `MEMORY.md` + topic files.
- `MEMORY.md` is still loaded into context (via claudemd.ts) as the distilled index — this prompt only changes where **new** memories go.
- "What to log" list mirrors the type taxonomy (corrections/preferences, user facts, non-derivable project context, external pointers, explicit "remember" requests) + the same `WHAT_NOT_TO_SAVE_SECTION`.

KAIROS takes **precedence over TEAMMEM** in `loadMemoryPrompt()` because append-only logs don't compose with team sync (which expects a shared `MEMORY.md` both sides read+write). `autoDream`'s `isGateOpen()` also returns false under KAIROS ("KAIROS mode uses disk-skill dream").

### 20.2 SessionMemory is NOT memdir memory — [`services/SessionMemory/sessionMemory.ts`](services/SessionMemory/sessionMemory.ts:1)

Round 1 didn't mention SessionMemory, which is a **different, older** memory system that's easy to confuse with memdir. Key distinctions:

| Aspect    | memdir (auto-memory)                            | SessionMemory                                                                                                              |
| --------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Scope     | Cross-conversation, per-project                 | **Single conversation**                                                                                                    |
| Storage   | `<memDir>/*.md` topic files + `MEMORY.md` index | `~/.claude/session-memory/<session-id>.md` (one file per session)                                                          |
| Trigger   | End of each turn (`stopHooks`)                  | Periodically after N tool calls (`getToolCallsBetweenUpdates`), gated by `isAutoCompactEnabled` and init/update thresholds |
| Purpose   | Durable facts about user/project/preferences    | Running notes about the **current** conversation (so compaction doesn't lose context)                                      |
| Lifecycle | Persists forever                                | Tied to the session; used as compaction input                                                                              |
| Detection | `isAutoMemFile` / `isAutoMemPath`               | `detectSessionFileType` returns `'session_memory'` for `session-memory/*.md`                                               |

SessionMemory uses `runForkedAgent` (same fork primitive) with `FileReadTool` + `FileEditTool` + `buildSessionMemoryUpdatePrompt`, but it's a separate service with its own config (`getSessionMemoryConfig`, `DEFAULT_SESSION_MEMORY_CONFIG`) and its own gate (`isSessionMemoryGateEnabled`). It is listed under `isAutoManagedMemoryFile` (for collapse/badge UI) but has no relationship to the memdir recall/extract/dream pipeline.

**For the Roo port**: ignore SessionMemory for the memdir port — it's a compaction aid, not durable memory. But be aware it exists so you don't confuse the two when grepping the codebase.

---

## 21. Corrected/Refined Facts from Round 1

A few Round-1 statements are sharpened or corrected by the second pass:

1. **§4.3 `loadMemoryPrompt` dispatcher** — Round 1 showed a simplified 2-branch version. The real dispatcher has **4** branches: KAIROS daily-log (precedence), TEAMMEM combined, auto-only, and `null`+telemetry. It also threads `CLAUDE_COWORK_MEMORY_EXTRA_GUIDELINES` into all builders and reads `tengu_moth_copse` for `skipIndex`. See [§13.2](#132-runtime-growthbook-flags) and [§15.6](#156-the-kairosteammem-precedence).

2. **§5 `MEMORY.md` injection** — Round 1 implied the index is always injected. Under `tengu_moth_copse`, `filterInjectedMemoryFiles` ([`utils/claudemd.ts:1142`](utils/claudemd.ts:1142)) **removes** `AutoMem` and `TeamMem` entries from the injected set — the recall prefetch replaces the index. This is the "recall vs index" tradeoff flag.

3. **§6.2 Rank** — Round 1 said "JSON mode." Precisely it's **JSON-schema-constrained output** via `output_format: { type: 'json_schema', schema: {...} }` with the `STRUCTURED_OUTPUTS_BETA_HEADER` beta — stronger than plain JSON mode. See [§18.1](#181-sidequery--utilssidequeryts).

4. **§7.3 run loop** — Round 1 listed state vars but not the **trailing-run state machine** (`pendingContext` stash + `isTrailingRun` skip-throttle) or the cursor-not-found fallback (count all, never 0). See [§17](#17-extractmemories--run-loop--state-machine).

5. **§8 autoDream gates** — Round 1 said "≥24h + ≥5 sessions." Add: the **scan throttle** (10 min) between time-gate-pass and session-gate-check, the 1-hour `HOLDER_STALE_MS` PID-reuse guard, and that the lock file's **mtime IS `lastConsolidatedAt`** (not a separate timestamp). See [§16](#16-autodream--lock--scheduling-internals).

6. **§9 Tool Integration** — Round 1 mentioned the write carve-out. Add: the carve-out is **skipped** for `CLAUDE_COWORK_MEMORY_PATH_OVERRIDE` paths (`hasAutoMemPathOverride()` gate), and there's a **separate read carve-out** that doesn't check the override. The secret guard runs in `FileWriteTool`/`FileEditTool` `validateInput` **before** permission rules. See [§19](#19-filesystem--tool-integration-hooks).

7. **§10 Team Memory** — Round 1 said "HTTP sync... deletions don't propagate." Add the **delta-push** detail (only keys whose `sha256` differs), the `?view=hashes` cheap-refresh endpoint for 412 conflict resolution, the per-entry 250KB + per-PUT 200KB caps with batch-splitting, the server-learned `serverMaxEntries` (no client cap), and the permanent-failure suppression in the watcher (167K-event BQ). See [§15](#15-team-memory-internals--deep-dive).

8. **"Defer for the Roo port" items** — Round 1 deferred KAIROS and SessionMemory. KAIROS is genuinely niche (perpetual assistant sessions); SessionMemory is a **different system** (single-conversation compaction aid) and should be explicitly excluded from the memdir port, not just deferred. See [§20](#20-kairos-daily-log-mode--the-sessionmemory-distinction).

9. **Feature-flag defaults** — Round 1's "What to drop for Roo" listed `feature()` flags abstractly. The concrete map is in [§13](#13-feature-flags--build-gates--complete-map): `EXTRACT_MEMORIES`, `TEAMMEM`, `KAIROS` (compile-time) and 7 `tengu_*` GrowthBook flags (runtime). For Roo, map the `tengu_*` flags to settings keys and the `feature()` flags to static `true`/`false` or the `experiments` map.

---

# Round-Trip 3 — Primitive-Level Deep Dive (gap-filling)

> The sections below were added in a third analysis pass. Rounds 1 and 2 described the subsystems at the _flow_ level but left several load-bearing primitives unquoted: the fork primitive shared by both background writers, the exact recall-pipeline code (incl. a notable dedup bug-fix), the `MemorySavedMessage` shape + its UI rendering, the "searching past context" grep recipes, the full lock/session-counter code, the Bash memory-detection heuristic, and the entire **agent-memory** subsystem (a third, separate memory store that Rounds 1–2 only mentioned in passing). Where a Round-2 statement is corrected, see [§29](#29-correctedrefined-facts-from-round-2).

---

## 22. `runForkedAgent` & `CacheSafeParams` — the shared fork primitive

Source: [`utils/forkedAgent.ts`](utils/forkedAgent.ts:1). Both background writers ([`extractMemories`](services/extractMemories/extractMemories.ts:1), [`autoDream`](services/autoDream/autoDream.ts:1)) and SessionMemory all fork through the _same_ primitive. Understanding it is a prerequisite for porting either writer.

### 22.1 `CacheSafeParams` — the cache-sharing contract

The Anthropic API prompt-cache key is composed of system prompt + tools + model + message prefix + thinking config. A fork that wants to **share the parent's prompt cache** must keep all five identical. [`CacheSafeParams`](utils/forkedAgent.ts:57) carries the first five; thinking config is inherited from [`toolUseContext.options.thinkingConfig`](utils/forkedAgent.ts:65):

```typescript
export type CacheSafeParams = {
	systemPrompt: SystemPrompt // must match parent for cache hits
	userContext: { [k: string]: string } // prepended to messages, affects cache
	systemContext: { [k: string]: string } // appended to system prompt, affects cache
	toolUseContext: ToolUseContext // tools, model, options
	forkContextMessages: Message[] // parent prefix for cache sharing
}
```

There is also a module-level slot [`lastCacheSafeParams`](utils/forkedAgent.ts:73), written by `handleStopHooks` after each turn, so post-turn forks (prompt suggestion, post-turn summary, `/btw`) can share the main loop's cache without each caller threading params. [`createCacheSafeParams(context)`](utils/forkedAgent.ts:131) builds it from a `REPLHookContext` (the post-sampling hook context).

### 22.2 `ForkedAgentParams` — the call signature

```typescript
export type ForkedAgentParams = {
	promptMessages: Message[] // messages to start the fork with
	cacheSafeParams: CacheSafeParams
	canUseTool: CanUseToolFn // permission gate (the sandbox)
	querySource: QuerySource // e.g. 'extract_memories', 'auto_dream'
	forkLabel: string // analytics label
	overrides?: SubagentContextOverrides
	maxOutputTokens?: number // CAUTION: changes budget_tokens → busts cache
	maxTurns?: number // cap on API round-trips
	onMessage?: (message: Message) => void // streaming callback (UI progress)
	skipTranscript?: boolean // skip sidechain transcript I/O
	skipCacheWrite?: boolean // don't write new cache entries on last msg
}

export type ForkedAgentResult = {
	messages: Message[] // all messages yielded
	totalUsage: NonNullableUsage // accumulated tokens across all calls
}
```

### 22.3 Two non-obvious constraints quoted from the source

- **[`skipTranscript: true`](utils/forkedAgent.ts:109)** — both memory writers set this. The comment in [`extractMemories.ts:421`](services/extractMemories/extractMemories.ts:421) is explicit: _"The extractMemories subagent does not need to record to transcript. Doing so can create race conditions with the main thread."_ When set, [`agentId`](utils/forkedAgent.ts:528) is `undefined` and all transcript I/O is skipped.
- **`maxOutputTokens` busts the cache** ([`forkedAgent.ts:96`](utils/forkedAgent.ts:96)): setting it changes `max_tokens` **and** `budget_tokens` (via clamping in [`api/claude.ts`](api/claude.ts:1)). Thinking config is part of the cache key, so a different `budget_tokens` invalidates the cache. Memory writers **never** set it — they rely on cache hits. `skipCacheWrite` is the opposite axis: it skips _writing_ new cache entries (fine for fire-and-forget forks where no future request reads the prefix).

### 22.4 The "why the sandbox must allow REPL" note

[`createAutoMemCanUseTool()`](services/extractMemories/extractMemories.ts:171) allows `REPL_TOOL_NAME` unconditionally. The comment ([`:173`](services/extractMemories/extractMemories.ts:173)) explains why: under ant-default REPL mode, primitive tools are hidden and the fork calls REPL instead. REPL's VM context **re-invokes** the same `canUseTool` for each inner primitive, so the Read/Bash/Edit/Write checks still gate the real operations. Crucially, _"giving the fork a different tool list would break prompt cache sharing — tools are part of the cache key."_

**For the Roo port**: Roo has no `runForkedAgent` equivalent — its `Task` class spawns sub-tasks but doesn't share a parent prompt cache. For the port you have two options: (a) run extract/dream as a fresh `Task` with a short system prompt (no cache sharing — simpler, costs a few extra KB of cache-miss on each run), or (b) add a cache-sharing fork primitive to Roo's API layer that reuses the parent's `systemPrompt` + `tools` + message prefix. Option (a) is fine for an MVP since these run in the background and aren't latency-critical.

---

## 23. Recall Pipeline — complete code

Round 2 quoted [`findRelevantMemories`](memdir/findRelevantMemories.ts:1) and sketched the prefetch handle. The surrounding config, the orchestrator, the dedup, and the consume point were paraphrased. Here is the actual code with the load-bearing comments.

### 23.1 The caps — [`utils/attachments.ts`](utils/attachments.ts:269)

```typescript
const MAX_MEMORY_LINES = 200
// Line cap alone doesn't bound size (200 × 500-char lines = 100KB).  The
// surfacer injects up to 5 files per turn via <system-reminder>, bypassing
// the per-message tool-result budget, so a tight per-file byte cap keeps
// aggregate injection bounded (5 × 4KB = 20KB/turn).  Enforced via
// readFileInRange's truncateOnByteLimit option.  Truncation means the
// most-relevant memory still surfaces: the frontmatter + opening context
// is usually what matters.
const MAX_MEMORY_BYTES = 4096

export const RELEVANT_MEMORIES_CONFIG = {
	// Per-turn cap (5 × 4KB = 20KB) bounds a single injection, but over a
	// long session the selector keeps surfacing distinct files — ~26K tokens/
	// session observed in prod.  Cap the cumulative bytes: once hit, stop
	// prefetching entirely.  Budget is ~3 full injections; after that the
	// most-relevant memories are already in context.  Scanning messages
	// (rather than tracking in toolUseContext) means compact naturally
	// resets the counter — old attachments are gone from context, so
	// re-surfacing is valid.
	MAX_SESSION_BYTES: 60 * 1024,
} as const
```

Three distinct caps, often confused: `MAX_MEMORY_LINES`/`MAX_MEMORY_BYTES` are **per-file** (used in [`readMemoriesForSurfacing`](utils/attachments.ts:2279)); `MAX_SESSION_BYTES` (60 KB) is the **cumulative** throttle across the whole session (used in [`startRelevantMemoryPrefetch`](utils/attachments.ts:2384)). The "5" is enforced by `.slice(0, 5)` in the orchestrator (below), not a config constant.

### 23.2 The orchestrator — [`getRelevantMemoryAttachments()`](utils/attachments.ts:2196)

This is the function the prefetch promise resolves to. It contains a gap Round 2 didn't mention: **agent-mention isolation**.

```typescript
async function getRelevantMemoryAttachments(
	input: string,
	agents: AgentDefinition[],
	readFileState: FileStateCache,
	recentTools: readonly string[],
	signal: AbortSignal,
	alreadySurfaced: ReadonlySet<string>,
): Promise<Attachment[]> {
	// If an agent is @-mentioned, search only its memory dir (isolation).
	// Otherwise search the auto-memory dir.
	const memoryDirs = extractAgentMentions(input).flatMap((mention) => {
		const agentType = mention.replace("agent-", "")
		const agentDef = agents.find((def) => def.agentType === agentType)
		return agentDef?.memory ? [getAgentMemoryDir(agentType, agentDef.memory)] : []
	})
	const dirs = memoryDirs.length > 0 ? memoryDirs : [getAutoMemPath()]

	const allResults = await Promise.all(
		dirs.map((dir) => findRelevantMemories(input, dir, signal, recentTools, alreadySurfaced).catch(() => [])),
	)
	// alreadySurfaced is filtered inside the selector so Sonnet spends its
	// 5-slot budget on fresh candidates; readFileState catches files the
	// model read via FileReadTool. The redundant alreadySurfaced check here
	// is a belt-and-suspenders guard (multi-dir results may re-introduce a
	// path the selector filtered in a different dir).
	const selected = allResults
		.flat()
		.filter((m) => !readFileState.has(m.path) && !alreadySurfaced.has(m.path))
		.slice(0, 5)

	const memories = await readMemoriesForSurfacing(selected, signal)
	if (memories.length === 0) return []
	return [{ type: "relevant_memories" as const, memories }]
}
```

So when the user writes `@agent-debug fix this`, recall searches **only** that agent's memory dir ([`getAgentMemoryDir`](tools/AgentTool/agentMemory.ts:52)), not the main auto-mem dir. With no mention, it searches auto-mem. The `Promise.all` over `dirs` means a multi-agent mention searches all their dirs in parallel and merges.

### 23.3 The prefetch handle + disposable telemetry — [`startRelevantMemoryPrefetch()`](utils/attachments.ts:2361)

```typescript
export function startRelevantMemoryPrefetch(
	messages: ReadonlyArray<Message>,
	toolUseContext: ToolUseContext,
): MemoryPrefetch | undefined {
	if (!isAutoMemoryEnabled() || !getFeatureValue_CACHED_MAY_BE_STALE("tengu_moth_copse", false)) {
		return undefined
	}
	const lastUserMessage = messages.findLast((m) => m.type === "user" && !m.isMeta)
	if (!lastUserMessage) return undefined
	const input = getUserMessageText(lastUserMessage)
	// Single-word prompts lack enough context for meaningful term extraction
	if (!input || !/\s/.test(input.trim())) return undefined

	const surfaced = collectSurfacedMemories(messages)
	if (surfaced.totalBytes >= RELEVANT_MEMORIES_CONFIG.MAX_SESSION_BYTES) return undefined

	// Chained to the turn-level abort so user Escape cancels the sideQuery
	// immediately, not just on [Symbol.dispose] when queryLoop exits.
	const controller = createChildAbortController(toolUseContext.abortController)
	const firedAt = Date.now()
	const promise = getRelevantMemoryAttachments(
		input,
		toolUseContext.options.agentDefinitions.activeAgents,
		toolUseContext.readFileState,
		collectRecentSuccessfulTools(messages, lastUserMessage),
		controller.signal,
		surfaced.paths,
	).catch((e) => {
		if (!isAbortError(e)) logError(e)
		return []
	})

	const handle: MemoryPrefetch = {
		promise,
		settledAt: null,
		consumedOnIteration: -1,
		[Symbol.dispose]() {
			controller.abort()
			logEvent("tengu_memdir_prefetch_collected", {
				hidden_by_first_iteration: handle.settledAt !== null && handle.consumedOnIteration === 0,
				consumed_on_iteration: handle.consumedOnIteration,
				latency_ms: (handle.settledAt ?? Date.now()) - firedAt,
			})
		},
	}
	void promise.finally(() => {
		handle.settledAt = Date.now()
	})
	return handle
}
```

Notable: the `/\s/.test(input.trim())` guard skips single-word prompts (no term-extraction signal); the abort is **double-chained** (turn-level `abortController` via `createChildAbortController` _and_ `[Symbol.dispose]`) so Escape cancels immediately; the disposable telemetry records `hidden_by_first_iteration` (prefetch settled before the first loop iteration — the ideal case, since the memory is available for the model's first tool decision).

### 23.4 The dedup with the load-bearing ordering — [`filterDuplicateMemoryAttachments()`](utils/attachments.ts:2520)

```typescript
/**
 * Filters prefetched memory attachments to exclude memories the model already
 * has in context via FileRead/Write/Edit tool calls (any iteration this turn)
 * or a previous turn's memory surfacing — both tracked in the cumulative
 * readFileState. Survivors are then marked in readFileState so subsequent
 * turns won't re-surface them.
 *
 * The mark-after-filter ordering is load-bearing: readMemoriesForSurfacing
 * used to write to readFileState during the prefetch, which meant the filter
 * saw every prefetch-selected path as "already in context" and dropped them
 * all (self-referential filter). Deferring the write to here, after the
 * filter runs, breaks that cycle while still deduping against tool calls
 * from any iteration.
 */
export function filterDuplicateMemoryAttachments(
	attachments: Attachment[],
	readFileState: FileStateCache,
): Attachment[] {
	return attachments
		.map((attachment) => {
			if (attachment.type !== "relevant_memories") return attachment
			const filtered = attachment.memories.filter((m) => !readFileState.has(m.path))
			for (const m of filtered) {
				readFileState.set(m.path, {
					content: m.content,
					timestamp: m.mtimeMs,
					offset: undefined,
					limit: m.limit,
				})
			}
			return filtered.length > 0 ? { ...attachment, memories: filtered } : null
		})
		.filter((a): a is Attachment => a !== null)
}
```

The **mark-after-filter** ordering is a real bug-fix documented in the comment: an earlier version wrote to `readFileState` inside `readMemoriesForSurfacing` (during the prefetch), which made the filter see every selected path as "already in context" and drop everything. Port this exactly — the ordering matters.

### 23.5 The consume point — [`query.ts:1599`](query.ts:1599)

```typescript
// Memory prefetch consume: only if settled and not already consumed on
// an earlier iteration. If not settled yet, skip (zero-wait) and retry
// next iteration — the prefetch gets as many chances as there are loop
// iterations before the turn ends. readFileState (cumulative across
// iterations) filters out memories the model already Read/Wrote/Edited
// — including in earlier iterations, which the per-iteration
// toolUseBlocks array would miss.
if (
	pendingMemoryPrefetch &&
	pendingMemoryPrefetch.settledAt !== null &&
	pendingMemoryPrefetch.consumedOnIteration === -1
) {
	const memoryAttachments = filterDuplicateMemoryAttachments(
		await pendingMemoryPrefetch.promise, // already settled → instant
		toolUseContext.readFileState,
	)
	for (const memAttachment of memoryAttachments) {
		const msg = createAttachmentMessage(memAttachment)
		yield msg
		toolResults.push(msg)
	}
	pendingMemoryPrefetch.consumedOnIteration = turnCount - 1
}
```

The `await` is **non-blocking** because `settledAt !== null` guarantees the promise already resolved. The `consumedOnIteration = turnCount - 1` records _which_ iteration consumed it (for the `hidden_by_first_iteration` telemetry — `0` means the very first iteration, the ideal).

### 23.6 `collectRecentSuccessfulTools()` — full code

```typescript
export function collectRecentSuccessfulTools(
	messages: ReadonlyArray<Message>,
	lastUserMessage: Message,
): readonly string[] {
	const useIdToName = new Map<string, string>()
	const resultByUseId = new Map<string, boolean>()
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i]
		if (!m) continue
		if (isHumanTurn(m) && m !== lastUserMessage) break // stop at prev human turn
		if (m.type === "assistant" && typeof m.message.content !== "string") {
			for (const block of m.message.content) {
				if (block.type === "tool_use") useIdToName.set(block.id, block.name)
			}
		} else if (m.type === "user" && "message" in m && Array.isArray(m.message.content)) {
			for (const block of m.message.content) {
				if (isToolResultBlock(block)) {
					resultByUseId.set(block.tool_use_id, block.is_error === true)
				}
			}
		}
	}
	const failed = new Set<string>()
	const succeeded = new Set<string>()
	for (const [id, name] of useIdToName) {
		const errored = resultByUseId.get(id)
		if (errored === undefined) continue // no result yet → outcome unknown → exclude
		if (errored) failed.add(name)
		else succeeded.add(name)
	}
	return [...succeeded].filter((t) => !failed.has(t)) // any error → tool excluded
}
```

The "**any error → excluded**" rule (a tool that errored even once is _not_ suppressed — the model may be struggling, so docs stay available) and the "**no result yet → excluded**" rule (outcome unknown) are both in the JSDoc and worth porting verbatim.

---

## 24. `MemorySavedMessage` + UI rendering

Round 2 said extract "appends a `MemorySavedMessage`" and dream "emits an 'Improved N memories' system message." The actual shape and rendering:

### 24.1 The message shape — [`createMemorySavedMessage()`](utils/messages.ts:4460)

```typescript
export function createMemorySavedMessage(writtenPaths: string[]): SystemMemorySavedMessage {
	return {
		type: "system",
		subtype: "memory_saved",
		writtenPaths,
		timestamp: new Date().toISOString(),
		uuid: randomUUID(),
		isMeta: false,
	}
}
```

Both writers post-process this base shape:

- [`extractMemories`](services/extractMemories/extractMemories.ts:491) sets `msg.teamCount = teamCount` (when TEAMMEM) before appending.
- [`autoDream`](services/autoDream/autoDream.ts:244) spreads it with `verb: 'Improved'`:
    ```typescript
    appendSystemMessage({ ...createMemorySavedMessage(dreamState.filesTouched), verb: "Improved" })
    ```

So the full type is `{ type, subtype: 'memory_saved', writtenPaths, timestamp, uuid, isMeta, verb?, teamCount? }`. `verb` defaults to `"Saved"` in the UI; `teamCount` is the team-scoped subset count.

### 24.2 The "memoryPaths vs writtenPaths" distinction

[`extractMemories.ts:465`](services/extractMemories/extractMemories.ts:465) filters `MEMORY.md` out of the reported paths:

```typescript
// Index file updates are mechanical — the agent touches MEMORY.md to add
// a topic link, but the user-visible "memory" is the topic file itself.
const memoryPaths = writtenPaths.filter((p) => basename(p) !== ENTRYPOINT_NAME)
```

So `writtenPaths` (all files the fork wrote, incl. `MEMORY.md`) is split from `memoryPaths` (topic files only). The saved-message uses **`memoryPaths`** (topic files only), so the count shown to the user reflects actual memories, not index touches. `autoDream` uses `dreamState.filesTouched` (collected by the progress watcher from Edit/Write `file_path`s) — which may include `MEMORY.md`; the dream prompt explicitly re-indexes, so an `Improved` count including the index is acceptable.

### 24.3 The UI rendering — [`MemorySavedMessage`](components/messages/SystemTextMessage.tsx:594)

The transpiled component (React Compiler memoized) renders:

```typescript
function MemorySavedMessage({ message, addMargin }) {
  const bg = useSelectedMessageBg()
  const { writtenPaths } = message
  const team = feature('TEAMMEM') ? teamMemSavedPart(message) : null
  const privateCount = writtenPaths.length - (team?.count ?? 0)
  const privatePart = privateCount > 0 ? `${privateCount} ${privateCount === 1 ? 'memory' : 'memories'}` : null
  const parts = [privatePart, team?.segment].filter(Boolean)
  const verb = message.verb ?? 'Saved'
  // renders: ● {verb} {parts.join(' · ')}
  //   e.g. "● Saved 2 memories"
  //   e.g. "● Saved 1 memory · 3 team memories"
  //   e.g. "● Improved 4 memories"
  return <Box ...>{verb} {parts.join(' · ')}</Box> + writtenPaths.map(p => <MemoryFileRow path={p} />)
}
```

Where [`teamMemSavedPart()`](components/messages/teamMemSaved.ts:10) returns `{ segment: '3 team memories', count: 3 }` or `null` (only loaded when `feature('TEAMMEM')`). The `privateCount = writtenPaths.length - teamCount` derivation is why the team count is threaded separately — the UI subtracts it to avoid double-counting.

**For the Roo port**: a simple "Saved N memories" system message is sufficient; the verb/team/private split is a Claude Code UI nicety. But the `writtenPaths` → render-file-rows pattern (each saved memory shown as a clickable path) is worth keeping — it makes the background save visible and auditable.

---

## 25. `buildSearchingPastContextSection` — the grep recipes

Source: [`memdir/memdir.ts:375`](memdir/memdir.ts:375). Round 2 mentioned this section exists (gated on `tengu_coral_fern`) but didn't quote it. The notable detail is the **embedded-vs-tool mode switch**:

````typescript
export function buildSearchingPastContextSection(autoMemDir: string): string[] {
	if (!getFeatureValue_CACHED_MAY_BE_STALE("tengu_coral_fern", false)) return []
	const projectDir = getProjectDir(getOriginalCwd())
	// Ant-native builds alias grep to embedded ugrep and remove the dedicated
	// Grep tool, so give the model a real shell invocation there.
	// In REPL mode, both Grep and Bash are hidden from direct use — the model
	// calls them from inside REPL scripts, so the grep shell form is what it
	// will write in the script anyway.
	const embedded = hasEmbeddedSearchTools() || isReplModeEnabled()
	const memSearch = embedded
		? `grep -rn "<search term>" ${autoMemDir} --include="*.md"`
		: `${GREP_TOOL_NAME} with pattern="<search term>" path="${autoMemDir}" glob="*.md"`
	const transcriptSearch = embedded
		? `grep -rn "<search term>" ${projectDir}/ --include="*.jsonl"`
		: `${GREP_TOOL_NAME} with pattern="<search term>" path="${projectDir}/" glob="*.jsonl"`
	return [
		"## Searching past context",
		"",
		"When looking for past context:",
		"1. Search topic files in your memory directory:",
		"```",
		memSearch,
		"```",
		"2. Session transcript logs (last resort — large files, slow):",
		"```",
		transcriptSearch,
		"```",
		"Use narrow search terms (error messages, file paths, function names) rather than broad keywords.",
		"",
	]
}
````

This section is appended to **both** `buildMemoryLines` (the main prompt, [`:263`](memdir/memdir.ts:263)) and the KAIROS daily-log prompt ([`:366`](memdir/memdir.ts:366)). The transcripts live at `getProjectDir(getOriginalCwd())` — the same dir `autoDream`'s session counter scans (see [§26](#26-session-counting--lock-internals--full-code)).

**For the Roo port**: Roo always has `search_files`, so always emit the tool form (`search_files` with `pattern=... path=...`). Drop the embedded-shell branch entirely.

---

## 26. Session counting & lock internals — full code

Source: [`services/autoDream/consolidationLock.ts`](services/autoDream/consolidationLock.ts:1). Round 2 described the lock-as-timestamp design; here is the verbatim code.

### 26.1 The lock file

```typescript
const LOCK_FILE = ".consolidate-lock"
// Stale past this even if the PID is live (PID reuse guard).
const HOLDER_STALE_MS = 60 * 60 * 1000 // 1 hour

function lockPath(): string {
	return join(getAutoMemPath(), LOCK_FILE)
}

/** mtime of the lock file = lastConsolidatedAt. 0 if absent. Per-turn cost: one stat. */
export async function readLastConsolidatedAt(): Promise<number> {
	try {
		return (await stat(lockPath())).mtimeMs
	} catch {
		return 0
	}
}
```

### 26.2 Acquire with race guard

```typescript
export async function tryAcquireConsolidationLock(): Promise<number | null> {
	const path = lockPath()
	let mtimeMs: number | undefined
	let holderPid: number | undefined
	try {
		const [s, raw] = await Promise.all([stat(path), readFile(path, "utf8")])
		mtimeMs = s.mtimeMs
		const parsed = parseInt(raw.trim(), 10)
		holderPid = Number.isFinite(parsed) ? parsed : undefined
	} catch {
		/* ENOENT — no prior lock */
	}

	if (mtimeMs !== undefined && Date.now() - mtimeMs < HOLDER_STALE_MS) {
		if (holderPid !== undefined && isProcessRunning(holderPid)) {
			return null // held by a live PID
		}
		// Dead PID or unparseable body — reclaim.
	}

	await mkdir(getAutoMemPath(), { recursive: true })
	await writeFile(path, String(process.pid))

	// Two reclaimers both write → last wins the PID. Loser bails on re-read.
	let verify: string
	try {
		verify = await readFile(path, "utf8")
	} catch {
		return null
	}
	if (parseInt(verify.trim(), 10) !== process.pid) return null

	return mtimeMs ?? 0 // pre-acquire mtime for rollback
}
```

### 26.3 Rollback (clears the PID body — otherwise our still-running process looks like a holder)

```typescript
export async function rollbackConsolidationLock(priorMtime: number): Promise<void> {
	const path = lockPath()
	try {
		if (priorMtime === 0) {
			await unlink(path)
			return
		} // restore no-file
		await writeFile(path, "") // clear PID body
		const t = priorMtime / 1000 // utimes wants seconds
		await utimes(path, t, t)
	} catch (e) {
		logForDebugging(`[autoDream] rollback failed — next trigger delayed to minHours`)
	}
}
```

### 26.4 Session counter — the cheapest-correct version

```typescript
/**
 * Session IDs with mtime after sinceMs. listCandidates handles UUID
 * validation (excludes agent-*.jsonl) and parallel stat.
 *
 * Uses mtime (sessions TOUCHED since), not birthtime (0 on ext4).
 * Caller excludes the current session. Scans per-cwd transcripts — it's
 * a skip-gate, so undercounting worktree sessions is safe.
 */
export async function listSessionsTouchedSince(sinceMs: number): Promise<string[]> {
	const dir = getProjectDir(getOriginalCwd())
	const candidates = await listCandidates(dir, true)
	return candidates.filter((c) => c.mtime > sinceMs).map((c) => c.sessionId)
}
```

Two design points from the comments worth porting: (1) **mtime not birthtime** — `birthtime` is `0` on ext4, so it's unusable; (2) **it's a skip-gate, undercounting is safe** — the session count only decides _whether_ to dream, so missing worktree sessions (which live under a different cwd) just delays a dream, never causes a wrong one. [`autoDream.ts:165`](services/autoDream/autoDream.ts:165) then excludes the current session (its mtime is always recent) before the `>= minSessions` check.

### 26.5 The scan throttle is the backoff

[`autoDream.ts:54`](services/autoDream/autoDream.ts:54):

```typescript
// Scan throttle: when time-gate passes but session-gate doesn't, the lock
// mtime doesn't advance, so the time-gate keeps passing every turn.
const SESSION_SCAN_INTERVAL_MS = 10 * 60 * 1000 // 10 min
```

Without this, once the time-gate passes, every turn would re-scan the transcript dir (a `readdir` + per-file `stat`). The 10-min throttle caps that cost. On failure, [`rollbackConsolidationLock`](services/autoDream/consolidationLock.ts:91) rewinds the mtime so the time-gate re-passes immediately — and the scan throttle becomes the effective backoff (next attempt ≥ 10 min later).

**For the Roo port**: the lock-as-timestamp trick is elegant but a simple `lastConsolidatedAt` JSON file is fine. Keep the PID-in-body + race-guard re-read + rollback-clears-PID pattern — it correctly handles crashes (dead PID → reclaim) and concurrent processes (race loser bails).

---

## 27. Bash/shell memory detection — `isShellCommandTargetingMemory()`

Source: [`utils/memoryFileDetection.ts:215`](utils/memoryFileDetection.ts:215). Rounds 1–2 mentioned `isAutoMemFile` and `isMemoryDirectory` but not the shell-command heuristic that powers the "recalled N memories" collapse badge for Bash/PowerShell grep commands. This is more intricate than it looks:

```typescript
export function isShellCommandTargetingMemory(command: string): boolean {
	const configDir = getClaudeConfigHomeDir()
	const memoryBase = getMemoryBaseDir()
	const autoMemDir = isAutoMemoryEnabled() ? getAutoMemPath().replace(/[/\\]+$/, "") : ""

	// Quick check: does the command mention the config, memory base, or
	// auto-mem directory? Compare in forward-slash form. On Windows also
	// check the MinGW form (/c/...) since BashTool runs under Git Bash
	// which emits that encoding. On Linux/Mac, configDir is already posix
	// so only one form to check — and crucially, windowsPathToPosixPath
	// is NOT called, so Linux paths like /m/foo aren't misinterpreted as MinGW.
	const commandCmp = toComparable(command)
	const dirs = [configDir, memoryBase, autoMemDir].filter(Boolean)
	const matchesAnyDir = dirs.some((d) => {
		if (commandCmp.includes(toComparable(d))) return true
		if (IS_WINDOWS) return commandCmp.includes(windowsPathToPosixPath(d).toLowerCase())
		return false
	})
	if (!matchesAnyDir) return false

	// Extract absolute path-like tokens. Matches Unix absolute (/foo/bar),
	// Windows drive-letter (C:\foo, C:/foo), and MinGW (/c/foo). Bare
	// backslash tokens (\foo) are intentionally excluded — they appear in
	// regex/grep patterns and would cause false positives after normalization
	// flips backslashes to forward slashes.
	const matches = command.match(/(?:[A-Za-z]:[/\\]|\/)[^\s'"]+/g)
	if (!matches) return false

	for (const match of matches) {
		const cleanPath = match.replace(/[,;|&>]+$/, "") // strip trailing shell metachars
		// On Windows, convert MinGW /c/... → native C:\... at this single point.
		const nativePath = IS_WINDOWS ? posixPathToWindowsPath(cleanPath) : cleanPath
		if (isAutoManagedMemoryFile(nativePath) || isMemoryDirectory(nativePath)) return true
	}
	return false
}
```

Three subtleties a port must get right (or the collapse badge will mis-fire):

1. **MinGW form on Windows only** — Git Bash emits `/c/Users/...`; the conversion happens at this single point so downstream predicates receive native paths. On Linux, `/m/foo` must **not** be treated as MinGW (which is why `windowsPathToPosixPath` is gated on `IS_WINDOWS`).
2. **Bare backslash tokens excluded** — the regex `(?:[A-Za-z]:[/\\]|\/)` requires either a drive-letter prefix or a leading `/`. A token like `\foo` (common in regex/grep patterns) is intentionally _not_ matched, because the later normalization would flip it to `/foo` and false-positive as a memory path.
3. **Trailing-metachar stripping** — `match.replace(/[,;|&>]+$/, '')` strips shell punctuation that can be adjacent to a path (`grep foo /path;`, `cat /path | head`).

The counterpart for Grep/Glob tools (which take a pattern, not a command) is [`isAutoManagedMemoryPattern()`](utils/memoryFileDetection.ts:277), and [`detectSessionPatternType()`](utils/memoryFileDetection.ts:65) handles `*.jsonl` / `session-memory` glob intent.

**For the Roo port**: only needed if you port the collapse-badge UI. The core memory system doesn't depend on it.

---

## 28. Agent-Memory System — full deep dive

Rounds 1–2 mentioned agent-memory in two sentences ([§9](#9-tool-integration-no-dedicated-memory-tool) and [§19.3](#193-agent-memory-injection--toolsagenttoolloadagentsdirts456)). It is a **third, fully-separate memory store** with its own paths, scopes, prompt builder, and recall isolation. Worth a dedicated section because it's easy to conflate with auto-memory.

### 28.1 What it is

[`tools/AgentTool/agentMemory.ts`](tools/AgentTool/agentMemory.ts:1) gives **sub-agents** (defined via frontmatter in `.claude/agents/*.md`) their own persistent memory, independent of the main auto-mem dir. An agent opts in by setting `memory: user|project|local` in its frontmatter ([`loadAgentsDir.ts:92`](tools/AgentTool/loadAgentsDir.ts:92)).

### 28.2 Three scopes with distinct storage locations

```typescript
export type AgentMemoryScope = "user" | "project" | "local"

export function getAgentMemoryDir(agentType: string, scope: AgentMemoryScope): string {
	const dirName = sanitizeAgentTypeForPath(agentType) // colons → dashes (plugin namespaces)
	switch (scope) {
		case "project":
			return join(getCwd(), ".claude", "agent-memory", dirName) + sep
		case "local":
			return getLocalAgentMemoryDir(dirName)
		case "user":
			return join(getMemoryBaseDir(), "agent-memory", dirName) + sep
	}
}
```

| Scope     | Location                                                          | Checked into VCS?          | Use case                              |
| --------- | ----------------------------------------------------------------- | -------------------------- | ------------------------------------- |
| `user`    | `<memoryBase>/agent-memory/<agentType>/`                          | No                         | General learnings across all projects |
| `project` | `<cwd>/.claude/agent-memory/<agentType>/`                         | **Yes** (shared with team) | Project-specific, version-controlled  |
| `local`   | `<cwd>/.claude/agent-memory-local/<agentType>/` (or remote mount) | No                         | Project + machine specific            |

[`getLocalAgentMemoryDir()`](tools/AgentTool/agentMemory.ts:29) redirects to `CLAUDE_CODE_REMOTE_MEMORY_DIR/projects/<sanitizedGitRoot>/agent-memory-local/<agentType>/` when the remote-memory env var is set (so local-scope memory persists in remote mode). `sanitizeAgentTypeForPath` replaces `:` with `-` because plugin-namespaced agent types like `my-plugin:my-agent` are invalid Windows directory names.

### 28.3 Path containment — [`isAgentMemoryPath()`](tools/AgentTool/agentMemory.ts:68)

Checks all three scope locations (user-scope under `memoryBase`, project-scope under `cwd/.claude/agent-memory`, local-scope under `cwd/.claude/agent-memory-local` or the remote mount). Used by [`isAgentMemFile()`](utils/memoryFileDetection.ts:119) (gated on `isAutoMemoryEnabled()`) and [`isMemoryDirectory()`](utils/memoryFileDetection.ts:152) (checks for `/agent-memory/` or `/agent-memory-local/` substring).

### 28.4 Prompt builder — `buildMemoryPrompt()` (distinct from `buildMemoryLines`)

[`loadAgentMemoryPrompt()`](tools/AgentTool/agentMemory.ts:138) calls [`buildMemoryPrompt()`](memdir/memdir.ts:272), **not** `buildMemoryLines`. The difference: `buildMemoryPrompt` **inlines the `MEMORY.md` content** into the prompt (because sub-agents have no `getClaudeMds()` equivalent that walks CLAUDE.md files):

```typescript
export function buildMemoryPrompt(params: { displayName; memoryDir; extraGuidelines? }): string {
	const { displayName, memoryDir, extraGuidelines } = params
	const fs = getFsImplementation()
	const entrypoint = memoryDir + ENTRYPOINT_NAME
	// Read existing memory entrypoint (sync: prompt building is synchronous)
	let entrypointContent = ""
	try {
		entrypointContent = fs.readFileSync(entrypoint, { encoding: "utf-8" })
	} catch {}

	const lines = buildMemoryLines(displayName, memoryDir, extraGuidelines)

	if (entrypointContent.trim()) {
		const t = truncateEntrypointContent(entrypointContent)
		lines.push(`## ${ENTRYPOINT_NAME}`, "", t.content)
	} else {
		lines.push(
			`## ${ENTRYPOINT_NAME}`,
			"",
			`Your ${ENTRYPOINT_NAME} is currently empty. When you save new memories, they will appear here.`,
		)
	}
	return lines.join("\n")
}
```

Note the **synchronous `readFileSync`** — prompt building is synchronous (called from a React render in `AgentDetail.tsx`), so it can't be async. [`loadAgentMemoryPrompt`](tools/AgentTool/agentMemory.ts:165) fires `ensureMemoryDirExists` **fire-and-forget** (`void`): the spawned agent won't Write until after a full API round-trip, by which time `mkdir` has completed; even if not, `FileWriteTool` does its own parent-dir `mkdir`.

### 28.5 Scope-specific guidance text

```typescript
const scopeNote =
	scope === "user"
		? "- Since this memory is user-scope, keep learnings general since they apply across all projects"
		: scope === "project"
			? "- Since this memory is project-scope and shared with your team via version control, tailor your memories to this project"
			: /* local */ "- Since this memory is local-scope (not checked into version control), tailor your memories to this project and machine"
```

This `scopeNote` is passed as an `extraGuidelines` entry (alongside `CLAUDE_COWORK_MEMORY_EXTRA_GUIDELINES` if set).

### 28.6 Tool injection + system-prompt assembly — [`loadAgentsDir.ts:456`](tools/AgentTool/loadAgentsDir.ts:456)

```typescript
// If memory is enabled, inject Write/Edit/Read tools for memory access
if (isAutoMemoryEnabled() && parsed.memory && tools !== undefined) {
	const toolSet = new Set(tools)
	for (const tool of [FILE_WRITE_TOOL_NAME, FILE_EDIT_TOOL_NAME, FILE_READ_TOOL_NAME]) {
		if (!toolSet.has(tool)) tools = [...tools, tool]
	}
}
// ...
getSystemPrompt: () => {
	if (isAutoMemoryEnabled() && parsed.memory) {
		return systemPrompt + "\n\n" + loadAgentMemoryPrompt(name, parsed.memory)
	}
	return systemPrompt
}
```

So an agent with `memory: project` that didn't list `Read`/`Write`/`Edit` in its `tools` frontmatter **gets them injected automatically**. The memory prompt is appended to the agent's own system prompt at `getSystemPrompt()` call time.

### 28.7 Snapshot initialization (user-scope only)

[`loadAgentsDir.ts:257`](tools/AgentTool/loadAgentsDir.ts:257) — for `user`-scope agents, [`checkAgentMemorySnapshot()`](tools/AgentTool/loadAgentsDir.ts:266) checks for a project-shipped snapshot; if no local user-scope memory exists yet, it copies the snapshot in (so a team can ship a pre-seeded agent memory). A newer snapshot logs a debug message (a user-prompt TODO). This is a one-way seed (snapshot → user memory), not ongoing sync — distinct from team-memory's bidirectional HTTP sync.

### 28.8 Recall isolation — the agent-mention switch

As shown in [§23.2](#232-the-orchestrator--getrelevantmemoryattachmentsutilsattachmentsts2196), when the user `@`-mentions an agent, [`getRelevantMemoryAttachments`](utils/attachments.ts:2206) searches **only** that agent's memory dir(s), not the main auto-mem dir. This means an agent's memories are recall-isolated: they surface only when the user explicitly invokes that agent. (The agent's own `getSystemPrompt` always loads its `MEMORY.md` index inline, so the agent itself always sees its memories — isolation applies only to the _main_ agent's recall-prefetch.)

### 28.9 Relationship to the three background writers

| Property                     | auto-memory (memdir)     | agent-memory                                                                                       | team-memory              |
| ---------------------------- | ------------------------ | -------------------------------------------------------------------------------------------------- | ------------------------ |
| Recall prefetch searches it? | Yes (default)            | Yes, **only on @-mention**                                                                         | Yes (combined mode)      |
| `extractMemories` writes it? | Yes                      | **No** (extract is main-agent-only; sub-agents have their own write path via their injected tools) | Yes (combined)           |
| `autoDream` consolidates it? | Yes                      | **No**                                                                                             | Yes (combined)           |
| `MEMORY.md` loaded via       | `claudemd.ts` (injected) | `buildMemoryPrompt` (inlined)                                                                      | `claudemd.ts` (combined) |
| Paths detected by            | `isAutoMemPath`          | `isAgentMemoryPath`                                                                                | `isTeamMemPath`          |

**For the Roo port**: agent-memory is a P2 feature — it's a clean win for custom-mode agents (a "debug" mode that remembers debug patterns per-project). Port the three scopes, `buildMemoryPrompt` (the inline-index variant), and the tool injection. Skip the snapshot-seed initially. The recall isolation (@-mention switch) is optional — without it, agent memories just never surface in the main loop, which is acceptable for a first port.

---

## 29. Corrected/Refined Facts from Round 2

A few Round-2 statements are sharpened by the third pass:

1. **§6.1 caps** — Round 2 quoted `scanMemoryFiles`'s `MAX_MEMORY_FILES = 200` / `FRONTMATTER_MAX_LINES = 30` but didn't surface the **surfacing-side** caps. There are three: `MAX_MEMORY_LINES = 200` and `MAX_MEMORY_BYTES = 4096` (per-file, in [`readMemoriesForSurfacing`](utils/attachments.ts:2279)) and `MAX_SESSION_BYTES = 60 KB` (cumulative, in [`startRelevantMemoryPrefetch`](utils/attachments.ts:2384)). The "5" is a `.slice(0, 5)` in the orchestrator, not a named constant. See [§23.1](#231-the-caps--utilsattachmentsts269).

2. **§6.2 agent-mention isolation** — Round 2 didn't mention that [`getRelevantMemoryAttachments`](utils/attachments.ts:2196) **switches search dir** based on `@agent-` mentions: with a mention, it searches _only_ the mentioned agent's memory dir(s); without, the auto-mem dir. See [§23.2](#232-the-orchestrator--getrelevantmemoryattachmentsutilsattachmentsts2196) and [§28.8](#288-recall-isolation--the-agent-mention-switch).

3. **§6.4 dedup** — Round 2 said `filterDuplicateMemoryAttachments` "checks against the full accumulated `readFileState`." Add the **load-bearing mark-after-filter ordering**: an earlier version wrote to `readFileState` during the prefetch, causing a self-referential filter that dropped everything. The fix deferred the write to _after_ the filter. Port this ordering exactly. See [§23.4](#234-the-dedup-with-the-load-bearing-ordering--filterduplicatememoryattachmentsutilsattachmentsts2520).

4. **§7.5 / §8 "Saved N memories"** — Round 2 called these "a `MemorySavedMessage`." The actual shape is `{ type:'system', subtype:'memory_saved', writtenPaths, timestamp, uuid, isMeta:false, verb?, teamCount? }`. `verb` defaults to `"Saved"`; `autoDream` sets `verb: 'Improved'`. The UI computes `privateCount = writtenPaths.length - teamCount` and renders `"● {verb} {private} · {team}"`. `extractMemories` filters `MEMORY.md` out of `writtenPaths` before building the message (index touches aren't "memories"). See [§24](#24-memorysavedmessage--ui-rendering).

5. **§8.1 `lastConsolidatedAt`** — Round 2 said the lock "lives inside `getAutoMemPath()`." Add: it's named `.consolidate-lock`, the body is the holder's PID, and the 1-hour `HOLDER_STALE_MS` is a **PID-reuse guard** (reclaim even if the PID is live, if the lock is > 1h old). The race guard is a re-read after write (two reclaimers → last-wins-PID → loser bails). See [§26](#26-session-counting--lock-internals--full-code).

6. **§8.2 session gate** — Round 2 said "transcript count with mtime > last ≥ 5." Add: it uses **mtime not birthtime** (birthtime is 0 on ext4), excludes `agent-*.jsonl` via [`listCandidates`](utils/listSessionsImpl.ts:1) UUID validation, excludes the current session, and is explicitly a **skip-gate where undercounting is safe** (worktree sessions under a different cwd are missed, which only delays a dream). See [§26.4](#264-session-counter--the-cheapest-correct-version).

7. **§9 / §19.3 agent-memory** — Round 2's two-sentence mention understated a **third, fully-separate memory store** with three scopes (`user`/`project`/`local`), its own prompt builder ([`buildMemoryPrompt`](memdir/memdir.ts:272), which inlines `MEMORY.md` because sub-agents have no `getClaudeMds`), automatic Read/Write/Edit tool injection, snapshot-seeding for user-scope, and recall isolation via the @-mention switch. It is **not** written by `extractMemories` or consolidated by `autoDream`. See [§28](#28-agent-memory-system--full-deep-dive).

8. **§13.2 `tengu_coral_fern`** — Round 2 said it "adds the 'Searching past context' section." Add: the section has an **embedded-vs-tool mode switch** — ant-native builds (embedded ugrep, no Grep tool) and REPL mode (Grep/Bash hidden) get the shell `grep -rn` form; everyone else gets the `GREP_TOOL_NAME with pattern=...` form. It's appended to _both_ the main prompt and the KAIROS daily-log prompt. See [§25](#25-buildsearchingpastcontextsection--the-grep-recipes).

9. **§17 run loop** — Round 2 showed the state vars and the trailing-run state machine. Add the **exact cursor-not-found fallback**: [`countModelVisibleMessagesSince`](services/extractMemories/extractMemories.ts:82) falls back to counting **all** model-visible messages (never returns 0) if the cursor UUID was removed by compaction — returning 0 would permanently disable extraction. And the throttle (`tengu_bramble_lintel ?? 1`) is **skipped for trailing runs** (already-committed work shouldn't be throttled) and the manifest pre-injection is placed **after** the throttle so skipped turns don't pay the scan cost. See [§17.3](#173-the-runextraction-flow-329servicesextractmemoriesextractmemoriests329) (refined).

10. **`runForkedAgent`** — Rounds 1–2 called it "a perfect fork sharing the parent's prompt cache" without quoting the contract. The cache-sharing requires **five** fields to match (system prompt, userContext, systemContext, toolUseContext, forkContextMessages); `maxOutputTokens` busts the cache by changing `budget_tokens`; `skipTranscript` avoids race conditions with the main thread; and the REPL-allow in the sandbox exists because changing the tool list would also bust the cache. See [§22](#22-runforkedagent--cachesafeparams--the-shared-fork-primitive).

---

# Round-Trip 4 — Final Black-Boxes (session counter internals, DreamTask UI, claudemd cache-invalidation)

> The three primitives below were the last remaining hand-waves. They're not load-bearing for a minimal port but a complete reference needs them: the session counter's filtering rules, the DreamTask UI-progress state machine (and its kill → lock-rollback coupling), and the claudemd cache-invalidation machinery that decides when `MEMORY.md` is re-read.

---

## 30. `listCandidates` — the session-counter primitive

Source: [`utils/listSessionsImpl.ts`](utils/listSessionsImpl.ts:169). Called by [`listSessionsTouchedSince`](services/autoDream/consolidationLock.ts:118) (see [§26.4](#264-session-counter--the-cheapest-correct-version)). Round 3 said it "handles UUID validation (excludes `agent-*.jsonl`) and parallel stat" — that paraphrase was slightly wrong. Here's the actual code:

```typescript
export async function listCandidates(projectDir: string, doStat: boolean, projectPath?: string): Promise<Candidate[]> {
	let names: string[]
	try {
		names = await readdir(projectDir)
	} catch {
		return []
	}

	const results = await Promise.all(
		names.map(async (name): Promise<Candidate | null> => {
			if (!name.endsWith(".jsonl")) return null // .jsonl files only
			const sessionId = validateUuid(name.slice(0, -6)) // strip ".jsonl", validate UUID
			if (!sessionId) return null // non-UUID filenames dropped
			const filePath = join(projectDir, name)
			if (!doStat) return { sessionId, filePath, mtime: 0, projectPath }
			try {
				const s = await stat(filePath)
				return { sessionId, filePath, mtime: s.mtime.getTime(), projectPath }
			} catch {
				return null
			}
		}),
	)
	return results.filter((c): c is Candidate => c !== null)
}
```

### 30.1 Correction to Round 3's "excludes `agent-*.jsonl`"

[`listCandidates`](utils/listSessionsImpl.ts:169) does **NOT** filter by filename prefix — it accepts any `<valid-uuid>.jsonl`. The agent-session exclusion happens one layer up in [`parseSessionInfoFromLite`](utils/listSessionsImpl.ts:79), which returns `null` for sessions whose **first JSONL line** contains `"isSidechain":true`:

```typescript
const firstLine = firstNewline >= 0 ? head.slice(0, firstNewline) : head
if (firstLine.includes('"isSidechain":true') || firstLine.includes('"isSidechain": true')) {
	return null // sidechain (agent) sessions excluded
}
```

But `listSessionsTouchedSince` calls `listCandidates` directly and only does `.filter(c => c.mtime > sinceMs).map(c => c.sessionId)` — **it does not call `parseSessionInfoFromLite`**, so sidechain/agent sessions **are counted** toward `minSessions`. This is fine because it's a skip-gate (overcounting just triggers a dream slightly sooner), but it contradicts the Round 3 paraphrase. The accurate statement: `listCandidates` filters by `.jsonl` extension + valid UUID format only; sidechain exclusion is a separate `parseSessionInfoFromLite` concern that the dream counter bypasses.

### 30.2 Why `doStat` is a parameter

`listCandidates(dir, true)` (the dream call) stats every file for mtime — 1 syscall per file, parallelized via `Promise.all`. `listCandidates(dir, false)` skips stat (mtime=0) for callers that will sort/dedup by content later. The dream path wants mtime, so it passes `true`.

### 30.3 `validateUuid` + `.slice(0, -6)`

The `name.slice(0, -6)` strips the `.jsonl` suffix (6 chars) before UUID validation. [`validateUuid`](utils/sessionStoragePortable.ts:1) (from `sessionStoragePortable.js`, the SDK-portable layer) returns the canonical UUID string or `undefined` for non-UUID filenames — this is what drops stray `.jsonl` files that aren't session transcripts.

**For the Roo port**: Roo's [`TaskHistoryStore`](../Roo-Code/src/core/task-persistence/TaskHistoryStore.ts:1) already enumerates sessions with mtime — use it directly for the dream session counter instead of porting `listCandidates`. Just filter `taskHistory.filter(t => t.lastModified > lastConsolidatedAt).length >= minSessions`.

---

## 31. `DreamTask` — UI progress state machine + kill → lock rollback

Source: [`tasks/DreamTask/DreamTask.ts`](tasks/DreamTask/DreamTask.ts:1). The dream agent runs as a forked sub-agent with `skipTranscript: true` (see [§22](#22-runforkedagent--cachesafeparams--the-shared-fork-primitive)), so it's invisible in the transcript. `DreamTask` makes it visible in the footer pill and the `Shift+Down` background-tasks dialog. It's **pure UI** — the dream agent itself is unchanged.

### 31.1 The state shape

```typescript
export type DreamTurn = { text: string; toolUseCount: number }

// No phase detection — the dream prompt has a 4-stage structure
// (orient/gather/consolidate/prune) but we don't parse it. Just flip from
// 'starting' to 'updating' when the first Edit/Write tool_use lands.
export type DreamPhase = "starting" | "updating"

export type DreamTaskState = TaskStateBase & {
	type: "dream"
	phase: DreamPhase
	sessionsReviewing: number
	/**
	 * Paths observed in Edit/Write tool_use blocks via onMessage. This is an
	 * INCOMPLETE reflection of what the dream agent actually changed — it misses
	 * any bash-mediated writes and only captures the tool calls we pattern-match.
	 * Treat as "at least these were touched", not "only these were touched".
	 */
	filesTouched: string[]
	/** Assistant text responses, tool uses collapsed. Prompt is NOT included. */
	turns: DreamTurn[]
	abortController?: AbortController
	/** Stashed so kill can rewind the lock mtime (same path as fork-failure). */
	priorMtime: number
}
```

The `filesTouched` comment is important: it's collected by [`makeDreamProgressWatcher`](services/autoDream/autoDream.ts:281) from Edit/Write `file_path`s only — **bash-mediated writes are missed**. The "Improved N memories" completion message ([§24.2](#242-the-memorypaths-vs-writtenpaths-distinction)) uses this incomplete list, so the count is a lower bound.

### 31.2 `addDreamTurn` — the progress updater with no-op skip

```typescript
export function addDreamTurn(taskId, turn, touchedPaths, setAppState): void {
	updateTaskState<DreamTaskState>(taskId, setAppState, (task) => {
		const seen = new Set(task.filesTouched)
		const newTouched = touchedPaths.filter((p) => !seen.has(p) && seen.add(p))
		// Skip the update entirely if the turn is empty AND nothing new was
		// touched. Avoids re-rendering on pure no-ops.
		if (turn.text === "" && turn.toolUseCount === 0 && newTouched.length === 0) {
			return task
		}
		return {
			...task,
			phase: newTouched.length > 0 ? "updating" : task.phase, // flip on first write
			filesTouched: newTouched.length > 0 ? [...task.filesTouched, ...newTouched] : task.filesTouched,
			turns: task.turns.slice(-(MAX_TURNS - 1)).concat(turn), // keep last 30 turns
		}
	})
}
```

Three things worth noting: (1) the **phase flip** happens on the first Edit/Write (`'starting'` → `'updating'`), not by parsing the dream's 4-stage prompt; (2) the **no-op skip** avoids React re-renders on empty turns; (3) `MAX_TURNS = 30` caps the live-display buffer (`turns.slice(-(MAX_TURNS - 1)).concat(turn)` keeps the last 30).

### 31.3 `kill` — the lock-rollback coupling

```typescript
export const DreamTask: Task = {
	name: "DreamTask",
	type: "dream",
	async kill(taskId, setAppState) {
		let priorMtime: number | undefined
		updateTaskState<DreamTaskState>(taskId, setAppState, (task) => {
			if (task.status !== "running") return task // already terminal → no-op
			task.abortController?.abort() // cancel the fork
			priorMtime = task.priorMtime // grab for rollback
			return { ...task, status: "killed", endTime: Date.now(), notified: true, abortController: undefined }
		})
		// Rewind the lock mtime so the next session can retry. Same path as the
		// fork-failure catch in autoDream.ts. If updateTaskState was a no-op
		// (already terminal), priorMtime stays undefined and we skip.
		if (priorMtime !== undefined) {
			await rollbackConsolidationLock(priorMtime)
		}
	},
}
```

This is why [`DreamTaskState.priorMtime`](tasks/DreamTask/DreamTask.ts:40) is stashed at registration time: when the user kills a dream from the bg-tasks dialog, `kill` aborts the fork **and** rewinds the lock mtime via the **same** [`rollbackConsolidationLock`](services/autoDream/consolidationLock.ts:91) path as a fork failure. This is why [`autoDream.ts:262`](services/autoDream/autoDream.ts:262) detects `abortController.signal.aborted` in its catch and **returns without double-rollback** — `DreamTask.kill` already did it.

### 31.4 The `notified: true` on completion

[`completeDreamTask`](tasks/DreamTask/DreamTask.ts:106) and [`failDreamTask`](tasks/DreamTask/DreamTask.ts:122) both set `notified: true` immediately. The comment ([`:110`](tasks/DreamTask/DreamTask.ts:110)): _"dream has no model-facing notification path (it's UI-only), and eviction requires terminal + notified. The inline `appendSystemMessage` completion note IS the user surface."_ So the `Improved N memories` system message ([§24](#24-memorysavedmessage--ui-rendering)) is the _only_ user-facing notification; the task registry entry is just the live-progress pill.

**For the Roo port**: optional. Roo's background-task UI is different. If you skip it, the dream still runs — you just lose the live-progress pill and the graceful user-kill path (a killed dream would leave the lock held until the 1-hour `HOLDER_STALE_MS` reclaim). If you port it, the key invariant is: **kill must call `rollbackConsolidationLock(priorMtime)`** so the next session can retry immediately, and the `autoDream` catch must detect `signal.aborted` to avoid double-rollback.

---

## 32. `claudemd.ts` cache-invalidation & `filterInjectedMemoryFiles`

Source: [`utils/claudemd.ts`](utils/claudemd.ts:1). Round 2 ([§5](#5-loading-memorymd-into-the-system-prompt), [§21.2](#21-correctedrefined-facts-from-round-1)) covered _what_ gets injected but not _when the cache is busted_. This matters because `getMemoryFiles` is memoized — without invalidation, a `MEMORY.md` written mid-session wouldn't be seen until restart.

### 32.1 The memoized entry point

```typescript
export const getMemoryFiles = memoize(async (forceIncludeExternal: boolean = false): Promise<MemoryFileInfo[]> => {
	/* walks CLAUDE.md + appends AutoMem/TeamMem */
})
```

`memoize` (lodash) caches by argument. Two invalidation functions control when the cache is cleared.

### 32.2 Two invalidation functions with different semantics

```typescript
// Load reason to report for top-level (non-included) files on the next eager
// getMemoryFiles() pass. Set to 'compact' by resetGetMemoryFilesCache when
// compaction clears the cache, so the InstructionsLoaded hook reports the
// correct reason. Defaults to 'session_start', reset to 'session_start'
// after being read.
let nextEagerLoadReason: InstructionsLoadReason = "session_start"

// true initially (for session_start), consumed after firing, re-enabled only
// by resetGetMemoryFilesCache(). Callers that only need cache invalidation
// for correctness (e.g. worktree enter/exit, settings sync, /memory dialog)
// should use clearMemoryFileCaches() instead to avoid spurious hook fires.
let shouldFireHook = true

/**
 * Clears the getMemoryFiles memoize cache WITHOUT firing the InstructionsLoaded hook.
 * Callers that need the hook to fire (because the invalidation represents
 * instructions actually being reloaded into context, e.g. compaction),
 * should use resetGetMemoryFilesCache() instead.
 */
export function clearMemoryFileCaches(): void {
	getMemoryFiles.cache?.clear?.() // ?.cache because tests spyOn this
}

export function resetGetMemoryFilesCache(reason: InstructionsLoadReason = "session_start"): void {
	nextEagerLoadReason = reason
	shouldFireHook = true
	clearMemoryFileCaches()
}
```

The distinction: [`clearMemoryFileCaches()`](utils/claudemd.ts:1119) is for **correctness-only** invalidation (worktree enter/exit, settings sync, `/memory` dialog edits) — the cache is cleared so the next `getMemoryFiles()` re-reads, but no `InstructionsLoaded` hook fires. [`resetGetMemoryFilesCache(reason)`](utils/claudemd.ts:1124) is for **context-reload** invalidation (compaction) — it sets `nextEagerLoadReason` and re-enables `shouldFireHook` so the next eager pass fires the hook with the correct reason.

### 32.3 The `InstructionsLoadReason` union — [`utils/hooks.ts:4296`](utils/hooks.ts:4296)

```typescript
export type InstructionsLoadReason = "session_start" | "nested_traversal" | "path_glob_match" | "include" | "compact"

export type InstructionsMemoryType = "User" | "Project" | "Local" | "Managed"
```

Note `InstructionsMemoryType` is the **CLAUDE.md** taxonomy (`User`/`Project`/`Local`/`Managed`), **distinct** from the memdir taxonomy (`user`/`feedback`/`project`/`reference` in [`memoryTypes.ts`](memdir/memoryTypes.ts:1)). The two type unions share the name "memory" but refer to different things — don't conflate them when porting.

### 32.4 `filterInjectedMemoryFiles` — the `tengu_moth_copse` switch

```typescript
/**
 * When tengu_moth_copse is on, the findRelevantMemories prefetch surfaces
 * memory files via attachments, so the MEMORY.md index is no longer injected
 * into the system prompt. Callsites that care about "what's actually in
 * context" (context builder, /context viz) should filter through this.
 */
export function filterInjectedMemoryFiles(files: MemoryFileInfo[]): MemoryFileInfo[] {
	const skipMemoryIndex = getFeatureValue_CACHED_MAY_BE_STALE("tengu_moth_copse", false)
	if (!skipMemoryIndex) return files
	return files.filter((f) => f.type !== "AutoMem" && f.type !== "TeamMem")
}
```

This is the "recall replaces index" mode from [§13.2](#132-runtime-growthbook-flags): under `tengu_moth_copse`, both `AutoMem` and `TeamMem` entries are stripped from the injected set because the recall prefetch surfaces them as attachments instead. Callsites that need "what's actually in context" (the context builder, `/context` visualization) must filter through this — otherwise they'd report the index as in-context when it's actually been replaced by recall attachments.

### 32.5 `getClaudeMds` — the joiner with `tengu_paper_halyard`

```typescript
export const getClaudeMds = (memoryFiles: MemoryFileInfo[], filter?: (type: MemoryType) => boolean): string => {
	const memories: string[] = []
	const skipProjectLevel = getFeatureValue_CACHED_MAY_BE_STALE("tengu_paper_halyard", false)

	for (const file of memoryFiles) {
		if (filter && !filter(file.type)) continue
		if (skipProjectLevel && (file.type === "Project" || file.type === "Local")) continue
		if (file.content) {
			const description =
				file.type === "Project"
					? " (project instructions, checked into the codebase)"
					: file.type === "Local"
						? " (user's private project instructions, not checked in)"
						: feature("TEAMMEM") && file.type === "TeamMem"
							? " (shared team memory, synced across the organization)"
							: file.type === "AutoMem"
								? " (user's auto-memory, persists across conversations)"
								: " (user's private global instructions for all projects)"

			const content = file.content.trim()
			if (feature("TEAMMEM") && file.type === "TeamMem") {
				memories.push(
					`Contents of ${file.path}${description}:\n\n<team-memory-content source="shared">\n${content}\n</team-memory-content>`,
				)
			} else {
				memories.push(`Contents of ${file.path}${description}:\n\n${content}`)
			}
		}
	}
	if (memories.length === 0) return ""
	return `${MEMORY_INSTRUCTION_PROMPT}\n\n${memories.join("\n\n")}`
}
```

Two details Round 2 didn't surface: (1) **`tengu_paper_halyard`** skips `Project`/`Local` CLAUDE.md files (the project-level instructions, not memory) — unrelated to memdir but lives in the same joiner; (2) **TeamMem content is wrapped** in `<team-memory-content source="shared">…</team-memory-content>` tags (when TEAMMEM is on), distinguishing it from private memory in the rendered prompt. `AutoMem` content is injected unwrapped with the `"(user's auto-memory, persists across conversations)"` description.

### 32.6 When the cache gets busted (the invalidation call-sites)

The cache must be busted whenever `MEMORY.md` or a CLAUDE.md might have changed on disk without the harness knowing:

| Trigger               | Function                              | Why                                                                                          |
| --------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------- |
| Compaction            | `resetGetMemoryFilesCache('compact')` | Compaction drops old messages; instructions must reload + hook fires with `'compact'` reason |
| Worktree enter/exit   | `clearMemoryFileCaches()`             | Different cwd → different CLAUDE.md set; correctness-only, no hook                           |
| Settings sync         | `clearMemoryFileCaches()`             | Remote-managed settings may change allowed dirs; correctness-only                            |
| `/memory` dialog edit | `clearMemoryFileCaches()`             | User edited a memory file via the dialog; re-read on next prompt build                       |
| Session start         | (initial `shouldFireHook = true`)     | First `getMemoryFiles()` pass fires the hook with `'session_start'`                          |

**For the Roo port**: Roo's prompt is rebuilt per-task (no long-lived memoized `getMemoryFiles`), so cache-invalidation is largely a non-issue — each task re-reads `MEMORY.md` fresh. The one thing to preserve: **the recall-replaces-index switch** ([§32.4](#324-filterinjectedmemoryfiles--the-tengu_moth_copse-switch)) — if you implement recall prefetch, you must _remove_ the `MEMORY.md` index from the system prompt when recall is active, or you double-inject. The `InstructionsLoaded` hook machinery is Roo-extra and can be dropped.

---

# Round-Trip 5 — UI Surface & Roo-Code Integration Re-Verification

> Two final passes: (1) the user-facing memory UI surface (the `/memory` command, the saved-memory rows, the large-file warning, the `/context` viz, the dream status) that Rounds 1–4 treated as "pure UI, skip" — quoted here for completeness since a port needs _some_ user surface; (2) a re-verification of the §11/§12 Roo-Code integration claims against the **live** [`../Roo-Code/`](../Roo-Code/src/core/prompts/system.ts:115) checkout (Round 1's line numbers were never re-checked). All Round-1 paths confirmed real and current; a few refinements noted.

---

## 33. The `/memory` Command — the user-facing control surface

Source: [`commands/memory/memory.tsx`](commands/memory/memory.tsx:1) + [`components/memory/MemoryFileSelector.tsx`](components/memory/MemoryFileSelector.tsx:1). This is the single user-facing entry point for managing memory. Rounds 1–4 didn't cover it.

### 33.1 The command — [`memory.tsx`](commands/memory/memory.tsx:14)

```typescript
function MemoryCommand({ onDone }) {
  const handleSelectMemoryFile = async (memoryPath: string) => {
    // Create claude directory if it doesn't exist (idempotent with recursive)
    if (memoryPath.includes(getClaudeConfigHomeDir())) {
      await mkdir(getClaudeConfigHomeDir(), { recursive: true })
    }
    // Create file if it doesn't exist (wx flag fails if file exists,
    // which we catch to preserve existing content)
    try { await writeFile(memoryPath, '', { encoding: 'utf8', flag: 'wx' }) }
    catch (e) { if (getErrnoCode(e) !== 'EEXIST') throw e }
    await editFileInEditor(memoryPath)
    // ... reports which editor ($VISUAL/$EDITOR) was used
    onDone(`Opened memory file at ${getRelativeMemoryPath(memoryPath)}\n\n${editorHint}`, { display: 'system' })
  }
  return <Dialog title="Memory" onCancel={handleCancel} color="remember">
    <MemoryFileSelector onSelect={handleSelectMemoryFile} onCancel={handleCancel} />
    <Text dimColor>Learn more: <Link url="https://code.claude.com/docs/en/memory" /></Text>
  </Dialog>
}

export const call: LocalJSXCommandCall = async onDone => {
  // Clear + prime before rendering — Suspense handles the unprimed case,
  // but awaiting here avoids a fallback flash on initial open.
  clearMemoryFileCaches()
  await getMemoryFiles()
  return <MemoryCommand onDone={onDone} />
}
```

Three things worth noting: (1) the command calls [`clearMemoryFileCaches()`](utils/claudemd.ts:1119) **then** `await getMemoryFiles()` before rendering — so the selector always shows fresh state (this is one of the cache-invalidation call-sites from [§32.6](#326-when-the-cache-gets-busted-the-invalidation-call-sites)); (2) it uses the `wx` flag to create-if-not-exists without clobbering; (3) it delegates to [`editFileInEditor`](utils/promptEditor.ts:1) (the `$VISUAL`/`$EDITOR` external editor flow).

### 33.2 The selector — [`MemoryFileSelector.tsx`](components/memory/MemoryFileSelector.tsx:44)

The selector lists **all** memory surfaces in one dialog:

- **CLAUDE.md files**: User (`~/.claude/CLAUDE.md`), Project (`./CLAUDE.md`), plus nested `@-imported` files (shown with `L ` tree-indent + "description: @-imported") and dynamically-loaded files ("dynamically loaded"). Missing User/Project files are shown with `(new)` and created on select.
- **Folder openers** (when `isAutoMemoryEnabled()`):
    - "Open auto-memory folder" → [`getAutoMemPath()`](memdir/paths.ts:92)
    - "Open team memory folder" → [`getTeamMemPath()`](memdir/teamMemPaths.ts:1) (TEAMMEM only)
    - "Open **{agentType}** agent memory" → [`getAgentMemoryDir`](tools/AgentTool/agentMemory.ts:52) for each agent with a `memory` field, with "{scope} scope" description
- **Toggles** (in-dialog, write to `userSettings`):
    - `autoMemoryEnabled` → [`updateSettingsForSource("userSettings", { autoMemoryEnabled })`](components/memory/MemoryFileSelector.tsx:207) + `tengu_auto_memory_toggled` event
    - `autoDreamEnabled` → same pattern + `tengu_auto_dream_toggled` event
- **Dream status** (when auto-memory on): reads [`readLastConsolidatedAt()`](services/autoDream/consolidationLock.ts:29) and shows `"running"` (if a dream task is active) / `"never"` (mtime 0) / `"last ran {relativeTime}"`.

So the `/memory` dialog is the **single control surface** for the entire memory system: edit files, open folders, toggle the two background writers, and see dream status. This is the UX a port should replicate.

**For the Roo port**: Roo has no `/memory` equivalent. A VS Code WebView command (`roo.memory`) listing the memory dir + a toggle for `autoMemoryEnabled` is the minimum viable surface. The agent-memory folder-openers and dream-status are P2.

---

## 34. Saved-memory rendering & the large-file warning

### 34.1 `MemoryFileRow` — the clickable path under "Saved N memories"

[`components/messages/SystemTextMessage.tsx:669`](components/messages/SystemTextMessage.tsx:669) (transpiled, React Compiler memoized):

```typescript
function MemoryFileRow({ path }) {
  const [hover, setHover] = useState(false)
  const open = () => void openPath(path)            // opens in OS file manager / editor
  const name = basename(path)
  return <MessageResponse>
    <Box onClick={open} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <Text dimColor={!hover} underline={hover}>
        <FilePathLink filePath={path}>{name}</FilePathLink>
      </Text>
    </Box>
  </MessageResponse>
}
```

So each path in the `MemorySavedMessage` ([§24.3](#243-the-ui-rendering--systemtextmessagets594)) renders as a dimmed, hover-underlined, clickable basename that opens the file. The full path is in the `FilePathLink` (for hover-tooltip/copy).

### 34.2 `MemoryUpdateNotification` — the "Memory updated in {path} · /memory to edit" toast

[`components/memory/MemoryUpdateNotification.tsx:21`](components/memory/MemoryUpdateNotification.tsx:21):

```typescript
export function getRelativeMemoryPath(path: string): string {
  const homeDir = homedir()
  const cwd = getCwd()
  const relativeToHome = path.startsWith(homeDir) ? '~' + path.slice(homeDir.length) : null
  const relativeToCwd = path.startsWith(cwd) ? './' + relative(cwd, path) : null
  // Return the shorter path, or absolute if neither is applicable
  if (relativeToHome && relativeToCwd) {
    return relativeToHome.length <= relativeToCwd.length ? relativeToHome : relativeToCwd
  }
  return relativeToHome || relativeToCwd || path
}

export function MemoryUpdateNotification({ memoryPath }) {
  const displayPath = getRelativeMemoryPath(memoryPath)
  return <Text color="text">Memory updated in {displayPath} · /memory to edit</Text>
}
```

[`getRelativeMemoryPath`](components/memory/MemoryUpdateNotification.tsx:7) is the shared path-shortener (prefers the shorter of `~/...` vs `./...`). This toast is a _separate_ surface from the `MemorySavedMessage` — it fires on direct user-driven memory writes (the main agent writing a topic file), whereas `MemorySavedMessage` fires on background-extract/autoDream saves.

### 34.3 The large-memory-file status notice — [`utils/statusNoticeDefinitions.tsx:31`](utils/statusNoticeDefinitions.tsx:31)

```typescript
const largeMemoryFilesNotice: StatusNoticeDefinition = {
  id: 'large-memory-files',
  type: 'warning',
  isActive: ctx => getLargeMemoryFiles(ctx.memoryFiles).length > 0,
  render: ctx => {
    const largeMemoryFiles = getLargeMemoryFiles(ctx.memoryFiles)
    return <>{largeMemoryFiles.map(file => {
      const displayPath = file.path.startsWith(getCwd()) ? relative(getCwd(), file.path) : file.path
      return <Box flexDirection="row">
        <Text color="warning">{figures.warning}</Text>
        <Text color="warning">
          Large <Text bold>{displayPath}</Text> will impact performance (
          {formatNumber(file.content.length)} chars > {formatNumber(MAX_MEMORY_CHARACTER_COUNT)})
          <Text dimColor> · /memory to edit</Text>
        </Text>
      </Box>
    })}</>
  }
}
```

Where [`MAX_MEMORY_CHARACTER_COUNT = 40000`](utils/claudemd.ts:92) and [`getLargeMemoryFiles`](utils/claudemd.ts:1132) filters `f.content.length > 40000`. This is a **different** cap from the recall-pipeline caps ([§23.1](#231-the-caps--utilsattachmentsts269)) — it's about _injected-index_ size (CLAUDE.md + `MEMORY.md`), not surfaced-memory size. A `MEMORY.md` over 40K chars (well past the 25KB truncation cap in [§4.1](#41-entrypoint-truncation)) triggers a persistent warning banner nudging the user to edit. Note: this checks `ctx.memoryFiles` (the raw, pre-truncation content) so it warns _before_ truncation silently drops content.

### 34.4 `/context` memory viz — [`components/ContextVisualization.tsx:323`](components/ContextVisualization.tsx:323)

```typescript
t12 = memoryFiles.length > 0 && <Box flexDirection="column" marginTop={1}>
  <Box><Text bold>Memory files</Text><Text dimColor> · /memory</Text></Box>
  {memoryFiles.map(/* per-file row with token count */)}
</Box>
```

The `/context` command shows a "Memory files" section listing each loaded memory file with its token count — the audit view for "what's actually in my context." This is where [`filterInjectedMemoryFiles`](utils/claudemd.ts:1142) matters (see [§32.4](#324-filterinjectedmemoryfiles--the-tengu_moth_copse-switch)): under `tengu_moth_copse`, the `AutoMem`/`TeamMem` entries are filtered out here too, so `/context` correctly shows them as _not_ injected (they're surfaced via recall attachments instead).

**For the Roo port**: the `MemoryFileRow` clickable-path pattern and the `getRelativeMemoryPath` shortener are worth keeping (cheap, good UX). The large-file warning is optional but cheap (one `content.length` check). The `/context` viz is Roo-extra.

---

## 35. Roo-Code Integration Points — re-verified against live checkout

Round 1 ([§11](#11-roo-code-integration-points-audited)) "audited" the Roo-Code side but the line numbers/snippets were never re-checked. I verified every claim against the **current** [`../Roo-Code/`](../Roo-Code/src/core/prompts/system.ts:115) checkout (June 2026). **All paths are real and current.** Refinements below.

### 35.1 System prompt assembly — VERIFIED

[`../Roo-Code/src/core/prompts/system.ts`](../Roo-Code/src/core/prompts/system.ts:115): `generatePrompt` at `:42`, `basePrompt` at `:115`. The exact section order Round 1 quoted is **accurate to the line**:

```typescript
const basePrompt = `${roleDefinition}

${markdownFormattingSection()}

${getSharedToolUseSection()}${toolsCatalog}

	${getToolUseGuidelinesSection()}

${getCapabilitiesSection(cwd, hasMcpGroup ? mcpHub : undefined, allowedMcpServers)}
${deferredToolsSection ? `\n${deferredToolsSection}\n` : ""}
${modesSection}
${skillsSection ? `\n${skillsSection}` : ""}
${getRulesSection(cwd, settings)}

${getSystemInfoSection(cwd)}

${getObjectiveSection()}

${await addCustomInstructions(baseInstructions, globalCustomInstructions || "", cwd, mode, {
	language: language ?? formatLanguage(vscode.env.language),
	rooIgnoreInstructions,
	settings,
})}`
```

`getRulesSection` at `:132`, blank line, `getSystemInfoSection` at `:134` — the **exact injection point** Round 1 identified (insert `getMemorySection` between them) is correct.

### 35.2 Sections registry — VERIFIED + refinement

[`../Roo-Code/src/core/prompts/sections/index.ts`](../Roo-Code/src/core/prompts/sections/index.ts:1) exports: `getRulesSection`, `getSystemInfoSection`, `getObjectiveSection`, `addCustomInstructions`, `getSharedToolUseSection`, `getToolUseGuidelinesSection`, `getCapabilitiesSection`, `getModesSection`, `markdownFormattingSection`, `getSkillsSection`, `getDeferredToolsSection`. Adding `export { getMemorySection, getMemoryIndexSection } from "./memory"` is the right move.

**Refinement**: Round 1 said `getObjectiveSection` wasn't in the list — it **is** exported (and used at `system.ts:136`). The section registry is the correct registration point.

### 35.3 Custom-instructions loader — VERIFIED + refinement

[`../Roo-Code/src/core/prompts/sections/custom-instructions.ts`](../Roo-Code/src/core/prompts/sections/custom-instructions.ts:1): uses `getRooDirectoriesForCwd`, `getAllRooDirectoriesForCwd`, `getAgentsDirectoriesForCwd`, `getGlobalRooDirectory` from [`../../../services/roo-config`](../Roo-Code/src/services/roo-config). Reads `.roo/rules/*.md` (with `enableSubfolderRules` toggle for recursive discovery), falls back to `.roorules`/`.clinerules`, plus mode-specific `.roo/rules-${mode}/` and `.roorules-${mode}`/`.clinerules-${mode}`. Uses `safeReadFile` throughout.

**Refinement**: Round 1 said "this is the place to add the `MEMORY.md` read." It's _a_ place, but `addCustomInstructions` is specifically the **mode-specific rules** path — it already takes `(mode, ...)`. A cleaner injection is the dedicated `getMemoryIndexSection` (proposed in [§12.0.5](#step-05--create-srccorepromptssectionsmemoryts)) appended after `addCustomInstructions`, which keeps memory orthogonal to mode rules. Both work; the dedicated section is less coupled.

### 35.4 Tool validation — VERIFIED

[`../Roo-Code/src/core/tools/validateToolUse.ts`](../Roo-Code/src/core/tools/validateToolUse.ts:32): `validateToolUse(toolName, mode, customModes, toolRequirements, toolParams, experiments, includedTools)` signature matches Round 1 exactly. Throws `FileRestrictionError` (imported from [`../../shared/modes`](../Roo-Code/src/shared/modes)) at `:213`/`:221` for `fileRegex` mismatches inside the `isEditOperation` + `doesFileMatchRegex(filePath, options.fileRegex)` check. **The carve-out goes here**: before the `doesFileMatchRegex` call, add `if (isAutoMemPath(filePath)) return` (or `continue`) to bypass the workspace-containment/regex check for memory paths — mirroring Claude Code's [`isAutoMemPath`](memdir/paths.ts:107) carve-out in [`utils/permissions/filesystem.ts`](utils/permissions/filesystem.ts:1572).

Note: Roo's `FileRestrictionError` is thrown for _mode `fileRegex` restrictions_, which is a narrower gate than Claude Code's blanket dangerous-directory check. The memory carve-out still belongs here (it's the edit-operation gate), but Roo may have **additional** containment checks in `WriteToFileTool`/`EditFileTool` themselves — verify those don't also need the carve-out.

### 35.5 Config — VERIFIED

[`../Roo-Code/src/core/config/ContextProxy.ts`](../Roo-Code/src/core/config/ContextProxy.ts:40): `class ContextProxy` at `:40`, `export()` at `:532`. Adding `autoMemoryEnabled` (default `true`) and `autoMemoryDirectory` (trusted sources only) as pass-through state keys is the right approach. `isPassThroughStateKey` at `:32` controls which keys are exported/imported — the new keys should be added there.

### 35.6 Task loop — VERIFIED + concrete hook points

This is the one place Round 1 was hand-wavy ("hook into `TaskLifecycle.ts` completion"). The live checkout gives concrete anchors:

- **Main loop**: [`../Roo-Code/src/core/task/TaskApiLoop.ts:206`](../Roo-Code/src/core/task/TaskApiLoop.ts:206) `while (!this.access.abort)` — Roo's analog of Claude Code's `while(true)` in [`query.ts`](query.ts:1). The recall-prefetch consume point goes at the **top of each iteration** (mirroring [`query.ts:1599`](query.ts:1599)).
- **Per-request abort**: [`TaskApiLoop.ts:93`](../Roo-Code/src/core/task/TaskApiLoop.ts:93) `currentRequestAbortController?: AbortController` — the recall prefetch's `AbortController` chains to this (mirroring Claude Code's [`createChildAbortController(toolUseContext.abortController)`](utils/attachments.ts:2390)).
- **User message**: `TaskApiLoop.ts:114` `userMessageContent` + `:115` `userMessageContentReady` — the prefetch starts when a user message is committed (mirroring [`startRelevantMemoryPrefetch`](utils/attachments.ts:2361) reading `messages.findLast(m => m.type === 'user')`).
- **Completion/abort**: [`../Roo-Code/src/core/task/TaskLifecycle.ts`](../Roo-Code/src/core/task/TaskLifecycle.ts:1) has `dispose()` points (rooIgnoreController, rooProtectedController, fileContextTracker, messageQueueService at `:49-53`) and `abort`/`abortReason` handling (`:60-62`, `:490`). The `extractMemories` fire-and-forget + `drainPendingExtraction` on shutdown attaches here — `dispose` is the drain point, and the `abort === true` branch is where in-flight extractions get cancelled (mirroring Claude Code's [`drainPendingExtraction`](services/extractMemories/extractMemories.ts:611) in [`cli/print.ts:967`](cli/print.ts:967)).
- **Session history** (for autoDream session counter): [`../Roo-Code/src/core/task-persistence/TaskHistoryStore.ts`](../Roo-Code/src/core/task-persistence/TaskHistoryStore.ts:1) — use this directly instead of porting [`listCandidates`](utils/listSessionsImpl.ts:169) (see [§30](#30-listcandidates--the-session-counter-primitive)). Filter `taskHistory.filter(t => t.lastModified > lastConsolidatedAt).length >= minSessions`.

### 35.7 Tool name mapping — VERIFIED unchanged

| Claude Code | Roo-Code                       | Status    |
| ----------- | ------------------------------ | --------- |
| `Read`      | `read_file`                    | unchanged |
| `Write`     | `write_to_file`                | unchanged |
| `Edit`      | `edit_file` / `search_replace` | unchanged |
| `Grep`      | `search_files`                 | unchanged |
| `Glob`      | `list_files`                   | unchanged |
| `Bash`      | `execute_command`              | unchanged |

Round 1's table is still accurate.

### 35.8 Summary

Round 1's §11 audit was **accurate** — every path, function name, and the injection-point identification held up under re-verification against the live checkout. The only refinements: (a) `getObjectiveSection` is exported (Round 1 implied it wasn't); (b) the `MEMORY.md` read is cleaner as a dedicated section than inside `addCustomInstructions`; (c) the Task-loop hook points are now concrete (`TaskApiLoop.ts:206` for the loop, `:93` for abort, `:114` for user message; `TaskLifecycle.ts` `dispose`/`abort` for completion/drain). The §12 porting plan's code skeletons remain valid against the current Roo-Code structure.
