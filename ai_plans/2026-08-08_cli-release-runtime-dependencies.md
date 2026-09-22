# CLI release runtime dependencies

## Root cause

The local release builder creates a reduced `package.json` by manually copying a stale allowlist of CLI dependencies. The emitted CLI bundle currently leaves `execa`, `json-stream-stringify`, and `proper-lockfile` as runtime imports, but the generated release manifest omits them. Consequently, installation succeeds while the installed entrypoint immediately fails with `ERR_MODULE_NOT_FOUND` for `execa`; this masked verification of the bundled-ripgrep fix.

## Changes

1. Generate the release manifest from every declared runtime dependency except workspace-only packages and `@vscode/ripgrep`, whose executable is copied into the tarball separately.
2. Add a focused test for the manifest projection so newly externalized runtime dependencies cannot silently disappear from releases.
3. Keep the installed-layout verification as the final proof: launch the installed CLI, confirm the rebuilt extension is installed, and confirm startup no longer throws the ripgrep discovery error.

## Verification

- `cd apps/cli && npx vitest run src/lib/utils/__tests__/release-manifest.test.ts` — passed.
- `cd apps/cli && pnpm check-types` — passed.
- `cd apps/cli && pnpm lint` — passed.
- `./apps/cli/scripts/build.sh --install` — release build, temporary installation verification, and local installation passed.
- Installed `tumble --version` returned `0.1.17-local.2ea84fe8b`; the installed release manifest and modules include `execa`, `json-stream-stringify`, and `proper-lockfile`.
- Installed OpenAI Codex smoke task completed with `OK`; neither `ERR_MODULE_NOT_FOUND` nor the ripgrep discovery error occurred.
