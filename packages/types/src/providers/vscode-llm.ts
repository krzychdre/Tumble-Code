// No default model: the settings require a model selector, and without one the
// handler runs the first model VS Code returns, which the settings cannot know.
// The handler reads the family's live limits from the selected model, so there
// is no static model table here.
export const vscodeLlmDefaultModelId = ""
