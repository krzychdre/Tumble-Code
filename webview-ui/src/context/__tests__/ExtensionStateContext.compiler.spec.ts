// npx vitest run src/context/__tests__/ExtensionStateContext.compiler.spec.ts

import fs from "node:fs"
import path from "node:path"
import { createRequire } from "node:module"

// The provider reads the store client in its render body. Vitest does not run the React Compiler,
// so a render test passes even when the compiled build is broken: the compiler memoizes a
// `client.getValue()` or `client.getStore()` call on `client`, which never changes, and the
// context froze at the first render (the welcome view could not leave Anthropic). This spec
// compiles the provider with the same Babel and compiler options as vite.config.ts and checks the
// output instead.

const webviewRoot = path.resolve(__dirname, "../../..")
const providerFile = path.join(webviewRoot, "src/context/ExtensionStateContext.tsx")

async function compileProvider(): Promise<string> {
	const req = createRequire(path.join(webviewRoot, "package.json"))
	const babel = createRequire(req.resolve("@rolldown/plugin-babel"))("@babel/core")
	const result = await babel.transformAsync(fs.readFileSync(providerFile, "utf8"), {
		filename: providerFile,
		babelrc: false,
		configFile: false,
		parserOpts: { plugins: ["jsx", "typescript"] },
		// Keep in sync with the babel-plugin-react-compiler options in vite.config.ts.
		plugins: [[req.resolve("babel-plugin-react-compiler"), { target: "19" }]],
	})
	return result.code
}

describe("ExtensionStateContextProvider under the React Compiler", () => {
	it("does not memoize a store read on the store client", async () => {
		const code = await compileProvider()

		// The compiled provider must be compiled at all, or the check below proves nothing.
		expect(code).toMatch(/_c\(\d+\)/)
		expect(code).not.toMatch(/if \(\$\[\d+\] !== client\) \{\s*\w+ = client\.get(Value|Store)\(\)/)
	}, 30_000)
})
