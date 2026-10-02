# WP-D14: Replace the "Roo Code" text users still see with "Tumble Code"

Status: ready (one owner decision flagged in section 5: the User-Agent)
Effort: S      Risk: low      Depends on: none
Branch name: fix/d14-rebrand-visible-strings      Base: origin/main

## 1. Goal (2-4 sentences, plain words)

After the rebrand some strings a user sees still say "Roo Code": cloud sign-in notifications, the lightbulb code
actions, the terminal and editor-tab names, the custom-modes JSON schema title, the VS Code LM consent dialog and
errors, the LM Studio error hint, the cloud API's sign-in pages, and the app name sent to OpenRouter and to MCP
servers. Change them to "Tumble Code" (and "Tumble Code Cloud"). Keep internal identifiers (`@roo-code/*`, `ROO_*`,
`.roo`, `.roomodes`, `RooCode` MDM path, `Roo-Code` MCP folder, the User-Agent, the shadow-git author).

## 2. Why it matters (user-visible effect, 2-4 sentences)

Users of Tumble Code see "Explain with Roo Code" in the lightbulb menu, a terminal named "Roo Code", a
"Successfully authenticated with Roo Code Cloud" toast, and a browser page "You have successfully signed in to Roo
Code". OpenRouter attributes their traffic to "Roo Code" with a link to the upstream repository. After this WP the
product name is consistent.

## 3. Read these first (exact paths, and the symbol to look for in each)

- `packages/cloud/src/WebAuthService.ts` (`login`, `handleCallback`, `logout`) and
  `packages/cloud/src/__tests__/WebAuthService.spec.ts`.
- `packages/types/src/roomodes-schema.ts` (`generateRoomodesJsonSchema`), `schemas/roomodes.json`,
  `packages/types/scripts/generate-roomodes-schema.ts`, `packages/types/src/__tests__/roomodes-schema-sync.spec.ts`.
- `src/api/providers/constants.ts` (`DEFAULT_HEADERS`) and its spec; `src/api/providers/utils/image-generation.ts`;
  `src/services/code-index/embedders/openrouter.ts`.
- `src/activate/CodeActionProvider.ts` (`TITLES`), `src/activate/registerCommands.ts` (`createWebviewPanel(... "Roo Code"`),
  `src/integrations/terminal/Terminal.ts` (terminal `name`), `src/core/webview/ClineProvider.ts` (`webviewHtmlOptions`, `title`).
- `src/api/providers/vscode-lm.ts`, `src/api/transform/vscode-lm-format.ts`, `src/api/providers/lm-studio.ts` (`LM_STUDIO_ERROR_HINT`).
- `src/services/mcp/McpConnectionManager.ts` (`new Client({ name: "Roo Code", ... })`).
- `webview-ui/index.html` (`<title>`).
- `self-hosted-cloudapi/src/main.py` (`FastAPI(title=..., description=...)`),
  `self-hosted-cloudapi/src/web/templates/auth_success.html`, `auth_error.html`, `tests/test_route_boilerplate.py`.
- `src/package.json`: `"repository": { "url": "https://github.com/krzychdre/tumble-code" }` (the URL used below).

## 4. Current code (verbatim excerpts, each headed by path and symbol name; line numbers only as a hint "near line N")

`src/api/providers/constants.ts` (whole file):

```ts
import { Package } from "../../shared/package"

export const DEFAULT_HEADERS = {
	"HTTP-Referer": "https://github.com/RooVetGit/Roo-Cline",
	"X-Title": "Roo Code",
	"User-Agent": `RooCode/${Package.version}`,
}
```

`src/api/providers/utils/image-generation.ts` (near lines 75 and 222, two identical blocks):

```ts
				"HTTP-Referer": "https://github.com/RooVetGit/Roo-Code",
				"X-Title": "Roo Code",
```

`src/services/code-index/embedders/openrouter.ts` (near line 65):

