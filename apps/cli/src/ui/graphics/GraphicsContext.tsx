import { createContext, useContext } from "react"

import { TEXT_ONLY, type TerminalGraphics } from "./terminalProbe.js"

export interface GraphicsSettings extends TerminalGraphics {
	/** The directory relative image paths in answers are resolved against: the workspace. */
	baseDir: string
}

/**
 * What the terminal can draw (see `terminalProbe.ts`), set once at startup.
 * Text only by default, so tests and the plain-text paths need no provider.
 */
export const GraphicsContext = createContext<GraphicsSettings>({ ...TEXT_ONLY, baseDir: process.cwd() })

/**
 * True inside the printed transcript (`<Static>`), the only place an image
 * may be drawn; see `inlineImages.ts`.
 */
export const ScrollbackContext = createContext(false)

/** The protocol to draw images with here, or null where only text fits. */
export function useImageProtocol() {
	const graphics = useContext(GraphicsContext)
	const inScrollback = useContext(ScrollbackContext)
	return inScrollback ? graphics.protocol : null
}
