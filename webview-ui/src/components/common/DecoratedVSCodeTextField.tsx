import { cn } from "@/lib/utils"
import { forwardRef, useCallback, useRef, ReactNode } from "react"

import { ThemedTextField, type ThemedTextFieldProps } from "@src/components/ui"

export interface VSCodeTextFieldWithNodesProps extends ThemedTextFieldProps {
	leftNodes?: ReactNode[]
	rightNodes?: ReactNode[]
	"data-testid"?: string
}

function VSCodeTextFieldWithNodesInner(
	props: VSCodeTextFieldWithNodesProps,
	forwardedRef: React.Ref<HTMLInputElement>,
) {
	const { className, style, "data-testid": dataTestId, leftNodes, rightNodes, ...restProps } = props

	const inputRef = useRef<HTMLInputElement | null>(null)

	// ThemedTextField forwards its ref to the input itself.
	const handleInputRef = useCallback(
		(element: HTMLInputElement | null) => {
			inputRef.current = element
			if (typeof forwardedRef === "function") {
				forwardedRef(element)
			} else if (forwardedRef) {
				;(forwardedRef as React.MutableRefObject<HTMLInputElement | null>).current = element
			}
		},
		[forwardedRef],
	)

	const focusInput = useCallback(async () => {
		if (inputRef.current && document.activeElement !== inputRef.current) {
			setTimeout(() => {
				inputRef.current?.focus()
			})
		}
	}, [])

	const hasLeftNodes = leftNodes && leftNodes.filter(Boolean).length > 0
	const hasRightNodes = rightNodes && rightNodes.filter(Boolean).length > 0

	return (
		<div
			className={cn(
				`group`,
				`relative flex items-center cursor-text`,
				`bg-vscode-input-background text-vscode-input-foreground`,
				`rounded-[2px]`,
				className,
			)}
			style={style}
			onMouseDown={focusInput}>
			{hasLeftNodes && (
				<div className="absolute left-2 z-10 flex items-center gap-1 pointer-events-none">{leftNodes}</div>
			)}

			<ThemedTextField
				data-testid={dataTestId}
				ref={handleInputRef}
				style={{
					flex: 1,
					paddingLeft: hasLeftNodes ? "24px" : undefined,
					paddingRight: hasRightNodes ? "24px" : undefined,
				}}
				className="[&_.ui-text-field-root]:border-0"
				// The old wrapper focused the toolkit's inner input directly, which
				// does not select the text.
				selectOnFocus={false}
				{...restProps}
			/>

			{hasRightNodes && (
				<div className="absolute right-2 z-10 flex items-center gap-1 pointer-events-none">{rightNodes}</div>
			)}

			{/* Absolutely positioned focus border overlay */}
			<div className="absolute top-0 left-0 size-full border border-vscode-input-border group-focus-within:border-vscode-focusBorder rounded"></div>
		</div>
	)
}

export const DecoratedVSCodeTextField = forwardRef(VSCodeTextFieldWithNodesInner)
