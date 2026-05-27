import * as vscode from "vscode"
import * as fs from "fs/promises"
import * as path from "path"
import { randomBytes } from "crypto"

import type { AudioType } from "@roo-code/types"

export const CUSTOM_SOUNDS_DIR = "custom-sounds"

const ALLOWED_EXTS = new Set([".wav", ".mp3", ".ogg"])

const SETTING_KEY: Record<AudioType, "customSoundCelebration" | "customSoundProgressLoop" | "customSoundNotification"> =
	{
		celebration: "customSoundCelebration",
		progress_loop: "customSoundProgressLoop",
		notification: "customSoundNotification",
	}

const ORIGINAL_SETTING_KEY: Record<
	AudioType,
	"customSoundCelebrationOriginal" | "customSoundProgressLoopOriginal" | "customSoundNotificationOriginal"
> = {
	celebration: "customSoundCelebrationOriginal",
	progress_loop: "customSoundProgressLoopOriginal",
	notification: "customSoundNotificationOriginal",
}

export function getCustomSoundsDir(globalStoragePath: string): string {
	return path.join(globalStoragePath, CUSTOM_SOUNDS_DIR)
}

export function getCustomSoundSettingKey(audioType: AudioType) {
	return SETTING_KEY[audioType]
}

export function getCustomSoundOriginalSettingKey(audioType: AudioType) {
	return ORIGINAL_SETTING_KEY[audioType]
}

async function ensureDir(dir: string): Promise<void> {
	await fs.mkdir(dir, { recursive: true })
}

async function safeUnlink(filePath: string): Promise<void> {
	try {
		await fs.unlink(filePath)
	} catch (err) {
		const code = (err as NodeJS.ErrnoException)?.code
		if (code !== "ENOENT") {
			throw err
		}
	}
}

export interface StoredCustomSound {
	/** Basename used for storage on disk inside globalStorage/custom-sounds/. */
	basename: string
	/** The original filename the user picked, for display. */
	originalName: string
}

/**
 * Prompts the user for an audio file and copies it into the custom-sounds dir.
 * Returns the stored basename + the original filename for display, or undefined
 * if the user cancelled / picked an unsupported file. The previous file for
 * this slot (if any) is removed.
 */
export async function selectAndStoreCustomSound(
	globalStoragePath: string,
	audioType: AudioType,
	previousBasename: string | null | undefined,
): Promise<StoredCustomSound | undefined> {
	const picked = await vscode.window.showOpenDialog({
		canSelectMany: false,
		openLabel: "Use this sound",
		filters: { Audio: ["wav", "mp3", "ogg"] },
	})

	if (!picked || picked.length === 0) {
		return undefined
	}

	const sourcePath = picked[0].fsPath
	const ext = path.extname(sourcePath).toLowerCase()
	if (!ALLOWED_EXTS.has(ext)) {
		vscode.window.showErrorMessage(`Unsupported audio file type: ${ext}. Use .wav, .mp3, or .ogg.`)
		return undefined
	}

	const dir = getCustomSoundsDir(globalStoragePath)
	await ensureDir(dir)

	// Random suffix forces a different webview URI each time, so use-sound
	// rebuilds its Howl when the user replaces a file with the same name.
	const suffix = randomBytes(4).toString("hex")
	const basename = `${audioType}-${suffix}${ext}`
	const destPath = path.join(dir, basename)

	await fs.copyFile(sourcePath, destPath)

	if (previousBasename && previousBasename !== basename) {
		await safeUnlink(path.join(dir, previousBasename))
	}

	return { basename, originalName: path.basename(sourcePath) }
}

export async function deleteCustomSound(globalStoragePath: string, basename: string | null | undefined): Promise<void> {
	if (!basename) return
	await safeUnlink(path.join(getCustomSoundsDir(globalStoragePath), basename))
}

/**
 * Returns a webview-accessible URI for the stored sound, or undefined if the
 * file is missing (e.g. setting synced from another machine, or removed manually).
 */
export async function resolveCustomSoundUri(
	webview: vscode.Webview,
	globalStoragePath: string,
	basename: string | null | undefined,
): Promise<string | undefined> {
	if (!basename) return undefined
	const filePath = path.join(getCustomSoundsDir(globalStoragePath), basename)
	try {
		await fs.access(filePath)
	} catch {
		return undefined
	}
	return webview.asWebviewUri(vscode.Uri.file(filePath)).toString()
}
