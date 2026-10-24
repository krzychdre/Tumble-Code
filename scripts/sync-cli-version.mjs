#!/usr/bin/env node
/**
 * Gives the CLI the extension's version: both ship in one release under one
 * number. Runs in `pnpm changeset:version` after `changeset version` bumped
 * src/package.json (changesets ignores the CLI package).
 */

import { readFileSync, writeFileSync } from "node:fs"

const { version } = JSON.parse(readFileSync("src/package.json", "utf8"))
const path = "apps/cli/package.json"
writeFileSync(path, readFileSync(path, "utf8").replace(/"version": "[^"]*"/, `"version": "${version}"`))
