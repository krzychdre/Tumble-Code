/**
 * The webview's launch message. It declares that this view applies
 * `messageAdded` (a new chat message sent alone, CORE-R7); views that leave
 * the flag out, like the CLI, keep receiving the whole message list.
 */
export const WEBVIEW_DID_LAUNCH_MESSAGE = { type: "webviewDidLaunch", acceptsMessageAdded: true } as const
