# LLM exchange recording and the clean training dataset

Date: 2026-10-02
Branches: `feat/llm-exchange-recording` (extension, cloud client, types; off `main` at 030a56ff9) and
`feat/cloud-dataset-export` (self-hosted cloud, stacked on the first; only this plan file overlaps).

## Why

Owner, 2026-10-02 (translated): "I want to be able to generate a dataset from the conversations between Tumble
Code and the LLM. For that I also need the exact request that was sent to the model. You may store the context
incrementally, but the report must allow a full reconstruction. In effect we will want to order a dataset export
that filters out broken tool calls (a clean dataset) for post-training a student. Think through the anonymization
mechanism."

What already exists does not cover it:

- `task_messages` (task sync) are the UI rows (`ClineMessage`), not the API conversation: no system prompt, no tool
  definitions, tool calls only as rendered rows, no reasoning in the form the model produced it.
- Error reports (#756/#758) keep the tail of a failing request only (6 messages, 16000 characters each).

## Terms

- **Exchange**: one HTTP request to the model and its answer (one `attemptApiRequest` attempt). A retry is a new
  exchange with the same request.
- **Canonical request**: what `TaskApiLoop.attemptApiRequest` hands to `api.createMessage`: the system prompt, the
  tools array (OpenAI function format, as built by `buildToolsArray`), the conversation exactly as sent
  (`cleanConversationHistory`, Anthropic-style blocks) and the request parameters. Provider-neutral; the dataset is
  built from it.
- **Wire request**: the HTTP body the provider SDK actually sent, captured byte-exact through a `fetch` function
  passed to the SDK client. This is the "exact request". Present for the OpenAI-compatible providers, OpenAI
  Responses API providers and the Anthropic SDK providers; absent for Gemini/Vertex (`@google/genai`), Mistral,
  Bedrock and VS Code LM, where only the canonical request exists.

## Recording (extension)

### Gate (privacy)

Recording happens only when ALL of these hold:

1. signed in to the cloud and telemetry not switched off by the environment (the error-report gate,
   `CloudService.isErrorReportingEnabled()`);
2. the user switched recording on in the cloud (`/app/dataset`, stored server-side, read through
   `GET /api/llm-exchanges/config`, cached 5 minutes per session token).

Default: OFF. A recorded exchange carries the full system prompt and every file the model read, so it is an
explicit opt-in. While the flag is still unknown (first request after start or sign-in) the exchange is captured
and the send step waits for the answer; when recording is off it is dropped. Signed out: nothing is built.

### What one exchange carries

`packages/types/src/llm-exchange.ts` is the wire contract (`POST /api/llm-exchanges`):

- identity: `id` (uuid), `baseId` (the exchange this one is a delta of), `taskId`, `parentTaskId`, `rootTaskId`,
  `sequence` (per task and session), `occurredAt`, `durationMs`, `retryAttempt`;
- context: provider, model id, mode, app version, editor, platform, workspace path;
- `request.system`, `request.tools`: blob references `{sha256, text?}`; the text is sent only the first time the
  chain sees that hash;
- `request.messages`: `{keep, append}`: keep the first `keep` messages of the base exchange's messages, then append;
  `request.messageCount` is the total, a cross-check;
- `request.params`: mode, tool protocol, temperature, max tokens, reasoning effort, tool choice, parallel calls;
- `request.wire` (optional): sanitized URL (origin and path, no query), format guess, `bodySha256` and `bodyBytes`
  of the original body, and the body's top-level fields in their original order: small values inline, large ones
  as blobs, the conversation array (`messages`, `input` or `contents`) as a `{keep, append}` delta against the base
  exchange's wire body;
- `response`: text, reasoning, tool calls with their RAW argument strings (as streamed, before any parsing), finish
  reason, usage;
- `status`: `completed`, `error` (with message, HTTP status and the error body) or `aborted`.

After the tools of a turn have run, a second, small record (`POST /api/llm-exchanges/outcome`) carries the outcome
of every tool call (from the existing tool-call probe of `ErrorReporter`: `ok`, `invalid_tool_call`, `tool_error`,
`diff_error`, `mistake_limit`, `rejected`) and the final usage (the background usage drain can finish after the
first record). A task stopped before its tools finish sends no outcome; the server then judges the calls from the
schema and the next request's tool results.

### Incremental storage and full reconstruction

Per task the recorder keeps the chain state of the last exchange the server ACCEPTED: its id, the per-message
hashes of the canonical messages, the per-element hashes of the wire conversation array and the blob hashes already
sent. The delta is computed in the send step (one promise chain per task, so records leave in order) against that
state. A chain restarts with a full snapshot (`baseId` absent, `keep` 0, all blob texts) when:

- the task has no chain in this session (first request, or a task resumed after a restart);
- the previous send failed after its retries (3 attempts, 2 s and 8 s apart): the server may lack the base;
- the chain reached 50 exchanges (bounds the reconstruction walk and heals any silent gap).

The serialized form (per-message JSON strings, the wire body string) is taken synchronously at capture time, so a
later mutation of the history (microcompact, condense) cannot change what is recorded.

The body is gzip-compressed (`Content-Encoding: gzip`); the server refuses more than 32 MB compressed or 128 MB
decompressed. The persistent retry queue is NOT used: it stores bodies in workspace state, which is wrong for
multi-megabyte records; the chain restart replaces it.

### Capture points

| Site                                                                       | Call                                  |
| -------------------------------------------------------------------------- | ------------------------------------- |
| `TaskApiLoop.attemptApiRequest`, after `captureApiRequest`                 | `beginExchange` (canonical request)   |
| same, the first `next()` of the provider stream                            | `runWithWireCapture` (wire request)   |
| same, first-chunk catch; `handleStreamError`                               | `failExchange` (error or aborted)     |
| `TaskApiLoop.processStream` abort branch                                   | `failExchange` (aborted)              |
| `finalizeStreamAndProcessResults`, after `assembleAndSaveAssistantMessage` | `completeExchange` (first record)     |
| same, after the `userMessageContentReady` wait                             | `finishExchangeTurn` (outcome record) |
| `ErrorReporter.finishToolCallProbe`                                        | `noteExchangeToolOutcome`             |

The streamed raw tool calls and the finish reason are read from `ErrorReporter`'s capture state (`peekCapturedAnswer`),
which is always active when recording is (its gate is a subset of this one).

### Wire capture

`src/api/providers/utils/wire-capture.ts`: an `AsyncLocalStorage` holding the current exchange's sink, and
`wireCaptureFetch`, passed as `fetch` to the OpenAI and Anthropic SDK clients and used by the Responses API core.
Outside a capture context (condensing, memory extraction, model lists, other extensions) it is a plain pass-through
to `globalThis.fetch`, resolved at call time, so the VS Code proxy patch still applies. Global `fetch` is not
patched: the extension host is shared with other extensions. A provider's internal retry overwrites the captured
body with the latest attempt.

## Server (self-hosted cloud)

### Storage

- `llm_exchanges`: id (client uuid, PK), user_id (FK CASCADE), organization_id, task_id (indexed, not a FK), base_id,
  sequence, occurred_at, created_at, provider, model_id, mode, workspace_path, status, finish_reason, input and output
  tokens, has_wire, `issues` (comma list from the static check at ingest, refreshed when the outcome arrives),
  `payload` (the record as received, deltas and all), `outcome` (JSON, nullable).
- `llm_blobs`: (user_id, task_id, sha256) PK, content, created_at. Per task, so deleting a task deletes its blobs
  without reference counting.
- `dataset_settings`: user_id PK, recording_enabled (default false), anonymization terms (one per line).
- Deleted with their task (`share_service.delete_tasks`) and with their user (CASCADE); a "Delete all recordings"
  button on the page. Not swept by the telemetry retention: a dataset is kept on purpose.

### Reconstruction (`services/exchange_reconstruction.py`)

All exchanges and blobs of one task, ordered by `occurred_at, sequence`; each exchange resolved from its base
(memoized; missing base or blob makes it and its dependants `incomplete`). The wire body is rebuilt in its original
key order and re-serialized like `JSON.stringify`; `wireVerified` is true when the SHA-256 matches the recorded one.

### Quality (`services/exchange_quality.py`)

Per exchange, a list of issues:

| Issue                 | When                                                                                | Default | Strict |
| --------------------- | ----------------------------------------------------------------------------------- | ------- | ------ |
| `api_error`           | status `error`                                                                      | drop    | drop   |
| `aborted`             | status `aborted`                                                                    | drop    | drop   |
| `empty_response`      | no text and no tool call                                                            | drop    | drop   |
| `truncated`           | finish reason `length` / `max_tokens`                                               | drop    | drop   |
| `interrupted`         | the extension appended "[Response interrupted by ...]" to the text                  | drop    | drop   |
| `malformed_arguments` | a tool call's raw arguments are not a JSON object                                   | drop    | drop   |
| `unknown_tool`        | a tool call names a tool the request did not offer                                  | drop    | drop   |
| `missing_parameter`   | a `required` parameter of the offered schema is absent                              | drop    | drop   |
| `tool_call_in_text`   | the text carries XML-style or `<tool_call>` markup for an offered tool              | drop    | drop   |
| `invalid_tool_call`   | the extension's probe said so (guards, unparsable, legacy shape)                    | drop    | drop   |
| `mistake_limit`       | the probe hit the repeated-call / mistake limit                                     | drop    | drop   |
| `tool_failed`         | outcome `tool_error`/`diff_error`, or (no outcome) the next tool_result is an error | keep    | drop   |
| `rejected`            | the user rejected the call                                                          | keep    | drop   |
| `incomplete`          | the exchange cannot be reconstructed                                                | drop    | drop   |

### Export (`services/dataset_export.py`, `GET /app/dataset/export.jsonl`)

OpenAI chat fine-tuning JSONL (`messages` + `tools`), the format TRL, Axolotl and the OpenAI fine-tuning API read.
Conversion of the canonical conversation mirrors `src/api/transform/openai-format.ts` (`tool_result` blocks become
`tool` messages before the user's text; images are dropped and replaced by `[image]`). Reasoning goes to
`reasoning_content` when asked for.

- `turns`: one line per clean exchange: system + the request's messages + the exchange's own answer (raw arguments,
  exactly as the teacher produced them). History assistant messages carry `"weight": 0`, the target `"weight": 1`.
- `trajectories`: one line per maximal chain of exchanges whose requests extend each other (a condense, truncation
  or microcompact starts a new chain): the last request's messages plus its answer; every assistant message produced
  by a clean exchange of the selected models gets weight 1 (its exact answer), every other one weight 0.

Filters: period, models (teacher), excluded workspaces (an exclusion list, so exchanges without a recorded
workspace are never dropped by accident), strictness, reasoning, metadata, sample limit. Text parts of a message
are joined into one string ("\n\n" between them): chat templates differ on lists, every one takes a string.
A required parameter counts as missing only when its schema does not allow null: strict-mode schemas list every
parameter as required and mark the optional ones nullable (`execute_command`'s `cwd`, `timeout`), and weak models
leave those out, which the extension accepts.

### Anonymization (`services/anonymizer.py`)

Raw data is stored as received (full reconstruction needs it); anonymization runs on export, ON by default. One
`Anonymizer` per export, so a value maps to the same pseudonym in every sample: a path in a tool call and in the tool
result that answers it stay consistent. It walks every string (system prompt, messages, tool definitions, tool call
arguments parsed as JSON and re-serialized; unparsable ones as text):

1. secrets: private key blocks, bearer tokens, `api_key=`/`password=`/`secret=`/`token=` pairs, `.env` lines whose
   key names a secret, URL credentials (`scheme://user:pass@`), JWTs, and the key shapes of `errorReportFormat.ts`
   (`sk-`, `AIza`, GitHub, Slack, AWS) -> `[REDACTED_SECRET]`;
2. paths: the workspace (from the record and the system prompt's `Current Workspace Directory:`) ->
   `/workspace/projectN`; the home directory (`Home Directory:`, `/home/x`, `/Users/x`, `C:\Users\x`, also JSON-escaped)
   -> `/home/user`, and the user name found there anywhere as a word -> `user`;
3. identity: the account's e-mail, full, first and last name and the e-mail's local part -> one pseudonym for the
   person (`Person1`), names matched only as names are written (`Alice`, `ALICE`, not `alice`, so an account
   named "Will" does not rewrite "will"; placeholder names such as "Test User" are skipped); the user's own terms
   (company, client, product names, saved on the page) -> case-preserving pseudonyms (`acme1`, `Acme1`, `ACME1`),
   matched with any separator (`QUB-IT` also finds `qub_it` and `qubit`); the workspace folder's name ->
   `projectN`;
4. e-mail addresses -> `userN@example.com` (`example.com/org/net` kept);
5. IPv4 addresses (loopback, `0.0.0.0` and version-like contexts kept) -> `192.0.2.N`; IPv6 (non-loopback) ->
   `2001:db8::N`;
6. checksummed numbers: PESEL (weights 1-3-7-9 and a plausible date), IBAN (mod 97), payment cards (a Visa,
   Mastercard, Amex or Discover prefix, 15 or 16 digits, Luhn; a 13-digit millisecond timestamp is not a card) ->
   placeholders;
7. phone numbers in international form (`+48 600 700 800`) -> `+00 000 000 000`.

Limits, said on the page: source code itself is not anonymized (a client's code stays the client's code), so the
workspace filter is the tool for that; names that are not in the account or the term list are not found.

The audit (`/app/dataset/audit`) runs the same export pipeline without writing samples and lists every replacement
(category, original, pseudonym, count), so the owner can check what leaves before handing a dataset over.

### Full reconstruction report

`GET /app/dataset/tasks/{task_id}.jsonl`: every exchange of the task, fully reconstructed and NOT anonymized: the
canonical request, the wire body (with `wireVerified`), the response, the outcome and the issues. Owner only, 404
otherwise.

## Implementation notes

- The `.env` rule only takes upper-case names and literal values: `api_key=os.environ[...]` and
  `TOKEN=$(cat f)` are code. A quoted or bare `key: value` pair is redacted only when the value looks like a
  secret (letters and digits, 8+ characters) or is a long quoted literal, so `password: string` survives.
- `js_json` matches Node's `JSON.stringify` number formatting (checked against Node: `1e-7`, `1e+21`, `0.000001`,
  large integral floats as shortest digits padded with zeros).
- `tests/conftest.py`'s `client` fixture now restores `app.dependency_overrides` after each test: several older
  tests leave a signed-in override behind, which made a "no token, 401" test pass or fail by file order.
- The phone layout test covers `/app/dataset`; five nav tabs needed narrower tab padding on phones.
- The three `/api/llm-exchanges` endpoints are exempt from the global per-IP rate limit (60 a minute on the live
  server): a fast model sends an exchange and an outcome every few seconds on top of the telemetry, and a refused
  upload costs a full snapshot. The Bearer token still guards them.

## Tests

- types: schema accepts the recorder's output, rejects a bad hash.
- cloud client: config fetch and cache, gzip body and headers, no fetch signed out, retries on 5xx and network
  failure, no retry on 4xx.
- `wire-capture`: pass-through outside a context, capture inside, last attempt wins, the context does not leak to a
  parallel call.
- recorder: gate (signed out: nothing built; flag off: dropped), full snapshot then deltas (`keep`, appended
  messages, blobs sent once), a mutation of the history after capture does not change the record, chain restart after
  a failed send and after 50 exchanges, wire delta, outcome record, never throws.
- server: ingest (auth, gzip, caps, idempotent), outcome update, config and toggle, reconstruction (chain, gap,
  wire verification), quality issues, both export formats, anonymizer (each rule, consistency, JSON-escaped paths),
  audit, deletion with the task and the user, migration drift.
