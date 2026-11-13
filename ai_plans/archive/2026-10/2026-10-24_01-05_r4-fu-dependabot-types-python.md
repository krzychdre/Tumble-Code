# r4 follow-up: Dependabot #954 and #955

## Status

Done.

## Related plans

- `ai_plans/2026-10-23_17-20_maintenance-audit-round-4.md` (section "Follow-ups found during execution")

## Touched files

- `pnpm-workspace.yaml`, `pnpm-lock.yaml`
- `.github/dependabot.yml`

## Problem

- #954 (type-definitions group) bumps `@types/node` to 22.20.5 and `@types/vscode` to `^1.140.0`. `src` keeps
  `@types/vscode` equal to `engines.vscode` (`^1.102.0`, the oldest VS Code the extension supports), and
  `vsce package` fails with "@types/vscode ... greater than engines.vscode" (`@vscode/vsce` `validation.js`).
  Newer typings would also let code use APIs that the oldest supported VS Code lacks.
- #955 moves the cloud api image to Python 3.14; the `cloudapi.yml` matrix tests 3.12 and 3.13 only.

## Change

- Take the `@types/node` part of #954 (catalog `^22.20.5`) and close the bot PR.
- `.github/dependabot.yml`: ignore `@types/vscode` in the npm updates (it moves with `engines.vscode`), and
  ignore minor updates of the `python` base image (majors were already ignored), so patch and digest updates
  still come.
- Close #955: the service stays on 3.13 until the CI matrix tests 3.14.

## Tests

- `pnpm install` resolves `@types/node` 22.20.5 only; check-types (pre-push hook) and `pnpm knip` pass.