```ts
				defaultHeaders: {
					"HTTP-Referer": "https://github.com/RooCodeInc/Roo-Code",
					"X-Title": "Roo Code",
				},
```

`packages/types/src/roomodes-schema.ts` (near line 52):

```ts
	jsonSchema["$id"] = "https://github.com/RooCodeInc/Roo-Code/blob/main/schemas/roomodes.json"
	jsonSchema["title"] = "Roo Code Custom Modes"
	jsonSchema["description"] = "Schema for .roomodes configuration files used by Roo Code to define custom modes."
```

`src/activate/CodeActionProvider.ts` (near line 9):

```ts
export const TITLES: Record<CodeActionName, string> = {
	EXPLAIN: "Explain with Roo Code",
	FIX: "Fix with Roo Code",
	IMPROVE: "Improve with Roo Code",
	ADD_TO_CONTEXT: "Add to Roo Code",
	NEW_TASK: "New Roo Code Task",
} as const
```

`src/integrations/terminal/Terminal.ts` (near line 29):

```ts
			const options: vscode.TerminalOptions = { cwd, name: "Roo Code", iconPath, env }
```

`src/activate/registerCommands.ts` (near line 251):

```ts
	const newPanel = vscode.window.createWebviewPanel(ClineProvider.tabPanelId, "Roo Code", targetCol, {
```

`src/core/webview/ClineProvider.ts`, `webviewHtmlOptions` (near line 1190): `			title: "Roo Code",`

`src/services/mcp/McpConnectionManager.ts` (near line 234): `					name: "Roo Code",`

`src/api/providers/lm-studio.ts` (near line 28):

```ts
const LM_STUDIO_ERROR_HINT =
	"Please check the LM Studio developer logs to debug what went wrong. You may need to load the model with a larger context length to work with Roo Code's prompts."
```

`src/api/providers/vscode-lm.ts`: 33 strings start with `Roo Code <Language Model API>:` (thrown errors and
console logs), plus near line 405:

```ts
				justification: `Roo Code would like to use '${client.name}' from '${client.vendor}', Click 'Allow' to proceed.`,
```

`src/api/transform/vscode-lm-format.ts` (near lines 28 and 189): two `Roo Code <Language Model API>:` log strings.

`packages/cloud/src/WebAuthService.ts`: 13 occurrences of `Roo Code Cloud` (lines 286, 287, 292, 295, 312, 348, 351,
353, 355, 383, 386, 388, 389), e.g. `vscode.window.showInformationMessage("Successfully authenticated with Roo Code Cloud")`.

`webview-ui/index.html` (line 6): `		<title>Roo Code</title>`

`self-hosted-cloudapi/src/main.py` (near line 97):

```python
    title="Roo Code Cloud API",
    description="Self-hosted Roo Code Cloud API compatible with the Roo Code VS Code extension",
```

`self-hosted-cloudapi/src/web/templates/auth_success.html`: line 13 `<title>Roo Code - Authentication Successful</title>`,
line 39 `  <p>You have successfully signed in to Roo Code.<br>Returning to VS Code...</p>`;
`auth_error.html` line 7 `<title>Roo Code - Authentication Error</title>`.

Package descriptions: `packages/core/package.json` `"Platform agnostic core functionality for Roo Code."`,
`packages/cloud/package.json` `"Roo Code Cloud services."`, `packages/telemetry/package.json`
`"Roo Code telemetry service and clients."`, `packages/build/package.json` `"ESBuild utilities for Roo Code."`.

## 5. Root cause / analysis

VERIFIED by grep (`grep -rn "Roo Code" src webview-ui/src webview-ui/index.html packages apps self-hosted-cloudapi/src`
excluding tests, locales, dist, node_modules). The brief's items are all confirmed; the others found are listed in
section 4 and handled below.

