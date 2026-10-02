# read_artifact: offset/limit sent as text crash with "Received NaN"

## Symptom

While running the `summarize-news-sites` command (task `01a0fb41-5f14-7171-bf38-e9c0b8595a0c`), the chat showed:

```
Error reading artifact: The value of "size" is out of range. It must be >= 0 && <= 34359738367. Received NaN
```

The two failing calls in `api_conversation_history.json`:

```json
{"artifact_id": "cmd-1790921901363.txt", "offset": 0, "limit": "24KB"}
{"artifact_id": "cmd-1790921902002.txt", "offset": 0, "limit": "24KB"}
```

The model copied "24KB" from the tool description ("Defaults to the inline result budget (24KB)"). It recovered on the next turn with plain numbers, so the cost was one wasted round.

## What was happening

- `parseReadArtifactArgs` (`src/core/tools/toolArgParsers.ts`) passed `offset` and `limit` through raw. `read_file` already coerced its numbers with `coerceOptionalNumber`; `read_artifact` did not (the args snapshot even pinned "numbers as strings kept raw").
- `ReadArtifactTool.execute` clamps with `Math.max(1, Math.min(params.limit ?? max, max))`. `Math.min("24KB", 24576)` is `NaN`, and `NaN` survives the clamp.
- `readArtifact` then calls `Buffer.alloc(Math.min(NaN, ...))`, and Node throws the opaque range error, which the catch-all turned into "Error reading artifact: ...".
- The same hole existed for `offset`: `NaN < 0 || NaN >= totalSize` is false, so a text offset passed the offset check and crashed in the same place.

## Failure surface (before/after)

| Input | Before | After |
|---|---|---|
| `limit: "24576"` | `Math.min` coerces, works by accident | 24576 |
| `limit: "24KB"`, `"24kb"`, `"24 Kb"`, `"24KiB"`, `"24k"` | NaN crash | 24576 |
| `limit: "1.5MB"`, `"2mib"` | NaN crash | 1572864, 2097152 (then clamped to the budget) |
| `limit: "300 bytes"`, `"300B"` | NaN crash | 300 |
| `offset: "2kb"` | NaN crash | 2048 |
| `limit: 100.7` | fractional `Buffer.alloc` | 100 |
| `limit: "abc"`, `"24 GB"`, `"-5"` | NaN crash | `Invalid limit: "abc". offset and limit are byte counts: pass a plain number such as 24576 ...` |

## Fix

1. `coerceOptionalByteCount` in `toolArgParsers.ts`: numbers are floored; strings matching `^\d+(\.\d+)?\s*[a-z]*$` (case-insensitive) with a known unit (none, b, byte(s), k, kb, kib, m, mb, mib) become whole bytes. Units are binary (1 KB = 1024), matching the artifact headers and the 24 KB = 24576 default. Anything else is returned unchanged so the tool can reject it visibly instead of silently reading a different window.
2. `ReadArtifactTool.execute` rejects a defined `offset`/`limit` that is not a finite number before touching storage, with `recordFailure(..., { failTurn: true })` like the malformed-id path, and guidance naming 24576.
3. Tool description: `limit` and `offset` now say "as a plain number", and the default is written as 24576 bytes, so weak models see a numeric pattern to copy.

## Tests

- `toolArgParsers.spec.ts`: table of accepted spellings (mixed case, spaces, KiB/MiB, fractions) and of rejected ones left raw.
- `ReadArtifactTool.test.ts`: `limit: "24 GB"`, `offset: "abc"`, `limit: NaN` give `Invalid <name>`, mention 24576, never "out of range", and never open the file. Verified against `main`'s `ReadArtifactTool.ts`: the 3 new cases fail, they pass with the fix.
- `NativeToolCallParser.args-snapshot.spec.ts`: case renamed to "numbers as strings coerced", new "byte units coerced" case; snapshot updated.

## Notes

- GB and larger units are deliberately not accepted: the read window is capped by the inline budget (max 1 MB), so such a value is a model mistake worth a correction.
- Negative numbers keep the existing behaviour (offset: "Invalid offset" error; limit: clamped to 1).
