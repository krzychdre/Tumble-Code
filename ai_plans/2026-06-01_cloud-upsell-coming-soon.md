# Cloud upsell: trim benefits + "coming soon / self-host" note

Date: 2026-06-01

## Goal

On the "Try Tumble Code Cloud" screen (shown in both `CloudUpsellDialog` and `CloudView`),
remove three benefit bullets and add a note that the feature is coming soon and will allow
self-hosting the cloud backend. Update all i18n locales.

## Source of truth

`renderCloudBenefitsContent(t)` in
[CloudUpsellDialog.tsx](../webview-ui/src/components/cloud/CloudUpsellDialog.tsx) is shared by:

- `CloudUpsellDialog` (the dialog)
- `CloudView` (line 229)

So a single edit to that function covers both surfaces.

## Bullets to remove

- `cloudBenefitProvider` — "Access free and paid models that work great with Tumble" (Brain icon)
- `cloudBenefitCloudAgents` — "Give tasks to autonomous Cloud agents" (Users2 icon)
- `cloudBenefitTriggers` — "Get code reviews on GitHub, start tasks from Slack and more" (Cable icon)

Remaining bullets: Walkaway (Router), Metrics (CircleDollarSign), History (FileStack).

## New copy

Add key `cloudComingSoon`:
"This feature is coming soon — and will let you self-host the cloud backend."

Rendered as a note below the benefits list (Clock icon).

## Changes

1. `CloudUpsellDialog.tsx`
    - Delete the 3 `<li>` items.
    - Remove now-unused icon imports: `Brain`, `Cable`, `Users2`.
    - Add `Clock` import and a coming-soon note element after the `<ul>`.
2. `en/cloud.json`: drop 3 keys, add `cloudComingSoon`.
3. 17 other locales: drop 3 keys, add translated `cloudComingSoon`.
4. Tests:
    - `CloudUpsellDialog.spec.tsx`: drop the 3 removed-key mocks + their `getByText` assertions; add `cloudComingSoon` mock + assertion.
    - `CloudView.spec.tsx`: drop the 3 removed-key mocks; add `cloudComingSoon` mock.

## Verify

`cd webview-ui && npx vitest run src/components/cloud/__tests__`
