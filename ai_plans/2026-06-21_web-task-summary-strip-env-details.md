# Web task summary: show strictly the user query, fold the environment block

Date: 2026-06-21
Area: self-hosted-cloudapi web view (task list + task detail)

## Problem

The task summary/title in the cloud web view shows machine-generated framing the
user never typed — e.g. "Current Mode / code". Root cause, proven from real data:

The first user turn that reaches the cloud arrives in Roo Code's **API-prompt
form**, not the clean UI text. `api_conversation_history.json` first user message:

```
<user_message>
uruchom wszystkie testy w langgrapha
</user_message> <environment_details>
# VSCode Visible Files
...
# Current Mode
<slug>code</slug>
<name>💻 Code</name>
<model>unsloth/GLM-5.2-GGUF:UD-Q3_K_XL</model>
...
</environment_details>
```

`_derive_title()` ([routers/web.py](../self-hosted-cloudapi/src/routers/web.py))
takes the first text-bearing message verbatim, so the `<user_message>` wrapper and
the `<environment_details>` block (mode, open tabs, file tree, cost…) bleed into
the title. The same raw text renders in the conversation body with no way to
separate the human query from the machine appendix.

## Fix

Treat the wrapped form as what it is: human query + machine appendix.

### Backend — `_derive_title` (routers/web.py)

Add `_strip_task_wrappers(text)`:

1. Remove `<environment_details>…</environment_details>` (also the trailing,
   unclosed case).
2. Unwrap the human message tag — `<user_message>` / `<task>` / `<feedback>` — to
   its inner content.
3. Plain text (already clean) passes through unchanged.

`_derive_title` runs each candidate message through it before taking the first
non-empty line. Covers both the task list and the detail-page `<h1>`.

### Frontend — render.js conversation body

Add `userContentHtml(text)`: split off the `<environment_details>` block, unwrap
the message tag, render the clean query as markdown, and append the environment
block as a **collapsed `<details>`** ("Environment details") so the full original
is one click away — satisfying "unfold to full length". Applied to the text /
user_feedback / user_feedback_diff rows. No tags present → identical to today.

### CSS — app.css

Minimal styling for `details.env-details` (muted summary, monospace body).

## Tests

`tests/test_web_and_share.py`: a backfill whose first message is the wrapped
API-form turn — assert the rendered list/detail title is the bare query
("uruchom wszystkie testy w langgrapha"), with no `environment_details` / `Current
Mode` / `<user_message>` leakage.

## Out of scope

- Message role classification (the initial task currently renders under the
  "Assistant" label) — separate concern, not touched here.
- Title length cap stays at 100 chars; the full prompt is now visible in the
  conversation body.
