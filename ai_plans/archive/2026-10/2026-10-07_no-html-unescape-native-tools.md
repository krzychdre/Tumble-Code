# Argumenty narzędzi zapisywane dosłownie, bez dekodowania encji HTML

**Status:** zrealizowane na gałęzi `fix/no-html-unescape-native-tools`.
**Zasady:** YAGNI (usuwamy obejście dla protokołu, którego już nie ma, zamiast je łatać), jedna prawda o
argumentach narzędzia: to, co model wysłał w JSON, trafia do pliku, do strategii diffów i do terminala bez zmian.

## Problem

`WriteToFileTool` i `ApplyDiffTool` wywoływały `unescapeHtmlEntities()` na treści pliku albo na diffie za
każdym razem, gdy identyfikator modelu nie zawierał słowa `claude`. `ExecuteCommandTool` robił to samo z
poleceniem dla każdego modelu i uruchamiał zdekodowaną wersję. Funkcja zamieniała `&lt;`, `&gt;`, `&quot;`,
`&#39;`, `&apos;`, `&#91;`, `&#93;`, `&lsqb;`, `&rsqb;` i `&amp;` na zwykłe znaki.

Skutek: każda treść, która zawiera encję HTML celowo, była psuta przed zapisem.

## Dowody (historia zadań użytkownika, `~/.config/Code/User/globalStorage/qub-it.tumble-code/tasks`)

- 276 wywołań `write_to_file` i 701 wywołań `apply_diff` w trybie natywnym. Encje HTML pojawiły się 49 razy
  i każde wystąpienie było zamierzoną, dosłowną treścią: atrybuty XML w plikach Tableau `.twb`
  (`value='&quot;Day&quot;'`), funkcja w Pythonie `s.replace('&gt;', '>')`, data URI w HTML (`&lt;svg`).
  Żadne wywołanie nie miało treści zakodowanej w całości.
- Zadanie `01a1160c` (GLM-5.3): model zapisał do pliku `.py`
  `for a, b in (("&gt;", ">"), ("&lt;", "<"), ("&quot;", '"'), ...)`. Na dysk trafiło
  `((">", ">"), ("<", "<"), (""", '"')`, czyli błąd składni, a kolejny `apply_diff` nie mógł już dopasować
  bloku SEARCH, bo model szukał tekstu z encjami, którego w pliku nie było.
- 29 nieudanych edycji plików `.twb`: blok SEARCH z `&quot;` po dekodowaniu nie pasował do pliku, który
  zawiera dosłowne `&quot;`.

## Przyczyna

Dekodowanie dodano w kwietniu 2025 (`ba5af6010` „Fix diff escaping issues”), gdy narzędzia były wywoływane
przez XML: model wpisywał argumenty między znaczniki XML i część modeli kodowała w nich `<`, `>` i `&`. W
styczniu 2026 obsługę XML usunięto (`8de9337e6` „remove XML tool calling support”). Od tej pory każde
wywołanie narzędzia to natywny JSON i argumenty przychodzą dosłownie, więc dekodowanie nie naprawia już
niczego, a psuje poprawną treść. Warunek „nie Claude” był heurystyką z ery XML (Claude nie kodował encji).

## Poprawka

- `src/core/tools/WriteToFileTool.ts`: usunięte wywołanie i import. Ścieżka podglądu strumieniowego
  (`handlePartial`) nigdy nie dekodowała, więc podgląd i zapis są teraz zgodne.
- `src/core/tools/ApplyDiffTool.ts`: usunięte wywołanie i import; diff idzie do strategii bez zmian.
- `src/core/tools/ExecuteCommandTool.ts`: usunięta zmienna `canonicalCommand`. Sprawdzenie `.rooignore`,
  parser składni, okno zatwierdzenia, lista wyjątków od limitu czasu i samo uruchomienie dostają polecenie
  dosłownie. Wcześniej uruchamiana była wersja zdekodowana, więc `sed 's/&gt;/>/g'` wykonywał się jako
  `sed 's/>/>/g'`.
- Pozostałe narzędzia edycji (`EditTool`, `EditFileTool`, `SearchReplaceTool`, `ApplyPatchTool`) nie
  dekodowały encji.
- `unescapeHtmlEntities` przestała być używana, więc usunięta z `src/utils/text-normalization.ts` razem z
  testami (knip i bramka eksportów używanych tylko w testach).
- Prompt systemowy i opisy narzędzi nie każą modelowi kodować encji HTML. `src/core/prompts/sections/skills.ts`
  koduje nazwy, opisy i ścieżki skilli jako XML w prompcie (to kierunek do modelu, nie argumenty od modelu);
  `edit_file` wprost mówi „NO ESCAPING”.

## Testy

- `writeToFileTool.spec.ts`: zamiast testów „unescapes ... for non-Claude models” i „skips ... for Claude
  models” dwa testy regresyjne dla modelu `glm-5.3`: dekoder z zadania `01a1160c` (`&gt;`, `&lt;`, `&quot;`,
  `&amp;`) i atrybut XML z `&quot;` trafiają do `diffViewProvider.update` dosłownie.
- `applyDiffTool.spec.ts`: diff z `&quot;`, `&gt;` i `&amp;` trafia do `diffStrategy.applyDiff` dosłownie;
  usunięty mock `text-normalization`.
- `executeCommandTool.spec.ts`: zamiast testów samej funkcji dekodującej test, że `validateCommand`,
  `askApproval` i `runCommand` terminala dostają polecenie z encjami bez zmian.
- Wszystkie cztery nowe testy failują na starym kodzie i przechodzą po poprawce.
