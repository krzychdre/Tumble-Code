# WP-D4: One helper for the MDM redirect after a state push

Status: ready
Effort: S      Risk: low      Depends on: none
Branch name: fix/d4-mdm-redirect-helper      Base: origin/main

## 1. Goal (2-4 sentences, plain words)

`ClineProvider` repeats the same four-line "MDM redirect" block after every state push: when a managed-device
(MDM) policy requires cloud sign-in and the user is not compliant, it posts
`{ type: "action", action: "cloudButtonClicked" }` so the webview opens the account tab. Move the block into one
private method and call it from the four places. What is sent, and in which order, stays exactly the same.

## 2. Why it matters (user-visible effect, 2-4 sentences)

No user-visible change. Four copies of a policy rule means a future change (for example a different tab, or a
rate limit on the redirect) can miss one of them. The WP also adds the first tests for this redirect: today no
spec asserts `cloudButtonClicked` at all (verified: `grep -rln cloudButtonClicked src --include=*.spec.ts` prints
nothing).

## 3. Read these first (exact paths, and the symbol to look for in each)

- `docs/architecture.md`, "Do not touch without a dedicated item": "State delivery to the webview:
  `clineMessagesSeq`, the three `postStateToWebview*` variants". This WP is allowed only because it does not change
  what those methods send (roadmap item D4 says so explicitly).
- `src/core/webview/ClineProvider.ts`:
  - `postStateToWebview` (near line 1463)
  - `postStateToWebviewWithoutTaskHistory` (near line 1488)
  - `postStateToWebviewWithoutClineMessages` (near line 1515)
  - `postClineMessageAdded` (near line 1542) - the fourth copy; it is not a `postStateToWebview*` method but has the
    same block
  - `checkMdmCompliance` (near line 1822)
  - `postMessageToWebview` (near line 1170)
- `src/services/mdm/MdmService.ts`: `requiresCloudAuth`, `isCompliant`.

## 4. Current code (verbatim excerpts, each headed by path and symbol name; line numbers only as a hint "near line N")

`src/core/webview/ClineProvider.ts`, `postStateToWebview` (near line 1463):

```ts
	async postStateToWebview() {
		const state = await this.getStateToPostToWebview({ includeTaskHistory: "whenChanged" })
		this.rememberViewClineMessages(state.clineMessages)
		this.postMessageToWebview({ type: "state", state })

		// Check MDM compliance and send user to account tab if not compliant
		// Only redirect if there's an actual MDM policy requiring authentication
		if (this.mdmService?.requiresCloudAuth() && !this.checkMdmCompliance()) {
			await this.postMessageToWebview({ type: "action", action: "cloudButtonClicked" })
		}
	}
```

`postStateToWebviewWithoutTaskHistory` (near line 1488):

```ts
		this.rememberViewClineMessages(rest.clineMessages)
		this.postMessageToWebview({ type: "state", state: rest })

		// Preserve existing MDM redirect behavior
		if (this.mdmService?.requiresCloudAuth() && !this.checkMdmCompliance()) {
			await this.postMessageToWebview({ type: "action", action: "cloudButtonClicked" })
		}
	}
```

`postStateToWebviewWithoutClineMessages` (near line 1515):

```ts
		const { clineMessages: _omitMessages, clineMessagesSeq: _omitSeq, taskHistory: _omitHistory, ...rest } = state
		this.postMessageToWebview({ type: "state", state: rest })

		// Preserve existing MDM redirect behavior
		if (this.mdmService?.requiresCloudAuth() && !this.checkMdmCompliance()) {
			await this.postMessageToWebview({ type: "action", action: "cloudButtonClicked" })
		}
	}
```

`postClineMessageAdded` (near line 1560):

```ts
			clineMessage: message,
			state: rest,
		})

		// Preserve existing MDM redirect behavior
		if (this.mdmService?.requiresCloudAuth() && !this.checkMdmCompliance()) {
			await this.postMessageToWebview({ type: "action", action: "cloudButtonClicked" })
		}

		return true
	}
```

`checkMdmCompliance` (near line 1822) stays as is (it is public and used by `getMdmCompliance` near line 277).

