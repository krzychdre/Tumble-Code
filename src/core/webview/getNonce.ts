import { randomBytes } from "crypto"

/** A fresh, unguessable value for the CSP `'nonce-...'` of one webview document. */
export function getNonce(): string {
	return randomBytes(16).toString("base64")
}
