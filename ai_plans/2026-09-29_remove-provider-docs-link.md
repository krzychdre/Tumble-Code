# Remove the "Provider Docs" link from the provider settings

Branch `fix/remove-provider-docs-link`, from `origin/main` at `17a976ff6`.
Owner request 2026-09-29: the link next to "API Provider" (welcome screen and
settings) led to the original Roo Code docs (`docs.roocode.com/providers/...`),
which do not describe this fork. No new tests, by request.

## Change

- `ApiOptions.tsx`: the docs link, its `docs` memo and the now unused imports
  (`getProviderDescriptor`, `Link`, `buildDocLink`, `BookOpenText`) are gone;
  the "API Provider" label stays.
- `provider-descriptors.ts`: `docsSlug` had no other reader, so the field, its
  doc comment and all 19 values are removed. `docs/10-adding-things.md` no
  longer mentions it.
- `settings:providers.apiProviderDocs` removed from all 18 locales.
- Existing tests that asserted the link (`ApiOptions.spec.tsx` docs paths,
  the `docsSlug` expectation in `provider-descriptors.spec.ts`) are dropped.

## Not changed

Other `buildDocLink` links (MCP, code index, shell integration, context
menu, ...) still point at docs.roocode.com. Owner asked only for this one.

## Verification

types: provider-descriptors spec 22 pass, tsc clean. webview: ApiOptions,
static search index and welcome specs 54 pass, tsc and eslint clean, unused
i18n keys 0. knip clean.