## 5. Root cause / analysis

VERIFIED: `grep -n "requiresCloudAuth() && !this.checkMdmCompliance()" src/core/webview/ClineProvider.ts` prints
exactly four lines (1469, 1494, 1521, 1573 at the time of writing). The roadmap says "copied four times in the
`postStateToWebview*` methods"; precisely it is three `postStateToWebview*` methods plus `postClineMessageAdded`.
All four blocks are character-identical apart from the comment.

VERIFIED: the characterization test in section 7 passes (16/16) on the current code (it was run from a scratch
copy against the working tree at `aa173b9`).

Timing note (HYPOTHESIS that it does not matter): today, when no redirect is needed, the method ends without an
`await`. With `await this.postMdmRedirectIfNeeded()` (an `async` helper) the returned promise settles a few
microtask turns later. Nothing is sent differently. Check: run the whole `core/webview` and `core/task` test folders
(section 8, step 6). If a test fails only because of this, switch to the exact-timing variant in section 12.

## 6. Step-by-step changes

1. `src/core/webview/ClineProvider.ts`. Add the helper directly above `checkMdmCompliance`. Find:

```ts
	/**
	 * Check if the current state is compliant with MDM policy
```

Replace with:

```ts
	/**
	 * Follows every state push: when an MDM policy requires cloud sign-in and
	 * the user is not compliant, the view is sent to the account tab.
	 */
	private async postMdmRedirectIfNeeded(): Promise<void> {
		if (this.mdmService?.requiresCloudAuth() && !this.checkMdmCompliance()) {
			await this.postMessageToWebview({ type: "action", action: "cloudButtonClicked" })
		}
	}

	/**
	 * Check if the current state is compliant with MDM policy
```

2. Same file, `postStateToWebview`. Find:

```ts
		// Check MDM compliance and send user to account tab if not compliant
		// Only redirect if there's an actual MDM policy requiring authentication
		if (this.mdmService?.requiresCloudAuth() && !this.checkMdmCompliance()) {
			await this.postMessageToWebview({ type: "action", action: "cloudButtonClicked" })
		}
	}
```

Replace with:

```ts
		await this.postMdmRedirectIfNeeded()
	}
```

3. Same file, the three remaining copies. Each looks exactly like this (the comment line is identical in all three):

```ts
		// Preserve existing MDM redirect behavior
		if (this.mdmService?.requiresCloudAuth() && !this.checkMdmCompliance()) {
			await this.postMessageToWebview({ type: "action", action: "cloudButtonClicked" })
		}
```

Replace each of the three with:

```ts
		await this.postMdmRedirectIfNeeded()
```

The three places are: the end of `postStateToWebviewWithoutTaskHistory`, the end of
`postStateToWebviewWithoutClineMessages`, and in `postClineMessageAdded` just before `return true`. The block is not
unique, so use the Edit tool with `replace_all: true` on exactly that 4-line snippet (with its leading tabs), then
confirm with `grep -c "postMdmRedirectIfNeeded()" src/core/webview/ClineProvider.ts` -> 5 (1 definition + 4 calls)
and `grep -c "cloudButtonClicked" src/core/webview/ClineProvider.ts` -> 1.

4. Do NOT change anything else in these methods: not the order of `rememberViewClineMessages` /
   `postMessageToWebview`, not the un-awaited state post, not the destructuring that drops `clineMessagesSeq`.

5. Add the new spec from section 7.

## 7. Tests to add or change

