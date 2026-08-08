# CLI permissions command

## Goal

Allow an interactive CLI user to change the active action-approval policy without restarting the session or abandoning the current task.

## Existing behavior and root cause

The CLI chooses one of two approval profiles only while constructing the extension host:

- the default profile enables auto-approval for all action categories;
- `--require-approval` disables auto-approval and asks before actions.

After startup there is no CLI action that sends an updated approval profile to the extension. The only CLI-local slash command is `/new`, so changing the policy currently requires exiting and relaunching with a different flag or persisted setting.

## UX and scope

- Add `/permissions` to CLI slash-command autocomplete.
- `/permissions` toggles between `allow` and `ask` based on the current session policy.
- `/permissions allow` explicitly enables the same complete auto-approval profile used by the default CLI startup path.
- `/permissions ask` explicitly disables auto-approval.
- Invalid arguments show usage and do not reach the model.
- The change applies immediately to the current extension-host session, including an already-running task.
- The command is session-scoped. It does not rewrite `cli-settings.json`; startup flags/settings remain the source of the next session's initial policy.
- A system transcript entry confirms the selected policy and makes the safety-relevant state change durable on screen.

## Implementation

1. Define shared `ask` and `allow` approval profiles next to the extension host so startup and runtime updates cannot drift. The `ask` profile only uses the existing master kill switch; it must not erase granular preferences or command lists.
2. Add a public host operation that sends an `updateSettings` message with the selected profile.
3. Track the active permission mode in the extension-host hook and expose a stable setter to the TUI.
4. Make the follow-up auto-accept countdown follow the active permission mode, including cancellation during a runtime switch to `ask`.
5. Extend the global slash-command parser with `/permissions [ask|allow]`, including toggle and validation behavior.
6. Keep permission commands local: do not add them as user messages and never forward them as model input.

## Verification

- Unit-test command registration, argument parsing, toggle behavior, explicit modes, and invalid input.
- Hook-test that changing the mode sends the complete expected settings profile and updates current session state.
- Run the focused CLI tests, full CLI suite, type checking, and linting.

Completed:

- Focused permission, command, countdown, message-handler, task-submit, and extension-host tests: 86 tests passed.
- Full CLI suite: 634 tests passed, 1 skipped.
- `pnpm check-types`: passed.
- `pnpm lint`: passed.
- `pnpm build`: passed.
