import React, { useState, useRef, useLayoutEffect, memo } from "react"
import { useWindowSize } from "react-use"
import { vscode } from "@src/utils/vscode"
import { useAppTranslation } from "@src/i18n/TranslationContext"

interface ThumbnailsProps {
	images: string[]
	style?: React.CSSProperties
	setImages?: React.Dispatch<React.SetStateAction<string[]>>
	onHeightChange?: (height: number) => void
}

/**
 * Attachment tiles. Square 48px (§2.5): each tile keeps a real, focusable
 * remove button in the tab order; it is dimmed until the tile is hovered or
 * the button itself is focused, so keyboard users can always reach it.
 */
const Thumbnails = ({ images, style, setImages, onHeightChange }: ThumbnailsProps) => {
	const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
	const containerRef = useRef<HTMLDivElement>(null)
	const { width } = useWindowSize()
	const { t } = useAppTranslation()

	useLayoutEffect(() => {
		if (containerRef.current) {
			let height = containerRef.current.clientHeight
			// some browsers return 0 for clientHeight
			if (!height) {
				height = containerRef.current.getBoundingClientRect().height
			}
			onHeightChange?.(height)
		}
		setHoveredIndex(null)
	}, [images, width, onHeightChange])

	const handleDelete = (index: number) => {
		setImages?.((prevImages) => prevImages.filter((_, i) => i !== index))
	}

	const isDeletable = setImages !== undefined

	const handleImageClick = (image: string) => {
		vscode.postMessage({ type: "openImage", text: image })
	}

	return (
		<div
			ref={containerRef}
			className="py-1"
			style={{
				display: "flex",
				flexWrap: "wrap",
				gap: 5,
				rowGap: 3,
				...style,
			}}>
			{images.map((image, index) => (
				<div
					key={index}
					style={{ position: "relative" }}
					onMouseEnter={() => setHoveredIndex(index)}
					onMouseLeave={() => setHoveredIndex(null)}>
					<img
						src={image}
						alt={t("chat:thumbnailAlt", { index: index + 1 })}
						style={{
							width: 48,
							height: 48,
							objectFit: "cover",
							cursor: "pointer",
						}}
						onClick={() => handleImageClick(image)}
					/>
					{isDeletable && (
						<button
							type="button"
							aria-label={t("chat:removeImage", { index: index + 1 })}
							onClick={() => handleDelete(index)}
							className="codicon codicon-close"
							style={{
								position: "absolute",
								top: -4,
								right: -4,
								width: 13,
								height: 13,
								backgroundColor: "var(--vscode-badge-background)",
								display: "flex",
								justifyContent: "center",
								alignItems: "center",
								cursor: "pointer",
								border: "none",
								padding: 0,
								color: "var(--vscode-foreground)",
								fontSize: 10,
								fontWeight: "bold",
								opacity: hoveredIndex === index ? 1 : 0,
							}}
							onFocus={(e) => {
								e.currentTarget.style.opacity = "1"
							}}
							onBlur={(e) => {
								if (hoveredIndex !== index) {
									e.currentTarget.style.opacity = "0"
								}
							}}>
						</button>
					)}
				</div>
			))}
		</div>
	)
}

export default memo(Thumbnails)
