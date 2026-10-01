# Web search and web page rows that fit the chat

## Problem

`WebSearchToolRow` and `WebFetchToolRow` (`webview-ui/src/components/chat/rows/renderers/tool/SearchToolRows.tsx`)
put the whole payload into one bold sentence: "Tumble wants to search the web for `<code>q1, q2, q3</code>`".
The `<code>` span takes the textPreformat colour and a mono font, so three queries wrap to four to six
yellow lines, and the rows look nothing like the API request, thinking and MCP rows around them.

The sentence also lies after the fact: an auto-approved ask stays an ask, so a search that already ran
still reads "wants to search".

## Change

- Header like the API request row: icon, short bold title ("Web search" / "Web page"), `BlockTimestamp`
  with the duration up to the next message (none while partial), and for a search a pill with the query
  count (plural keys, Polish and Russian with one/few/many).
- Search: a card (editor background, like the read-file card) with one `<li>` per non-empty query,
  clamped to two lines, full text in the `title`. `splitSearchQuery` tints `site:`-style prefixes and
  upper-case `OR`/`AND` in the link colour and quoted phrases in the textPreformat colour.
- Page: a `<button>` card with host (no `www.`) and the mono path, an external-link icon, and a click
  that posts `openExternal`. `splitWebUrl` accepts http(s) only; anything else is shown as plain text
  with no link, because the URL comes from the model.
- The title no longer depends on ask/say, so the stale "wants to" goes away.
- i18n: `webSearch.{title,queryCount_*}` and `webFetch.{title,openInBrowser}` in all 18 locales; the old
  `wantsToSearch`/`didSearch`/`wantsToFetch`/`didFetch` keys are gone (nothing else used them).

## Tests

- `tool/__tests__/webToolText.spec.ts`: query splitting and URL splitting, including `javascript:` and
  `file:` rejection.
- `tool/__tests__/WebToolRows.spec.tsx`: one line per query with the count, header only while partial,
  click opens the page, non-http URL gets no button.
- Golden renders: the three web cases regenerated, plus "with operators" and "with a non-web URL".

Mockup that was approved: `/tmp/websearch-mockup/mockup.png` (not in the repo).