New file `src/core/webview/__tests__/ClineProvider.mdmRedirect.spec.ts` (unit level: the methods run on a bare
object with the provider's prototype; no VS Code host needed). Full content:

```ts
import { ClineProvider } from "../ClineProvider"

/**
 * D4: every state push is followed by the MDM redirect (the account tab) when
 * an MDM policy requires cloud sign-in and the user is not compliant, and by
 * nothing otherwise. The methods run on a bare object with the provider's
 * prototype, so only the members they touch are stubbed.
 */
type Mdm = { requiresCloudAuth: boolean; compliant: boolean } | undefined

function fakeProvider(mdm: Mdm) {
	const provider = Object.create(ClineProvider.prototype) as any
	provider.mdmService = mdm && {
		requiresCloudAuth: () => mdm.requiresCloudAuth,
		isCompliant: () => (mdm.compliant ? { compliant: true } : { compliant: false, reason: "sign in" }),
	}
	provider.getStateToPostToWebview = vi.fn(async () => ({
		clineMessages: [],
		clineMessagesSeq: 1,
		taskHistory: [],
	}))
	provider.rememberViewClineMessages = vi.fn()
	provider.postMessageToWebview = vi.fn(async () => {})
	// postClineMessageAdded: pretend the view holds the task's list.
	provider.canSendClineMessageAlone = vi.fn(() => true)
	provider.viewClineMessages = { list: [], count: 0 }
	return provider
}

const message = { ts: 1, type: "say", say: "text", text: "hi" }
const task = { taskId: "t1", clineMessages: [message] }

const pushes: Array<[string, (provider: any) => Promise<unknown>, string]> = [
	["postStateToWebview", (p) => p.postStateToWebview(), "state"],
	["postStateToWebviewWithoutTaskHistory", (p) => p.postStateToWebviewWithoutTaskHistory(), "state"],
	["postStateToWebviewWithoutClineMessages", (p) => p.postStateToWebviewWithoutClineMessages(), "state"],
	["postClineMessageAdded", (p) => p.postClineMessageAdded(task, message), "messageAdded"],
]

const sentTypes = (provider: any) =>
	provider.postMessageToWebview.mock.calls.map(([msg]: [{ type: string; action?: string }]) =>
		msg.action ? `${msg.type}:${msg.action}` : msg.type,
	)

describe.each(pushes)("%s and the MDM redirect", (_name, push, firstType) => {
	it("sends the user to the account tab after the push when MDM requires sign-in and the user is not compliant", async () => {
		const provider = fakeProvider({ requiresCloudAuth: true, compliant: false })
		await push(provider)
		expect(sentTypes(provider)).toEqual([firstType, "action:cloudButtonClicked"])
	})

	it("sends nothing more when the user is compliant", async () => {
		const provider = fakeProvider({ requiresCloudAuth: true, compliant: true })
		await push(provider)
		expect(sentTypes(provider)).toEqual([firstType])
	})

	it("sends nothing more when the policy does not require sign-in", async () => {
		const provider = fakeProvider({ requiresCloudAuth: false, compliant: false })
		await push(provider)
		expect(sentTypes(provider)).toEqual([firstType])
	})

	it("sends nothing more without an MDM service", async () => {
		const provider = fakeProvider(undefined)
		await push(provider)
		expect(sentTypes(provider)).toEqual([firstType])
	})
})
```

Exception to 00-README.md section 2 step 1 ("a test that passes before the change proves nothing"): this WP is a behaviour-preserving refactor, so its new test is a characterization test that passes before and after; the mutation check described here is the proof that it can fail.

This is a characterization test: it passes before AND after the refactor (that is the point: behaviour unchanged).
To prove it can fail, before refactoring temporarily delete the MDM block from ONE method (for example
`postStateToWebviewWithoutClineMessages`), run it, see exactly one "sends the user to the account tab" case fail,
then restore the block (`git checkout src/core/webview/ClineProvider.ts`).

If eslint rejects `any` in tests, check how neighbouring specs handle it (`as any` is used throughout
`src/core/webview/__tests__`); do not disable rules file-wide beyond what neighbouring specs do.

## 8. Commands to run (exact, from which directory) and the expected result

1. `cd /home/user/Tumble-Code/src && npx vitest run core/webview/__tests__/ClineProvider.mdmRedirect.spec.ts`
   on the unchanged code -> 16 passed.
2. Mutation check described in section 7 -> exactly 1 failure; restore the file.
3. Apply section 6.
4. `cd /home/user/Tumble-Code/src && npx vitest run core/webview/__tests__/ClineProvider.mdmRedirect.spec.ts` -> 16 passed.
5. `grep -c "postMdmRedirectIfNeeded()" src/core/webview/ClineProvider.ts` -> 5; `grep -c cloudButtonClicked src/core/webview/ClineProvider.ts` -> 1 (from the repo root).
6. `cd /home/user/Tumble-Code/src && npx vitest run core/webview core/task` -> same pass/fail set as on origin/main.
7. `cd /home/user/Tumble-Code/src && pnpm check-types` -> no errors.
8. `cd /home/user/Tumble-Code/src && npx eslint core/webview/ClineProvider.ts core/webview/__tests__/ClineProvider.mdmRedirect.spec.ts --max-warnings=0`.
9. `cd /home/user/Tumble-Code && npx prettier --check src/core/webview/ClineProvider.ts src/core/webview/__tests__/ClineProvider.mdmRedirect.spec.ts`.

## 9. Do not touch / pitfalls

- Do-not-touch list: "the three `postStateToWebview*` variants", `clineMessagesSeq`, the `sourceTaskId` routing.
  Only the MDM block moves. Do not await the `state` post, do not reorder, do not change the destructuring.
- `checkMdmCompliance` is public and used by `getMdmCompliance` (near line 277); keep it.
- Do not change `ExtensionMessage` (the action value `cloudButtonClicked` stays).
- Known flaky tests not related: F1 (cli-integration resume case), F2 (Windows TaskHistoryStore lock count).

## 10. Acceptance checklist (checkboxes)

- [ ] One private `postMdmRedirectIfNeeded` method; four call sites; `cloudButtonClicked` appears once in ClineProvider.ts.
- [ ] New spec `ClineProvider.mdmRedirect.spec.ts` (16 cases) passes; the mutation check made it fail once.
- [ ] `core/webview` and `core/task` test folders pass as on origin/main.
- [ ] check-types, eslint, prettier clean.

## 11. Commit, changeset and PR text

Commit title: `refactor(webview): one helper for the MDM redirect after state pushes (D4)`

Body:

```
The redirect to the account tab when an MDM policy requires cloud sign-in
was copied into postStateToWebview, postStateToWebviewWithoutTaskHistory,
postStateToWebviewWithoutClineMessages and postClineMessageAdded. Move it to
postMdmRedirectIfNeeded; what is sent and in which order is unchanged. Adds
the first tests for the redirect.

<the commit attribution trailers your harness requires>
```

Changeset: none (no user-visible change).

`ai_plans/2026-MM-DD_d4-mdm-redirect-helper.md`:

```
# D4: MDM redirect helper

Item D4 of `2026-09-27_simplification-roadmap.md`.

## Problem
The MDM redirect (`cloudButtonClicked` after a state push when sign-in is required and the user is not compliant)
was copied four times in ClineProvider (three postStateToWebview* methods and postClineMessageAdded) and had no test.

## Change
One private `postMdmRedirectIfNeeded`, called from the four places. Nothing else in the do-not-touch methods changed.

## Tests
`ClineProvider.mdmRedirect.spec.ts`: each of the four pushes x (non-compliant, compliant, no sign-in required,
no MDM service).
```

PR body outline: Summary; "Behaviour unchanged" (list of the four methods, order of posts); Tests (new spec,
mutation check done); do-not-touch note; end with the attribution lines from the session reminder:
the PR attribution footer your harness requires (see 00-README.md, section 3).

## 12. If stuck

- If an existing test in `core/webview` or `core/task` fails after the change and passes before, and its failure is
  about timing (a message arriving a tick later, an `await` count), switch the helper to the exact-timing variant:

```ts
	private postMdmRedirectIfNeeded(): Promise<void> | undefined {
		if (this.mdmService?.requiresCloudAuth() && !this.checkMdmCompliance()) {
			return this.postMessageToWebview({ type: "action", action: "cloudButtonClicked" })
		}
		return undefined
	}
```

  and write each call site as:

```ts
		const mdmRedirect = this.postMdmRedirectIfNeeded()
		if (mdmRedirect) await mdmRedirect
```

  If it still fails, stop and report the test name and output.
- If the prototype-based spec cannot import `ClineProvider` (module-level side effects), report the error; do not
  add `vi.mock` calls for half the codebase.
