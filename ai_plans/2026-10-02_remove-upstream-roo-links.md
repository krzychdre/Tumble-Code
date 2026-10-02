# Remove the remaining links to upstream Roo infrastructure

Date: 2026-10-02
Branch: `fix/remove-upstream-roo-links` (stacked on `fix/remove-posthog-telemetry-setting`)

## Audit result

No shipped code calls an upstream Roo server by default: every cloud fetch, the sign-in flow
and the bridge go through `getRooCodeApiUrl()` / `getClerkBaseUrl()`, which default to
tumblecode.dev hosts; marketplace and CLI upgrade read the fork's GitHub. There is no "roo"
model provider left. What remained was in the webview:

| Where                                                             | Was                                                                                 | Now                                                                  |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `CloudView.tsx` fallback constant                                 | `https://app.roocode.com` (also made the "custom cloud URL" note show for everyone) | `https://app.tumblecode.dev`, same as `packages/cloud/src/config.ts` |
| `CloudView.tsx` manual-URL placeholder                            | `vscode://RooVeterinaryInc.roo-cline/...`                                           | `vscode://QUB-IT.tumble-code/...`                                    |
| `ErrorBoundary.tsx`                                               | RooCodeInc issues                                                                   | fork issues                                                          |
| `ApiRequestRows.tsx` unknown API error                            | `mailto:support@roocode.com`                                                        | fork "new issue" page                                                |
| `utils/docLinks.ts` (docs.roocode.com + UTM params), 6 call sites |                                                                                     | deleted, see below                                                   |

Doc links (the fork has no docs site):

- MCP description: "Model Context Protocol" now links to https://modelcontextprotocol.io.
- `.roo/rules/` paths in the custom-instruction sections: plain `<code>`, translations unchanged.
- "Learn more about editing MCP settings files" and the shell-integration troubleshooting
  link: removed with their keys (`mcp:learnMoreEditingSettings`,
  `chat:shellIntegration.troubleshooting`, `prompts:*.docsLinkAriaLabel`) in all locales.
- Slash commands: the `DocsLink` component was dead (no tag in the string); plain `t()` now.

## Left on purpose

- Identification headers naming Roo sent to model providers: `User-Agent: RooCode/<v>`
  (`src/api/providers/constants.ts`), Bedrock `userAgentAppId`, responses-api `User-Agent`,
  `originator: "roo-code"` (OpenAI Codex OAuth may only accept known originators, so it
  needs a login test before any change). Not traffic to Roo; own branch if wanted.
- `roocode://settings` in ErrorRow is an internal link scheme, not a server.
- `roomodes` JSON schema `$id` (identifier, never fetched), X link in the handoff announcement.
