# Bypass colours, mode icons, docs sentences

Problems reported after the frame-accent change (#640):

1. Inactive auto-approve buttons stayed slate blue in bypass/autonomous. They now use the input background
   while `<html data-auto-approve=elevated>` is set (AutoApproveToggle).
2. The composer outline stayed blue: the unlayered `textarea:focus` rule in index.css beat the Tailwind
   utility. The rule now reads `--frame-accent` (falls back to focusBorder).
3. The Modes settings picker (trigger and list) still showed emoji. It now uses ModeIcon and modeLabel,
   as the composer selector does.
4. The "Learn about Using Modes / Customizing Modes" sentence and the "Learn more" link in Custom
   Instructions for All Modes are gone from the component and from all 18 locale files.
