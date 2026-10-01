# Cloud web panel: visual polish, second pass

Status: done (branch `feat/cloud-ui-polish-pass2`, PR open, not merged)

Follows `2026-10-01_23-30_cloud-web-visual-polish.md` (PRs #693, #698). That pass was correct but subtle; the owner
asked for a visibly nicer panel ("Nadal liczę na ładniejsze UI w chmurze"). Direction unchanged: polish the current
dark, technical, mono-accented style, same information architecture, all data kept, light theme and phone layout work.

## Touched files

- `self-hosted-cloudapi/src/web/static/app.css`
- `self-hosted-cloudapi/src/web/static/theme.js`
- `self-hosted-cloudapi/src/web/templates/base.html`, `tasks_list.html`, `task_detail.html`, `metrics.html`,
  `settings.html`
- Tests: `tests/test_web_task_list.py`, `tests/test_web_task_timeline.py`, `tests/test_web_light_theme.py`,
  `tests/test_browser_js.py`, `tests/browser/theme_checks.html`

## Problems (seen in /tmp/cloud-ui-shots/after/png, before this change)

1. Task list: `.task-link` had `grid-template-columns: minmax(0, 1fr) 8rem 9rem 4.5rem 4.5rem 5.5rem 5rem 5.5rem
8.5rem` (app.css, "Columns: title | project | model"), so at 1280px the title, the one thing a reader looks for,
   got about 190px ("Fix the flaky TaskHistorySto...").
2. Header: the nav was a boxed segmented control, the theme toggle a word in a 26px box, the user name bare text and
   Sign out another 26px box: three unrelated pieces next to a box.
3. Task page: the timeline rail was two buttons of different heights and loose bars on a hairline running to the
   window's bottom; no caption or legend. The sticky composer (`bottom: var(--s4)`) let the conversation show through
   the gap under it.
4. Typography: uppercase labels used 0.04, 0.07, 0.08 and 0.09em tracking; card headings were the same faint caption
   as the labels inside the card.
5. Metrics: coloured 2px top borders bent around the 12px card radius; the daily chart legend sat on its own line;
   the unfinished grade segment (`--surface-3`) was nearly invisible; on a phone, "where the tokens went" wrapped
   calls and cost under the next label, day labels ran together, the roughest-runs count floated mid-row.
6. Settings: user-visible em dashes in the switch descriptions.

## Fix

- List: project and model move into the title cell as a second line (`.cell-main` > `.cell-title` + `.cell-meta`).
  One `--task-cols` list (`minmax(0, 1fr) 4rem 4rem 5.5rem 5rem 6rem 7.5rem`) is shared by the header and the rows.
  The header's title label says "Task · project · model". Compact density keeps a row on one line (meta after the
  title). Row Delete is a square icon button (aria-label unchanged). Title 14px (`--t-row`).
- Top bar: nav links are tabs of the bar with a signal underline on the bottom edge; `.topbar-end` groups theme
  (icon button, 30px), the user (initial in a disc + name, divider) and Sign out at one height. theme.js draws an SVG
  icon per choice, keeps the word in an sr-only span and sets `data-choice`.
- Task page: rail gets a "Timeline" caption, swatches on the jump buttons, the track in a sunken well sized to its
  ticks (max 8px each, shrinks to 2px), a legend (`.tl-legend`, aria-hidden since every tick names itself), width
  clamped to the gutter. `.live-controls::after` paints `--bg` from the bar down to the window edge; the bar gets the
  lift shadow. Fold buttons sit right of the filter chips.
- Type: `--track-caps` for every uppercase label, `--control-h`/`--control-h-sm`/`--topbar-h` tokens, heavier page
  title, `.chart-title` one step brighter and heavier with a fixed height and its own flex line, `.card-head` for a
  title with a legend.
- Metrics: stat cards show their hue as a swatch before the label; daily chart legend on the heading line (the card
  is now the `.chart-combo` scope for the `:has` toggles); unfinished segment is a faint mix; phone fixes for the
  kind rows, day labels and the roughest-runs count.
- Settings: switch rows put the explanation on its own line (`.switch-hint`), no em dashes. Filters panel opens in
  a framed well. Sign-in outcome pages get a check or "!" mark; the connect steps are numbered in rings.

## Tests

- `test_every_column_has_a_header` updated deliberately: six figure headers plus the title header naming project and
  model.
- New: `test_the_title_gets_the_free_width_and_project_and_model_ride_under_it`,
  `test_the_composer_hides_the_rows_scrolling_under_it`, `test_the_timeline_says_what_its_ticks_mean`, a
  `--text` on `--surface-3` AA check (the initial disc) in both themes, an icon check in `theme_checks.html`
  (min checks 7 to 8).
- Ran: the whole `self-hosted-cloudapi/tests` (922 passed, 1 xfailed), browser harnesses really ran (Chrome present).

## Notes and caveats

- No new colour tokens; every new colour use reads existing tokens or `color-mix` of them.
- The first message of a task (the prompt, a `say: text`) is still labelled "Assistant" by render.js, while
  timeline.js already treats it as yours. Left alone (behaviour change, own item).
- Screenshots: `/tmp/cloud-ui-shots/pass2/png` (after), `/tmp/cloud-ui-shots/after/png` (before).
