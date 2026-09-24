import fs from "node:fs"
import path from "node:path"

/**
 * Workspace boundary rules (PKG-2).
 *
 * `no-relative-import-outside-package` reports a relative module specifier
 * that resolves outside the workspace of the file that writes it. The
 * workspace is the nearest directory, walking up from the file, that holds a
 * package.json, so the rule needs no per-package setup and cannot drift from
 * pnpm-workspace.yaml. A pattern-only `no-restricted-imports` cannot do this:
 * whether `../../x` escapes depends on how deep the file sits.
 *
 * Why it matters: `../../../packages/foo/src/bar` reaches into another
 * workspace's source behind the dependency graph, so pnpm does not link it,
 * turbo does not hash it into the importer's cache key and knip does not see
 * the dependency. Import the package by name instead.
 */

const packageRootCache = new Map()

function findPackageRoot(directory) {
	if (packageRootCache.has(directory)) {
		return packageRootCache.get(directory)
	}
	let root = null
	if (fs.existsSync(path.join(directory, "package.json"))) {
		root = directory
	} else {
		const parent = path.dirname(directory)
		root = parent === directory ? null : findPackageRoot(parent)
	}
	packageRootCache.set(directory, root)
	return root
}

const packageNameCache = new Map()

function packageLabel(packageRoot) {
	if (!packageNameCache.has(packageRoot)) {
		let name = packageRoot
		try {
			name = JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf8")).name ?? packageRoot
		} catch {
			// Unreadable package.json: fall back to the directory.
		}
		packageNameCache.set(packageRoot, name)
	}
	return packageNameCache.get(packageRoot)
}

function isRelative(specifier) {
	return specifier === "." || specifier === ".." || specifier.startsWith("./") || specifier.startsWith("../")
}

// Calls whose first argument is a module path: CommonJS require and the
// vitest / jest module mocking helpers.
const MODULE_PATH_CALLS = new Set([
	"require",
	"require.resolve",
	"vi.mock",
	"vi.doMock",
	"vi.unmock",
	"vi.doUnmock",
	"vi.importActual",
	"vi.importMock",
	"jest.mock",
	"jest.doMock",
	"jest.unmock",
	"jest.requireActual",
	"jest.requireMock",
])

function calleeName(callee) {
	if (callee.type === "Identifier") {
		return callee.name
	}
	if (
		callee.type === "MemberExpression" &&
		!callee.computed &&
		callee.object.type === "Identifier" &&
		callee.property.type === "Identifier"
	) {
		return `${callee.object.name}.${callee.property.name}`
	}
	return null
}

const noRelativeImportOutsidePackage = {
	meta: {
		type: "problem",
		docs: {
			description: "Disallow relative imports that resolve outside the importing file's workspace package",
		},
		schema: [],
		messages: {
			escapes:
				'"{{specifier}}" leaves the workspace package {{packageName}}. Import the other workspace by its package name (and declare it in package.json) instead of by relative path.',
		},
	},
	create(context) {
		const filename = context.physicalFilename ?? context.filename
		if (!filename || !path.isAbsolute(filename)) {
			return {}
		}
		const directory = path.dirname(filename)
		const packageRoot = findPackageRoot(directory)
		if (!packageRoot) {
			return {}
		}

		function check(node) {
			if (!node || node.type !== "Literal" || typeof node.value !== "string" || !isRelative(node.value)) {
				return
			}
			const target = path.resolve(directory, node.value)
			const relativeToRoot = path.relative(packageRoot, target)
			if (
				relativeToRoot === ".." ||
				relativeToRoot.startsWith(`..${path.sep}`) ||
				path.isAbsolute(relativeToRoot)
			) {
				context.report({
					node,
					messageId: "escapes",
					data: { specifier: node.value, packageName: packageLabel(packageRoot) },
				})
			}
		}

		return {
			ImportDeclaration: (node) => check(node.source),
			ExportAllDeclaration: (node) => check(node.source),
			ExportNamedDeclaration: (node) => check(node.source),
			ImportExpression: (node) => check(node.source),
			TSExternalModuleReference: (node) => check(node.expression),
			TSImportType: (node) =>
				check(node.argument?.type === "TSLiteralType" ? node.argument.literal : node.argument),
			CallExpression(node) {
				const name = calleeName(node.callee)
				if (name && MODULE_PATH_CALLS.has(name)) {
					check(node.arguments[0])
				}
			},
		}
	},
}

export const boundariesPlugin = {
	meta: { name: "@roo-code/config-eslint/boundaries" },
	rules: {
		"no-relative-import-outside-package": noRelativeImportOutsidePackage,
	},
}
