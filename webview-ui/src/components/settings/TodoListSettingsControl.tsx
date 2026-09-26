import React, { useCallback } from "react"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { LabeledCheckbox } from "@src/components/ui"

interface TodoListSettingsControlProps {
	todoListEnabled?: boolean
	onChange: (field: "todoListEnabled", value: any) => void
}

export const TodoListSettingsControl: React.FC<TodoListSettingsControlProps> = ({
	todoListEnabled = true,
	onChange,
}) => {
	const { t } = useAppTranslation()

	const handleTodoListEnabledChange = useCallback(
		(e: any) => {
			onChange("todoListEnabled", e.target.checked)
		},
		[onChange],
	)

	return (
		<div className="flex flex-col gap-1">
			<div>
				<LabeledCheckbox checked={todoListEnabled} onChange={handleTodoListEnabledChange}>
					<span className="font-medium">{t("settings:advanced.todoList.label")}</span>
				</LabeledCheckbox>
				<div className="text-vscode-descriptionForeground text-sm">
					{t("settings:advanced.todoList.description")}
				</div>
			</div>
		</div>
	)
}
