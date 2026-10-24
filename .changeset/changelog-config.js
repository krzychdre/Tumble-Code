// One bullet per changeset; scripts/format-changelog.mjs groups the bullets by their leading label.
const getReleaseLine = async (changeset) => {
	const text = changeset.summary
		.split("\n")
		.map((l) => l.trim())
		.filter(Boolean)
		.join(" ")
	return `- ${text}`
}

const getDependencyReleaseLine = async () => {
	return ""
}

const changelogFunctions = {
	getReleaseLine,
	getDependencyReleaseLine,
}

module.exports = changelogFunctions
