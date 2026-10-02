import React from "react"
import { Link, Input } from "@src/components/ui"

import { type ProviderFormProps } from "./shared"

type QwenCodeProps = ProviderFormProps & {
	simplifySettings?: boolean
}

export const QwenCode: React.FC<QwenCodeProps> = ({ apiConfiguration, setApiConfigurationField }) => {
	const defaultPath = "~/.qwen/oauth_creds.json"

	const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		setApiConfigurationField("qwenCodeOauthPath", e.target.value)
	}

	const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
		// If the field is empty on blur, set it to the default value
		if (!e.target.value || e.target.value.trim() === "") {
			setApiConfigurationField("qwenCodeOauthPath", defaultPath)
		}
	}

	return (
		<div className="flex flex-col gap-4">
			<div>
				<label className="block w-full mt-1 leading-[normal]">
					<span className="block mb-0.5">OAuth Credentials Path</span>
					<Input
						value={apiConfiguration?.qwenCodeOauthPath || ""}
						type="text"
						onChange={handleInputChange}
						onBlur={handleBlur}
						placeholder={defaultPath}
					/>
				</label>

				<p className="text-xs mt-1 text-vscode-descriptionForeground">
					Path to your Qwen OAuth credentials file. Defaults to ~/.qwen/oauth_creds.json if left empty.
				</p>

				<div className="text-xs text-vscode-descriptionForeground mt-3">
					Qwen Code is an OAuth-based API that requires authentication through the official Qwen client.
					You&apos;ll need to set up OAuth credentials first.
				</div>

				<div className="text-xs text-vscode-descriptionForeground mt-2">
					To get started:
					<br />
					1. Install the official Qwen client
					<br />
					2. Authenticate using your account
					<br />
					3. OAuth credentials will be stored automatically
				</div>

				<Link
					href="https://github.com/QwenLM/qwen-code/blob/main/README.md"
					className="text-vscode-textLink-foreground mt-2 inline-block text-xs">
					Setup Instructions
				</Link>
			</div>
		</div>
	)
}
