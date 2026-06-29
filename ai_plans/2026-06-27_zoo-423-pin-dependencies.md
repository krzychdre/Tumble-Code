# Port Zoo PR #423 — pin React type dependencies

## §0 Credit & provenance

- Upstream: Zoo-Code-Org/Zoo-Code PR #423, commit `5ad7aab6b`, merged 2026-06-07.
- Original author: Elliott de Launay (renovate[bot] dropped as a bot).
- Commit trailer:
    ```
    Co-authored-by: Elliott de Launay <edelauna@gmail.com>
    ```

## §1 What & why

Renovate "pin dependencies" chore: replace caret ranges on `@types/react` /
`@types/react-dom` with exact versions across the three manifests that declare
them, and align `apps/cli` (which declared React **19** types while the root
override forces **18**) to the pinned v18.

Pinning removes silent caret drift (reproducible installs) and fixes the
declared-vs-resolved React-types mismatch in the CLI. The lockfile already
resolves `@types/react@18.3.23` and `@types/react-dom@18.3.7`, so resolution is
unchanged — only the declared ranges tighten.

Our fork is at the exact pre-PR state for these lines.

## §2 Edits (exact)

- `apps/cli/package.json`: `"@types/react": "^19.1.6"` → `"18.3.23"`.
- `package.json` (pnpm.overrides): `"@types/react": "^18.3.23"` → `"18.3.23"`;
  `"@types/react-dom": "^18.3.5"` → `"18.3.7"`.
- `webview-ui/package.json`: `"@types/react": "^18.3.23"` → `"18.3.23"`;
  `"@types/react-dom": "^18.3.5"` → `"18.3.7"`.
- Refresh `pnpm-lock.yaml` via `pnpm install --lockfile-only`.

## §3 Scope cuts (YAGNI / divergence)

- Do NOT touch `@types/node`, `glob`, or any other line the PR only showed as
  diff context — our fork has its own values there (`glob: ">=11.1.0"`,
  cli `@types/node: "^24.1.0"`). Only the React-type lines change.
- Do NOT re-add Roo branding / TTS / router / cloud.

## §4 Verify (binary acceptance)

- `grep '@types/react' apps/cli/package.json package.json webview-ui/package.json`
  shows no caret on the react type lines; cli shows `18.3.23`.
- `pnpm install --lockfile-only` succeeds; lockfile still resolves
  `@types/react@18.3.23` and `@types/react-dom@18.3.7`.
- `pnpm --filter @roo-code/vscode-webview check-types` → passes.
- `pnpm --filter @roo-code/cli check-types` → passes.

## §5 Co-author — see §0.
