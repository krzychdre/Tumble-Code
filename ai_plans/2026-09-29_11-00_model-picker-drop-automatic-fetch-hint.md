# Model picker: drop the "automatically fetches the latest list of models" hint

## Problem
Under the model picker in Settings, a paragraph said that the extension fetches the
model list from the provider, recommended a default model and suggested searching
"free". The owner asked to remove it.

## Change
- `ModelPicker.tsx`: removed the paragraph (the `Trans` block), the now unused
  `Trans` and `Link` imports, and stopped destructuring `serviceName` / `serviceUrl`.
- Removed the `modelPicker.automaticFetch` key from all 18 `settings.json` locales.

## Not done on purpose
`serviceName` / `serviceUrl` are still passed by callers and still declared in the
props. Removing them would cascade into `getProviderServiceConfig` and the provider
descriptors; that is a separate cleanup.

## Verification
`ModelPicker` specs pass, eslint clean, all locale JSON files parse.
