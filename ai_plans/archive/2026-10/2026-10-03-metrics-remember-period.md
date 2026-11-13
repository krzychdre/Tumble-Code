# Metrics page remembers the picked period

## Problem

/app/metrics always opened on "7 days". The period selector links carry
`?period=...`, but the nav link to the page does not, so every plain visit fell
back to `DEFAULT_PERIOD` and the reader's choice was lost.

## Change

- `src/routers/web_metrics.py`: `period` is optional. A valid `?period=` is a
  pick: it is used and stored in the `tumble_metrics_period` cookie (1 year,
  httponly, samesite=lax, path `/app/metrics`, Secure on https). Without a valid
  `?period=`, the cookie decides; without a valid cookie, the default does.
- Unknown `?period=` values are not a pick and do not overwrite the cookie.

## Why a cookie, not a user setting

Server-rendered page, no JS needed, no schema change. It is per browser, which
matches "until the user changes it" on that device.

## Test

`tests/test_web_metrics.py::test_metrics_page_remembers_the_picked_period`.

## Deploy

Needs the api image rebuild to go live.
