# cloudapi test: the "missing user ID" JWT expired before the test ran

Status: done, on branch `fix/cloudapi-test-jwt-minted-at-collection` (not merged yet)

Touched: `self-hosted-cloudapi/tests/test_route_boilerplate.py`

## Symptom

`test_extension_routes_refuse_a_bad_token[headers3-401-Invalid token: missing user ID]` failed in full cloudapi runs on
2026-10-02 (twice, runs of 115 s and 127 s on a loaded machine) and passed alone and in a 48 s run of clean `main`.
The response was `{"detail": "Invalid or expired token"}` instead of `"Invalid token: missing user ID"`.

## Cause

The token was built inside the `@pytest.mark.parametrize` list, so `_jwt()` ran when pytest imported the module during
collection, with `exp = now + 60`. Any run that reached the test more than 60 s after collection sent an expired
token, and `dependencies.py` rejected it as expired before it looked for the user ID.

Reproduced on clean `main` with a plugin that sleeps 61 s in `pytest_collection_finish`:
`PYTHONPATH=/tmp pytest -p sleep_after_collect "tests/test_route_boilerplate.py::test_extension_routes_refuse_a_bad_token"`
-> 1 failed with exactly that detail.

## Fix

The JWT case is now a lambda that the test calls, so the token is minted when the test runs. The same 61 s sleep
command passes (4 passed).
