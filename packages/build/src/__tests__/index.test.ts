// npx vitest run src/__tests__/index.test.ts

import { generatePackageJson } from "../index.js"

describe("generatePackageJson", () => {
	it("rewrites command/view IDs for the nightly variant while keeping the new manifest identity", () => {
		const generatedPackageJson = generatePackageJson({
			packageJson: {
				name: "tumble-code",
				displayName: "%extension.displayName%",
				description: "%extension.description%",
				publisher: "QUB-IT",
				version: "3.17.2",
				icon: "assets/icons/icon.png",
				contributes: {
					viewsContainers: {
						activitybar: [
							{
								id: "roo-cline-ActivityBar",
								title: "%views.activitybar.title%",
								icon: "assets/icons/icon.svg",
							},
						],
					},
					views: {
						"roo-cline-ActivityBar": [
							{
								type: "webview",
								id: "roo-cline.SidebarProvider",
								name: "",
							},
						],
					},
					commands: [
						{
							command: "roo-cline.plusButtonClicked",
							title: "%command.newTask.title%",
							icon: "$(edit)",
						},
						{
							command: "roo-cline.openInNewTab",
							title: "%command.openInNewTab.title%",
							category: "%configuration.title%",
						},
					],
					menus: {
						"editor/context": [
							{
								submenu: "roo-cline.contextMenu",
								group: "navigation",
							},
						],
						"roo-cline.contextMenu": [
							{
								command: "roo-cline.addToContext",
								group: "1_actions@1",
							},
						],
						"editor/title": [
							{
								command: "roo-cline.plusButtonClicked",
								group: "navigation@1",
								when: "activeWebviewPanelId == roo-cline.TabPanelProvider",
							},
							{
								command: "roo-cline.settingsButtonClicked",
								group: "navigation@6",
								when: "activeWebviewPanelId == roo-cline.TabPanelProvider",
							},
							{
								command: "roo-cline.accountButtonClicked",
								group: "navigation@6",
								when: "activeWebviewPanelId == roo-cline.TabPanelProvider",
							},
						],
					},
					submenus: [
						{
							id: "roo-cline.contextMenu",
							label: "%views.contextMenu.label%",
						},
						{
							id: "roo-cline.terminalMenu",
							label: "%views.terminalMenu.label%",
						},
					],
					configuration: {
						title: "%configuration.title%",
						properties: {
							"tumble-code.allowedCommands": {
								type: "array",
								items: {
									type: "string",
								},
								default: ["npm test", "npm install", "tsc", "git log", "git diff", "git show"],
								description: "%commands.allowedCommands.description%",
							},
							"tumble-code.customStoragePath": {
								type: "string",
								default: "",
								description: "%settings.customStoragePath.description%",
							},
						},
					},
				},
				scripts: {
					lint: "eslint **/*.ts",
				},
			},
			overrideJson: {
				name: "tumble-code-nightly",
				displayName: "Tumble Code Nightly",
				publisher: "QUB-IT",
				version: "0.0.1",
				icon: "assets/icons/icon-nightly.png",
				scripts: {},
			},
			// Rename only the internal roo-cline.* identifiers; the tumble-code.*
			// config property keys intentionally stay the same in the nightly
			// manifest (see the comment in apps/vscode-nightly/esbuild.mjs).
			substitution: ["roo-cline", "tumble-code-nightly"],
		})

		expect(generatedPackageJson).toStrictEqual({
			name: "tumble-code-nightly",
			displayName: "Tumble Code Nightly",
			description: "%extension.description%",
			publisher: "QUB-IT",
			version: "0.0.1",
			icon: "assets/icons/icon-nightly.png",
			contributes: {
				viewsContainers: {
					activitybar: [
						{
							id: "tumble-code-nightly-ActivityBar",
							title: "%views.activitybar.title%",
							icon: "assets/icons/icon.svg",
						},
					],
				},
				views: {
					"tumble-code-nightly-ActivityBar": [
						{
							type: "webview",
							id: "tumble-code-nightly.SidebarProvider",
							name: "",
						},
					],
				},
				commands: [
					{
						command: "tumble-code-nightly.plusButtonClicked",
						title: "%command.newTask.title%",
						icon: "$(edit)",
					},
					{
						command: "tumble-code-nightly.openInNewTab",
						title: "%command.openInNewTab.title%",
						category: "%configuration.title%",
					},
				],
				menus: {
					"editor/context": [
						{
							submenu: "tumble-code-nightly.contextMenu",
							group: "navigation",
						},
					],
					"tumble-code-nightly.contextMenu": [
						{
							command: "tumble-code-nightly.addToContext",
							group: "1_actions@1",
						},
					],
					"editor/title": [
						{
							command: "tumble-code-nightly.plusButtonClicked",
							group: "navigation@1",
							when: "activeWebviewPanelId == tumble-code-nightly.TabPanelProvider",
						},
						{
							command: "tumble-code-nightly.settingsButtonClicked",
							group: "navigation@6",
							when: "activeWebviewPanelId == tumble-code-nightly.TabPanelProvider",
						},
						{
							command: "tumble-code-nightly.accountButtonClicked",
							group: "navigation@6",
							when: "activeWebviewPanelId == tumble-code-nightly.TabPanelProvider",
						},
					],
				},
				submenus: [
					{
						id: "tumble-code-nightly.contextMenu",
						label: "%views.contextMenu.label%",
					},
					{
						id: "tumble-code-nightly.terminalMenu",
						label: "%views.terminalMenu.label%",
					},
				],
				configuration: {
					title: "%configuration.title%",
					properties: {
						"tumble-code.allowedCommands": {
							type: "array",
							items: {
								type: "string",
							},
							default: ["npm test", "npm install", "tsc", "git log", "git diff", "git show"],
							description: "%commands.allowedCommands.description%",
						},
						"tumble-code.customStoragePath": {
							type: "string",
							default: "",
							description: "%settings.customStoragePath.description%",
						},
					},
				},
			},
			scripts: {},
		})
	})
})
