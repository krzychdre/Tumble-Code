import { test } from "node:test"
import assert from "node:assert/strict"

import { formatChangelog } from "../format-changelog.mjs"

const OLDER = `## 1.1.0

Released 2026-10-24

### Fixed

- **Old fix.** Text.
`

test("rewrites the new changesets section into highlights and New / Improved / Fixed", () => {
	const text = `# Tumble Code Changelog

## 1.2.0

### Minor Changes

- New: **Tabs.** Several tabs.
- Highlights: Tabs and pins.
- Fixed: **Lost answer.** Kept now.

### Patch Changes

- Improved: **Faster.** Quicker.
- New: **Pins.** Pinned tasks.

${OLDER}`

	assert.equal(
		formatChangelog(text, "2026-11-02"),
		`# Tumble Code Changelog

## 1.2.0

Released 2026-11-02

Tabs and pins.

### New

- **Tabs.** Several tabs.
- **Pins.** Pinned tasks.

### Improved

- **Faster.** Quicker.

### Fixed

- **Lost answer.** Kept now.

${OLDER}`,
	)
})

test("leaves an already formatted first section alone", () => {
	const text = `# Tumble Code Changelog\n\n${OLDER}`
	assert.equal(formatChangelog(text, "2026-11-02"), text)
})

test("refuses an entry without a label", () => {
	assert.throws(
		() => formatChangelog("## 1.2.0\n\n### Patch Changes\n\n- **Faster.** Quicker.\n", "2026-11-02"),
		/without a/,
	)
})
