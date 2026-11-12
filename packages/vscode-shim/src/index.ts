/**
 * @tumble-code/vscode-shim
 *
 * A VSCode API mock for running the extension bundle in the Node.js CLI.
 *
 * @packageDocumentation
 */

export { createVSCodeAPIMock as createVSCodeAPI } from "./api/create-vscode-api-mock.js"
export { setRuntimeConfig, setRuntimeConfigValues } from "./api/WorkspaceConfiguration.js"
export type { IExtensionHost, ExtensionHostEventMap } from "./interfaces/extension-host.js"
export { setInputBoxHandler } from "./api/inputBoxHandler.js"
export { setModalMessageHandler, type ModalMessage } from "./api/modalMessageHandler.js"
export { setLogger } from "./utils/logger.js"
