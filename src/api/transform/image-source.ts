import type { Anthropic } from "@anthropic-ai/sdk"

type ImageSource = Anthropic.Messages.ImageBlockParam["source"]

/**
 * The URL an OpenAI-style `image_url` field needs for an Anthropic image block.
 *
 * The task history only ever stores base64 images, which become the same
 * `data:` URL as before. Since SDK 0.128 the type also admits URL and Files API
 * sources: a URL source is passed through, a file source has no URL any other
 * provider could fetch, so it is rejected with a clear message instead of
 * sending `data:undefined;base64,undefined`.
 */
export function imageSourceToUrl(source: ImageSource): string {
	switch (source.type) {
		case "base64":
			return `data:${source.media_type};base64,${source.data}`
		case "url":
			return source.url
		default:
			throw new Error(`Image source type "${source.type}" cannot be sent to this provider`)
	}
}

/** The media type of an image block for display, or undefined when the source has none. */
export function imageSourceMediaType(source: ImageSource | undefined): string | undefined {
	return source && source.type === "base64" ? source.media_type : undefined
}
