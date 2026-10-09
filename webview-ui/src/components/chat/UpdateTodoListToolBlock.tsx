import React, { useState, useEffect, useRef, useId } from "react"

import { cn } from "@/lib/utils"

import { ToolUseBlock, ToolUseBlockHeader } from "../common/ToolUseBlock"
import MarkdownBlock from "../common/MarkdownBlock"
import { BlockTimestamp } from "./BlockTimestamp"
import { useAppTranslation } from "@src/i18n/TranslationContext"

interface TodoItem {
	id?: string
	content: string
	status?: "completed" | "in_progress" | string
}

/**
 * @description
 * Editable Todo List component. Each time the todo list changes (edit, add, delete, status switch), the parent component will be notified via the onChange callback.
 * The parent component should synchronize the latest todos to the model in onChange.
 */
interface UpdateTodoListToolBlockProps {
	todos?: TodoItem[]
	content?: string
	/**
	 * Callback when todos change, be sure to implement and notify the model with the latest todos
	 * @param todos Latest todo list
	 */
	onChange: (todos: TodoItem[]) => void
	/** Whether editing is allowed (controlled externally) */
	editable?: boolean
	userEdited?: boolean
	/** Epoch-ms timestamp marking when this todo-list update started. */
	startTs?: number
	/** Epoch-ms timestamp marking when this todo-list update finished, if known. */
	endTs?: number
}

const STATUS_OPTIONS = [
	{ value: "", label: "chat:todo.status.notStarted" },
	{ value: "in_progress", label: "chat:todo.status.inProgress" },
	{ value: "completed", label: "chat:todo.status.completed" },
]

const genId = () => Math.random().toString(36).slice(2, 10)

// The default for a missing `todos` prop. It must be one shared array: the
// effect that copies `todos` into state is keyed on it, so a fresh `[]` per
// render would set state on every render and loop forever.
const NO_TODOS: TodoItem[] = []

/*
 * §2.8 (ai_plans/2026-09-27_ui-modernization.md): the block used 32 inline
 * style objects with hex colours that ignored the theme (a white delete
 * dialog in dark themes). They are classes now, coloured from the theme.
 */

type TodoDotStatus = "completed" | "in_progress" | "pending"

const dotStatus = (status?: string): TodoDotStatus =>
	status === "completed" || status === "in_progress" ? status : "pending"

const TODO_TEXT_COLOR: Record<TodoDotStatus, string> = {
	completed: "text-vscode-charts-green",
	in_progress: "text-vscode-charts-yellow",
	pending: "text-vscode-foreground",
}

const TODO_DOT_CLASS: Record<TodoDotStatus, string> = {
	completed: "bg-vscode-charts-green",
	in_progress: "bg-vscode-charts-yellow",
	pending: "border border-vscode-descriptionForeground",
}

/** The coloured square in front of a todo: filled green, filled yellow, or an empty outline. */
const TodoStatusDot = ({ status }: { status?: string }) => {
	const kind = dotStatus(status)
	return (
		<span
			data-todo-status={kind}
			aria-hidden="true"
			className={cn("inline-block size-2 shrink-0 mr-1.5 mt-[7px]", TODO_DOT_CLASS[kind])}
		/>
	)
}

/** A todo's text, coloured by its status. */
const TodoText = ({ todo }: { todo: TodoItem }) => (
	<span
		className={cn(
			"flex-1 min-w-0 font-medium text-base leading-[1.4] mr-1.5 px-[3px] py-px",
			TODO_TEXT_COLOR[dotStatus(todo.status)],
		)}>
		{todo.content}
	</span>
)

const LIST_ITEM = "flex items-start min-h-5 mb-0.5"
// Frame language (ai_plans/2026-10-09_ui-frame-language.md): compact 22px controls, outlined
// secondary buttons and inputs on the input frame, 2px corners.
const SMALL_BUTTON =
	"inline-flex items-center h-[22px] px-2 text-xs cursor-pointer border border-solid rounded-control transition-colors"
const PRIMARY_BUTTON =
	"bg-vscode-button-background hover:bg-vscode-button-hoverBackground text-vscode-button-foreground border-[var(--vscode-button-border,transparent)] disabled:cursor-not-allowed disabled:opacity-60"
const SECONDARY_BUTTON =
	"bg-surface hover:bg-surface-hover text-vscode-foreground border-input-frame hover:border-input-frame-hover"
const TEXT_INPUT =
	"flex-1 min-w-0 h-[22px] font-medium text-base mr-1.5 px-1.5 border border-solid border-input-frame hover:border-input-frame-hover rounded-control focus:outline focus:outline-1 focus:-outline-offset-1 focus:outline-vscode-focusBorder focus:border-vscode-focusBorder"