Kept on purpose (not user-visible, a contract, or legitimate):
- `src/package.json:17` "Tumble Code (community fork of Roo Code by Roo Veterinary Inc.)" (attribution).
- `src/utils/migrateFromRooCode.ts` (talks about the other product by name, correctly).
- Locale values in `webview-ui/src/i18n/locales/*/chat.json` (the "From Roo Code to Tumble Code" announcement).
- `src/services/mdm/MdmService.ts` path `/Library/Application Support/RooCode/` and `ClineProvider` MCP folder
  `Roo-Code` (on-disk contracts with existing installs); `qdrant-client.ts` `"User-Agent": "Roo-Code"`.
- `ShadowCheckpointService.ts:215` `git.addConfig("user.name", "Roo Code")` (author of commits in the hidden shadow
  repo; users never see it; specs set the same name).
- `packages/types/npm/package.metadata.json` (`"author": "Roo Code Team"`, publishing metadata of `@roo-code/types`
  on npm; changing the published identity is the owner's call).
- Code comments (not visible) and `src/__mocks__/vscode.js`.

DECISION (flagged): `DEFAULT_HEADERS["User-Agent"]` is `RooCode/<version>` and is sent to every OpenAI-compatible
provider. Some "coding plan" endpoints are known to allow-list client user agents; changing it could make a
working setup fail. This WP keeps the User-Agent unchanged and only changes `HTTP-Referer` and `X-Title` (which
OpenRouter documents as the app URL and app name for attribution; they do not gate access). Proposed values:
`"HTTP-Referer": "https://github.com/krzychdre/tumble-code"` (the `repository.url` of `src/package.json`; the
`homepage` `https://tumblecode.dev` is the alternative if the owner prefers) and `"X-Title": "Tumble Code"`.
The two other places that hard-code these headers (image generation, OpenRouter embedder) are pointed at
`DEFAULT_HEADERS` so the values live in one place.

MCP: the MCP client name (`clientInfo.name` in the initialize handshake) is what servers log; changing it to
"Tumble Code" is safe (servers do not gate on it in the MCP spec).

HYPOTHESIS: the `WebviewHtml` golden snapshots under `src/core/webview/__tests__/__snapshots__/webview-html/`
(`sidebar.production.html`, `sidebar.production.openrouter.html`, `sidebar.hmr.html`, `sidebar.hmr.port-5174.html`)
change only in the `<title>` line. Confirm in section 8 step 4 before `-u`.

## 6. Step-by-step changes

Run from `/home/user/Tumble-Code`.

1. Cloud notifications and errors (source and spec; every occurrence in both files is the product name):

```sh
sed -i 's/Roo Code Cloud/Tumble Code Cloud/g' packages/cloud/src/WebAuthService.ts packages/cloud/src/__tests__/WebAuthService.spec.ts
```

   Check: `grep -n "Roo Code" packages/cloud/src/WebAuthService.ts packages/cloud/src/__tests__/WebAuthService.spec.ts` -> nothing.

2. `packages/types/src/roomodes-schema.ts`: replace the three lines quoted in section 4 with

```ts
	jsonSchema["$id"] = "https://github.com/krzychdre/tumble-code/blob/main/schemas/roomodes.json"
	jsonSchema["title"] = "Tumble Code Custom Modes"
	jsonSchema["description"] = "Schema for .roomodes configuration files used by Tumble Code to define custom modes."
```

   Then regenerate the checked-in file: `pnpm --filter @roo-code/types generate:schema` (writes `schemas/roomodes.json`).
   `git diff schemas/roomodes.json` must show exactly the three changed lines (`$id`, `title`, `description`).

3. Package descriptions:
   - `packages/core/package.json`: `"description": "Platform agnostic core functionality for Tumble Code.",`
   - `packages/cloud/package.json`: `"description": "Tumble Code Cloud services.",`
   - `packages/telemetry/package.json`: `"description": "Tumble Code telemetry service and clients.",`
   - `packages/build/package.json`: `"description": "ESBuild utilities for Tumble Code.",`

4. `src/api/providers/constants.ts`: replace the whole file with

```ts
import { Package } from "../../shared/package"

/**
 * Sent with every OpenAI-compatible request. HTTP-Referer and X-Title are the
 * app URL and name OpenRouter shows for attribution. The User-Agent keeps its
 * historical value: some provider endpoints allow-list client user agents.
 */
export const DEFAULT_HEADERS = {
	"HTTP-Referer": "https://github.com/krzychdre/tumble-code",
	"X-Title": "Tumble Code",
	"User-Agent": `RooCode/${Package.version}`,
}
```

5. `src/api/providers/utils/image-generation.ts`: add the import below the existing
   `import { getApiRequestTimeout } from "./timeout-config"` line:

```ts
import { DEFAULT_HEADERS } from "../constants"
```

   and replace BOTH occurrences (near lines 75 and 222) of

```ts
				"HTTP-Referer": "https://github.com/RooVetGit/Roo-Code",
				"X-Title": "Roo Code",
```

   with

```ts
				"HTTP-Referer": DEFAULT_HEADERS["HTTP-Referer"],
				"X-Title": DEFAULT_HEADERS["X-Title"],
```

   (Use the Edit tool with `replace_all: true`; the two blocks have identical indentation. If they do not, edit them
   one by one.) Also change the doc comment near line 63 "for OpenRouter and Roo Code Cloud providers" to
   "for OpenRouter and Tumble Code Cloud providers".

6. `src/services/code-index/embedders/openrouter.ts`: add below `import { handleProviderError } from "../../../api/providers/utils/error-handler"`:

```ts
import { DEFAULT_HEADERS } from "../../../api/providers/constants"
```

   and replace

```ts
					"HTTP-Referer": "https://github.com/RooCodeInc/Roo-Code",
					"X-Title": "Roo Code",
```

   with

```ts
					"HTTP-Referer": DEFAULT_HEADERS["HTTP-Referer"],
					"X-Title": DEFAULT_HEADERS["X-Title"],
```

7. `src/activate/CodeActionProvider.ts` `TITLES`:

```ts
export const TITLES: Record<CodeActionName, string> = {
	EXPLAIN: "Explain with Tumble Code",
	FIX: "Fix with Tumble Code",
	IMPROVE: "Improve with Tumble Code",
	ADD_TO_CONTEXT: "Add to Tumble Code",
	NEW_TASK: "New Tumble Code Task",
} as const
```

8. `src/integrations/terminal/Terminal.ts`: `name: "Roo Code"` -> `name: "Tumble Code"` (nothing matches terminals
   by name; verified `grep -rn "terminal.name\|\.name ===" src/integrations/terminal`). Update the assertions and
   fixtures in the terminal specs:

```sh
sed -i 's/name: "Roo Code"/name: "Tumble Code"/g' \
  src/integrations/terminal/__tests__/TerminalRegistry.spec.ts \
  src/integrations/terminal/__tests__/TerminalProfile.spec.ts \
  src/integrations/terminal/__tests__/TerminalProcess.spec.ts \
  src/integrations/terminal/__tests__/TerminalCompletionContract.spec.ts \
  src/integrations/terminal/__tests__/TerminalProcessExec.bash.spec.ts \
  src/integrations/terminal/__tests__/TerminalProcessExec.cmd.spec.ts \
  src/integrations/terminal/__tests__/TerminalProcessExec.pwsh.spec.ts
```

   (Only `TerminalRegistry.spec.ts` asserts the name, in its four `toHaveBeenCalledWith({ ... name: ... })` blocks;
   the rest are fixtures, changed for consistency.)

9. `src/activate/registerCommands.ts`: `createWebviewPanel(ClineProvider.tabPanelId, "Roo Code", targetCol, {` ->
   `createWebviewPanel(ClineProvider.tabPanelId, "Tumble Code", targetCol, {`.

10. `src/core/webview/ClineProvider.ts` `webviewHtmlOptions`: `title: "Roo Code",` -> `title: "Tumble Code",`
    (not a do-not-touch method).

11. `webview-ui/index.html`: `<title>Roo Code</title>` -> `<title>Tumble Code</title>`.

12. `src/services/mcp/McpConnectionManager.ts`: `name: "Roo Code",` (the MCP `Client` info) -> `name: "Tumble Code",`.

13. VS Code LM provider:

```sh
sed -i 's/Roo Code <Language Model API>/Tumble Code <Language Model API>/g' src/api/providers/vscode-lm.ts src/api/transform/vscode-lm-format.ts
sed -i "s/justification: \`Roo Code would like to use/justification: \`Tumble Code would like to use/" src/api/providers/vscode-lm.ts
```

    Check: `grep -n "Roo Code" src/api/providers/vscode-lm.ts src/api/transform/vscode-lm-format.ts` -> nothing.

14. `src/api/providers/lm-studio.ts`: in `LM_STUDIO_ERROR_HINT` replace `to work with Roo Code's prompts.` with
    `to work with Tumble Code's prompts.` (`lmstudio.spec.ts:128` matches only the first sentence; still passes).

15. Cloud API:
    - `self-hosted-cloudapi/src/main.py`: `title="Tumble Code Cloud API",` and
      `description="Self-hosted Tumble Code Cloud API compatible with the Tumble Code VS Code extension",`
    - `self-hosted-cloudapi/src/web/templates/auth_success.html`: `<title>Tumble Code - Authentication Successful</title>`
      and `  <p>You have successfully signed in to Tumble Code.<br>Returning to VS Code...</p>`
    - `self-hosted-cloudapi/src/web/templates/auth_error.html`: `<title>Tumble Code - Authentication Error</title>`
    - `self-hosted-cloudapi/tests/test_route_boilerplate.py`: lines 255 and 385
      `assert page.title == "Tumble Code - Authentication Error"`, line 358
      `assert page.title == "Tumble Code - Authentication Successful"`, line 360
      `assert page.paragraphs == ["You have successfully signed in to Tumble Code.Returning to VS Code..."]`.
      (`sed -i 's/Roo Code - Authentication/Tumble Code - Authentication/; s/signed in to Roo Code\./signed in to Tumble Code./' tests/test_route_boilerplate.py`
      from `self-hosted-cloudapi`.)

## 7. Tests to add or change

Changed expectations (literal updates):
- `src/api/providers/__tests__/constants.spec.ts`: `toBe("https://github.com/RooVetGit/Roo-Cline")` ->
  `toBe("https://github.com/krzychdre/tumble-code")`; `toBe("Roo Code")` -> `toBe("Tumble Code")`. The User-Agent
  assertions stay.
- `src/api/providers/__tests__/openai.spec.ts` (near lines 123-124) and `src/api/providers/__tests__/openrouter.spec.ts`
  (near lines 108-109): `"HTTP-Referer": "https://github.com/RooVetGit/Roo-Cline",` ->
  `"HTTP-Referer": "https://github.com/krzychdre/tumble-code",` and `"X-Title": "Roo Code",` -> `"X-Title": "Tumble Code",`.
- `src/services/code-index/embedders/__tests__/openrouter.spec.ts` (near lines 95-96):
  `"HTTP-Referer": "https://github.com/RooCodeInc/Roo-Code",` -> `"HTTP-Referer": "https://github.com/krzychdre/tumble-code",`
  and `"X-Title": "Roo Code",` -> `"X-Title": "Tumble Code",`.
- `packages/cloud/src/__tests__/WebAuthService.spec.ts` (step 1), terminal specs (step 8),
  `self-hosted-cloudapi/tests/test_route_boilerplate.py` (step 15).
- Snapshots: the four `sidebar.*.html` WebviewHtml snapshots (`<title>`), updated with `-u` after reading the diff.

New test, `src/api/providers/utils/__tests__/image-generation.spec.ts`, append at the end of the file:

```ts
describe("image generation app attribution headers", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	const expectAttribution = () =>
		expect(global.fetch).toHaveBeenCalledWith(
			expect.any(String),
			expect.objectContaining({
				headers: expect.objectContaining({
					"HTTP-Referer": "https://github.com/krzychdre/tumble-code",
					"X-Title": "Tumble Code",
				}),
			}),
		)

	it("chat-completions image generation names Tumble Code", async () => {
		vi.mocked(global.fetch).mockResolvedValue({
			ok: true,
			json: vi.fn().mockResolvedValue({
				choices: [{ message: { images: [{ image_url: { url: "data:image/png;base64,iVBORw0KGgo=" } }] } }],
			}),
		} as any)

		await generateImageWithProvider({
			baseURL: "https://api.example.com/v1",
			authToken: "test-token",
			model: "gpt-4-vision",
			prompt: "A cute cat",
		})

		expectAttribution()
	})

	it("images-API image generation names Tumble Code", async () => {
		vi.mocked(global.fetch).mockResolvedValue({
			ok: true,
			json: vi.fn().mockResolvedValue({ data: [{ b64_json: Buffer.from("x").toString("base64") }] }),
		} as any)

		await generateImageWithImagesApi({
			baseURL: "https://api.example.com/v1",
			authToken: "test-token",
			model: "gpt-image-1",
			prompt: "A cute cat",
			outputFormat: "png",
		})

		expectAttribution()
	})
})
```

Why it fails without the fix: both functions send `"X-Title": "Roo Code"` and a `RooVetGit` referer today.
(Lowest layer: a unit test on the request construction.)

## 8. Commands to run (exact, from which directory) and the expected result

1. Write the new image-generation test first, then
   `cd /home/user/Tumble-Code/src && npx vitest run api/providers/utils/__tests__/image-generation.spec.ts -t "attribution"`
   -> 2 failures (old header values). Apply section 6, re-run -> pass.
2. `cd /home/user/Tumble-Code/src && npx vitest run api/providers/__tests__/constants.spec.ts api/providers/__tests__/openai.spec.ts api/providers/__tests__/openrouter.spec.ts api/providers/__tests__/lmstudio.spec.ts api/providers/__tests__/vscode-lm.spec.ts api/transform/__tests__/vscode-lm-format.spec.ts services/code-index/embedders/__tests__/openrouter.spec.ts integrations/terminal activate services/mcp`
   -> pass.
3. `cd /home/user/Tumble-Code/packages/cloud && npx vitest run` -> pass.
   `cd /home/user/Tumble-Code/packages/types && npx vitest run src/__tests__/roomodes-schema-sync.spec.ts src/__tests__/roomodes-schema.spec.ts` -> pass.
4. `cd /home/user/Tumble-Code/src && npx vitest run core/webview/__tests__/WebviewHtml.spec.ts` -> fails only on
   `<title>Roo Code</title>` vs `<title>Tumble Code</title>` in the four sidebar snapshots. Then run it with `-u`,
   and `git diff src/core/webview/__tests__/__snapshots__` must show only title lines.
5. `cd /home/user/Tumble-Code/self-hosted-cloudapi && uv run pytest -q tests/test_route_boilerplate.py` -> pass.
   `uvx ruff@0.15.12 check .` -> clean.
6. Type check: `cd /home/user/Tumble-Code/src && pnpm check-types`; `cd /home/user/Tumble-Code/packages/cloud && pnpm check-types`;
   `cd /home/user/Tumble-Code/packages/types && pnpm check-types`; `cd /home/user/Tumble-Code/webview-ui && pnpm check-types`.
7. Lint the changed TS files with `npx eslint <files> --max-warnings=0` in each package; `npx prettier --check` on all
   changed files from the repo root.
8. Final grep (should list only the kept items of section 5):
   `grep -rn "Roo Code" src webview-ui/src webview-ui/index.html packages apps self-hosted-cloudapi/src --include=*.ts --include=*.tsx --include=*.html --include=*.py --include=*.json | grep -v "__tests__\|\.spec\.\|\.test\.\|/locales/\|node_modules\|/dist/"`.

## 9. Do not touch / pitfalls

- Do NOT rename `@roo-code/*` packages, `ROO_*` variables, `.roo`/`.roomodes`, `RooCodeEventName`, the MDM path, the
  MCP folder `Roo-Code`, the qdrant User-Agent, or `DEFAULT_HEADERS["User-Agent"]` (see section 5).
- Do not edit i18n keys; do not edit the Roo-to-Tumble announcement texts.
- Telemetry: `TelemetryEventName` runtime values are on the do-not-touch list; this WP does not touch them.
- `src/package.json` is the published manifest: only its attribution line mentions Roo Code, leave it.
- The webview HTML snapshots are golden files: update them only after checking that the title is the only diff.

## 10. Acceptance checklist (checkboxes)

- [ ] All strings in section 6 changed; final grep lists only the kept items.
- [ ] `schemas/roomodes.json` regenerated; sync spec passes.
- [ ] New attribution test failed before and passes after; changed specs pass.
- [ ] WebviewHtml snapshots differ only in `<title>`.
- [ ] Cloud pytest for route boilerplate passes; ruff clean.
- [ ] check-types, eslint, prettier clean.

## 11. Commit, changeset and PR text

Commit title: `fix: show Tumble Code instead of Roo Code in user-visible text (D14)`

Body:

```
Cloud sign-in toasts, lightbulb code actions, the terminal and editor tab
names, the custom-modes schema title, VS Code LM consent text and errors, the
LM Studio hint, the MCP client name, the cloud API sign-in pages and the
OpenRouter app attribution (HTTP-Referer, X-Title) now say Tumble Code. The
image generation and OpenRouter embedder read the attribution headers from
DEFAULT_HEADERS. Internal identifiers and the User-Agent are unchanged.

<the commit attribution trailers your harness requires>
```

`.changeset/d14-rebrand-visible-strings.md`:

```
---
"tumble-code": patch
---

Messages, menu entries and names that still said "Roo Code" now say "Tumble Code": the cloud sign-in notifications,
the lightbulb actions ("Explain with Tumble Code"), the terminal and editor tab names, the custom modes schema, the
VS Code language model consent prompt and errors, and the LM Studio error hint. OpenRouter now lists requests under
"Tumble Code".
```

`ai_plans/2026-MM-DD_d14-rebrand-visible-strings.md`:

```
# D14: visible "Roo Code" strings

Item D14 of `2026-09-27_simplification-roadmap.md`.

## Problem
Strings users see still said Roo Code (cloud toasts, code actions, terminal/tab names, schema title, VS Code LM,
LM Studio hint, MCP client name, cloud sign-in pages, OpenRouter attribution headers).

## Change
All changed to Tumble Code; attribution headers now come from DEFAULT_HEADERS only. Kept: internal identifiers,
MDM/MCP paths, User-Agent (possible provider allow-lists), shadow-git author, npm metadata of @roo-code/types.

## Tests
New image-generation attribution test; header, cloud, terminal and cloud-API tests updated; webview HTML snapshots
(title only); regenerated schemas/roomodes.json.
```

PR body outline: Summary list of changed strings; "Kept on purpose" with reasons; the User-Agent decision for the
owner; test notes; end with the PR attribution footer your harness requires (see 00-README.md, section 3).

## 12. If stuck

- If `pnpm --filter @roo-code/types generate:schema` fails (tsx missing), edit the three lines of
  `schemas/roomodes.json` by hand to match `generateRoomodesJsonSchema()` and rely on the sync spec.
- If a snapshot or test changes in a way not described here, stop and report the diff.
- If the owner wants the homepage (`https://tumblecode.dev`) as HTTP-Referer instead, change only
  `DEFAULT_HEADERS` and the four expectations that name the URL.
