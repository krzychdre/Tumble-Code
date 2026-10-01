# CLI auth startup noise

## Problem

Running the installed CLI's OpenAI Codex auth path prints two unrelated startup
diagnostics before the command result:

- `dotenvx` reports that it injected zero variables from the release tarball's
  intentionally empty `.env` file.
- Node 22 emits `DEP0040` because the bundled `whatwg-url@5.0.0` dependency
  resolves `require("punycode")` to Node's deprecated built-in module.

The deprecation trace proves the runtime chain is
`@anthropic-ai/sdk@0.37.0 -> node-fetch@2.7.0 -> whatwg-url@5.0.0 -> punycode`.
The full extension bundle is loaded by the Codex auth adapter, so these eager
module side effects appear even though Codex auth does not use Anthropic.

## Fix

1. Pass dotenvx's supported `quiet: true` option while loading the optional
   extension `.env`. Parsing and injection remain unchanged, and dotenvx still
   reports errors; only the successful injection banner is disabled.
2. Add Punycode.js as an explicit extension dependency and configure esbuild to
   alias bare `punycode` imports to the package's `punycode/` entry point. The
   trailing slash is required because Node otherwise gives its built-in module
   precedence over the userland package.
3. Keep the existing Codex auth and extension-host warning suppression unchanged:
   this fixes the deprecated resolution itself rather than filtering `DEP0040`.

## Verification

- Extend the extension activation regression test to require quiet dotenvx
  configuration when `.env` exists.
- Build the extension and assert the generated bundle contains the userland
  Punycode.js implementation and no bare runtime `require("punycode")`.
- Run the installed Codex status path against the rebuilt release with
  `NODE_OPTIONS=--trace-deprecation`; output must contain neither the dotenvx
  banner nor `DEP0040`.
- Run the targeted extension test, CLI auth test, type checks, and build gates.