const UpdateTodoListToolBlock: React.FC<UpdateTodoListToolBlockProps> = ({
	todos = NO_TODOS,
	content,
	onChange,
	editable = true,
	userEdited = false,
	startTs,
	endTs,
}) => {
	const [editTodos, setEditTodos] = useState<TodoItem[]>(
		todos.length > 0 ? todos.map((todo) => ({ ...todo, id: todo.id || genId() })) : [],
	)
	const [adding, setAdding] = useState(false)
	const [newContent, setNewContent] = useState("")
	const newInputRef = useRef<HTMLInputElement>(null)
	const [deleteId, setDeleteId] = useState<string | null>(null)
	const { t } = useAppTranslation()
	const [isEditing, setIsEditing] = useState(false)
	const deleteLabelId = useId()

	// Automatically exit edit mode when external editable becomes false
	useEffect(() => {
		if (!editable && isEditing) {
			setIsEditing(false)
		}
	}, [editable, isEditing])

	// Check if onChange is passed, once: the ref makes later runs (a new onChange) return early.
	const onChangeCheckedRef = useRef(false)
	useEffect(() => {
		if (onChangeCheckedRef.current) {
			return
		}
		onChangeCheckedRef.current = true
		if (typeof onChange !== "function") {
			console.warn(
				"UpdateTodoListToolBlock: onChange callback not passed, cannot notify model after todo changes!",
			)
		}
	}, [onChange])

	// Sync when external props.todos changes
	useEffect(() => {
		setEditTodos(todos.length > 0 ? todos.map((todo) => ({ ...todo, id: todo.id || genId() })) : [])
	}, [todos])

	// Auto focus on new item
	useEffect(() => {
		if (adding && newInputRef.current) {
			newInputRef.current.focus()
		}
	}, [adding])

	// Edit content
	const handleContentChange = (id: string, value: string) => {
		const newTodos = editTodos.map((todo) => (todo.id === id ? { ...todo, content: value } : todo))
		setEditTodos(newTodos)
		onChange?.(newTodos)
	}

	// Change status
	const handleStatusChange = (id: string, status: string) => {
		const newTodos = editTodos.map((todo) => (todo.id === id ? { ...todo, status } : todo))
		setEditTodos(newTodos)
		onChange?.(newTodos)
	}

	// Delete (confirmation dialog)
	const handleDelete = (id: string) => {
		setDeleteId(id)
	}
	const confirmDelete = () => {
		if (!deleteId) return
		const newTodos = editTodos.filter((todo) => todo.id !== deleteId)
		setEditTodos(newTodos)
		onChange?.(newTodos)
		setDeleteId(null)
	}
	const cancelDelete = () => setDeleteId(null)

	// Add
	const handleAdd = () => {
		if (!newContent.trim()) return
		const newTodo: TodoItem = {
			id: genId(),
			content: newContent.trim(),
			status: "",
		}
		const newTodos = [...editTodos, newTodo]
		setEditTodos(newTodos)
		onChange?.(newTodos)
		setNewContent("")
		setAdding(false)
	}

	// Add on Enter
	const handleNewInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
		if (e.key === "Enter") {
			handleAdd()
		} else if (e.key === "Escape") {
			setAdding(false)
			setNewContent("")
		}
	}

	if (userEdited) {
		return (
			<ToolUseBlock>
				<ToolUseBlockHeader>
					<div className="flex items-center w-full">
						<span
							className="codicon codicon-feedback mr-1.5 text-vscode-charts-yellow"
							aria-hidden="true"
						/>
						<span className="font-bold mr-2 text-vscode-foreground">{t("chat:todo.userEdit")}</span>
						{typeof startTs === "number" && <BlockTimestamp startTs={startTs} endTs={endTs} live />}
						<div className="flex-grow" />
					</div>
				</ToolUseBlockHeader>
				{editTodos.length > 0 ? (
					<div className="overflow-x-auto max-w-full px-2 pt-1.5 pb-1 border-t border-frame">
						<ul className="m-0 pl-0 list-none">
							{editTodos.map((todo, idx) => (
								<li key={todo.id || idx} className={LIST_ITEM}>
									<TodoStatusDot status={todo.status} />
									<TodoText todo={todo} />
								</li>
							))}
						</ul>
					</div>
				) : (
					<div className="overflow-x-auto max-w-full px-2 pt-2 pb-2 border-t border-frame">
						<span className="text-vscode-descriptionForeground">{t("chat:todo.userEdits")}</span>
					</div>
				)}
			</ToolUseBlock>
		)
	}

	return (
		<>
			<ToolUseBlock>
				<ToolUseBlockHeader>
					<div className="flex items-center w-full">
						<span className="codicon codicon-checklist mr-1.5 text-vscode-foreground" aria-hidden="true" />
						<span className="font-bold mr-2 text-vscode-foreground">{t("chat:todo.listUpdated")}</span>
						{typeof startTs === "number" && <BlockTimestamp startTs={startTs} endTs={endTs} live />}
						<div className="flex-grow" />
						{editable && (
							<button
								type="button"
								onClick={() => setIsEditing(!isEditing)}
								aria-pressed={isEditing}
								className={cn(
									SMALL_BUTTON,
									"ml-2 focus-ring",
									isEditing ? PRIMARY_BUTTON : SECONDARY_BUTTON,
								)}>
								{isEditing ? t("chat:todo.done") : t("chat:todo.edit")}
							</button>
						)}
					</div>
				</ToolUseBlockHeader>
				<div className="overflow-x-auto max-w-full px-2 pt-1.5 pb-1 border-t border-frame">
					{Array.isArray(editTodos) && editTodos.length > 0 ? (
						<ul className="m-0 pl-0 list-none">
							{editTodos.map((todo, idx) => {
								return (
									<li key={todo.id || idx} className={LIST_ITEM}>
										<TodoStatusDot status={todo.status} />
										{isEditing ? (
											<input
												type="text"
												value={todo.content}
												placeholder={t("chat:todo.itemPlaceholder")}
												onChange={(e) => handleContentChange(todo.id!, e.target.value)}
												className={cn(
													TEXT_INPUT,
													"text-vscode-input-foreground bg-vscode-input-background",
												)}
												onBlur={(e) => {
													if (!e.target.value.trim()) {
														handleDelete(todo.id!)
													}
												}}
											/>
										) : (
											<TodoText todo={todo} />
										)}
										{isEditing && (
											<select
												value={todo.status || ""}
												onChange={(e) => handleStatusChange(todo.id!, e.target.value)}
												className="mr-1.5 h-[22px] border border-solid border-input-frame hover:border-input-frame-hover rounded-control bg-vscode-input-background text-vscode-input-foreground text-xs px-1 focus-ring">
												{STATUS_OPTIONS.map((opt) => (
													<option key={opt.value} value={opt.value}>
														{t(opt.label)}
													</option>
												))}
											</select>
										)}
										{isEditing && (
											<button
												type="button"
												onClick={() => handleDelete(todo.id!)}
												className="ml-0.5 inline-flex items-center justify-center size-[22px] p-0 border-none bg-transparent hover:bg-surface-hover rounded-control text-vscode-errorForeground cursor-pointer text-sm leading-none focus-ring"
												title={t("chat:todo.remove")}
												aria-label={t("chat:todo.remove")}>
												×
											</button>
										)}
									</li>
								)
							})}
							{adding ? (
								<li className="flex items-center mt-0.5">
									<span className="w-3.5 mr-1.5" />
									<input
										ref={newInputRef}
										type="text"
										value={newContent}
										placeholder={t("chat:todo.newItemPlaceholder")}
										onChange={(e) => setNewContent(e.target.value)}
										onKeyDown={handleNewInputKeyDown}
										className={cn(
											TEXT_INPUT,
											"text-vscode-foreground bg-transparent",
										)}
									/>
									<button
										type="button"
										onClick={handleAdd}
										disabled={!newContent.trim()}
										className={cn(SMALL_BUTTON, PRIMARY_BUTTON, "mr-1 focus-ring")}>
										{t("chat:todo.add")}
									</button>
									<button
										type="button"
										onClick={() => {
											setAdding(false)
											setNewContent("")
										}}
										className={cn(SMALL_BUTTON, SECONDARY_BUTTON, "focus-ring")}>
										{t("chat:todo.cancel")}
									</button>
								</li>
							) : (
								<li className="mt-0.5">
									{isEditing && (
										<button
											type="button"
											onClick={() => setAdding(true)}
											className={cn(
												SMALL_BUTTON,
												SECONDARY_BUTTON,
												"px-2 border-dashed focus-ring",
											)}>
											+ {t("chat:todo.addTodo")}
										</button>
									)}
								</li>
							)}
						</ul>
					) : (
						<MarkdownBlock markdown={content} />
					)}
				</div>
				{/* Delete confirmation dialog */}
				{deleteId && (
					<div
						className="fixed inset-0 z-[9999] flex items-center justify-center bg-[color-mix(in_srgb,var(--vscode-widget-shadow,black)_40%,transparent)]"
						onClick={cancelDelete}>
						<div
							role="alertdialog"
							aria-modal="true"
							aria-labelledby={deleteLabelId}
							className="z-[10000] min-w-[200px] px-5 py-4 bg-vscode-editorHoverWidget-background text-vscode-editorHoverWidget-foreground border border-solid border-frame-hover rounded-floating shadow-[0_2px_16px_var(--vscode-widget-shadow)]"
							onClick={(e) => e.stopPropagation()}>
							<div id={deleteLabelId} className="mb-3 text-sm">
								{t("chat:todo.deleteConfirm")}
							</div>
							<div className="flex justify-end gap-2">
								<button
									type="button"
									onClick={cancelDelete}
									className={cn(SMALL_BUTTON, SECONDARY_BUTTON, "px-2.5 focus-ring")}>
									{t("chat:todo.cancel")}
								</button>
								<button
									type="button"
									onClick={confirmDelete}
									className={cn(
										SMALL_BUTTON,
										"px-2.5 bg-vscode-errorForeground text-vscode-editor-background border-vscode-errorForeground focus-ring",
									)}>
									{t("chat:todo.delete")}
								</button>
							</div>
						</div>
					</div>
				)}
			</ToolUseBlock>
		</>
	)
}

export default UpdateTodoListToolBlock
