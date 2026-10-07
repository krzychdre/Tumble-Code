# Argumenty narzędzi GLM sklejone z poprzednim argumentem (`recoverGluedToolArgs`)

**Status:** zrealizowane na gałęzi `fix/glm-tool-arg-leak` (rdzeń, testy jednostkowe).
**Zasady:** YAGNI (jedna deterministyczna naprawa ogona wartości, bez heurystyk dla wartości wielowierszowych),
OCP (lista parametrów pochodzi ze schematów narzędzi wysyłanych do modelu, nowe narzędzie nie wymaga zmian).

## Problem (z historii zadań, 2026-10-07)

Modele GLM-5.3 (profile „GLM-5.3-NVFP4-HIGH” i „GLM-5.3-Flash-NVFP4”, serwer vLLM/SGLang) zapisują wywołanie
narzędzia w szablonie czatu jako pary `<arg_key>NAZWA</arg_key><arg_value>WARTOŚĆ</arg_value>`, a parser narzędzi
serwera zamienia je na argumenty JSON. Gdy model napisze najpierw długi argument (`diff`), a potem `path`, parser
serwera czasem dokleja następny argument na koniec poprzedniej wartości. Wywołanie dociera wtedy jako
`{"diff": "...>>>>>>> REPLACE\npath</arg_key><arg_value>src/main.js"}`, `parseApplyDiffArgs` nie dostaje `path`,
`parseToolCall` zwraca `null`, a w historii zostaje częściowy podgląd i narzędzie odpowiada
„Missing value for required parameter 'path'”. Model powtarzał identyczne wywołanie do 3 razy; powtórzenia z
`path` na początku się udawały.

Skan wszystkich bloków `tool_use` w `~/.config/Code/User/globalStorage/qub-it.tumble-code/tasks/*/api_conversation_history.json`
(dowolna wartość tekstowa zawierająca `</arg_key>`, wszystkie narzędzia):

| Narzędzie / argument nośny | Kształt ogona                                    | Liczba | Zadania                |
| -------------------------- | ------------------------------------------------ | ------ | ---------------------- |
| `apply_diff` / `diff`      | `\npath</arg_key><arg_value>X` (bez `<arg_key>`) | 24     | `01a115db`             |
| `apply_diff` / `diff`      | `\n<arg_key>path</arg_key><arg_value>X`          | 2      | `01a0fe73`, `01a100a9` |
| `apply_diff` / `diff`      | `<arg_key>path</arg_key><arg_value>X` (bez `\n`) | 1      | `01a0fb50`             |

Razem 27, wyłącznie `apply_diff`, zawsze brakujący `path`, nigdy z końcowym `</arg_value>`. Odtworzone ścieżki:
`src/main.js` (13), `src/game/collectibles.js` (9), `shot-gem-ab.mjs` (2), `zdrowie/dziennik-kawy.md`,
`scripts/__tests__/find-test-only-exports.test.mjs`, `src/core/task/TaskLifecycle.ts`.

## Projekt

Nowy moduł `src/core/assistant-message/recoverGluedToolArgs.ts`, funkcja
`recoverGluedToolArgs(toolName, args)`, wywoływana w `NativeToolCallParser.parseToolCall` zaraz po
`JSON.parse`, czyli przed `parseArgs` danego narzędzia i przed każdą kontrolą wymaganych parametrów. Ścieżka
strumieniowa kończy się w `finalizeStreamingToolCall` → `parseToolCall`, więc obie drogi (strumień i starszy
kawałek `tool_call`) są objęte. Podgląd częściowy (`processStreamingChunk`) celowo zostaje bez zmian: wywołanie
nie jest jeszcze skończone, a gotowy blok i tak zastępuje podgląd. Naprawione `nativeArgs` trafiają też do
historii rozmowy, więc model widzi poprawne wywołanie.

Reguła (z końca wartości, powtarzana dla kilku sklejonych argumentów):

- ogon `[\n]<arg_key>NAZWA</arg_key><arg_value>WARTOŚĆ[</arg_value>]` albo `\nNAZWA</arg_key><arg_value>...`
  (bez otwarcia, wtedy NAZWA musi zaczynać wiersz), na samym końcu wartości;
- WARTOŚĆ jest jednym wierszem i nie zawiera znaczników szablonu;
- NAZWA jest parametrem tekstowym ze schematu tego narzędzia (`nativeTools`), różnym od argumentu nośnego,
  i brakuje jej w argumentach (brak, `null` albo pusty tekst);
- usuwany jest ogon razem z jednym poprzedzającym znakiem nowej linii (należy do szablonu); własne końcowe
  znaki nowej linii treści zostają.

Wszystko inne zostaje dosłownie: plik może naprawdę zawierać taki tekst, dlatego warunkiem jest brakujący,
znany parametr. Narzędzia MCP i narzędzia własne (bez schematu w `nativeTools`) nie są naprawiane.

## Testy

`src/core/assistant-message/__tests__/recoverGluedToolArgs.spec.ts`: trzy prawdziwe kształty plus wariant z
`</arg_value>` dla `apply_diff` (przez `parseToolCall`, sprawdza `nativeArgs` i `params`), zachowanie własnego
`\n` treści, inne narzędzia (`write_to_file`, `execute_command` z `cwd: null`, `search_files` z dwoma
argumentami), pusty parametr; negatywy: parametr już obecny, nieznana NAZWA, znaczniki w środku treści, NAZWA
jako część dłuższego słowa, brak `<arg_value>`, parametr nietekstowy (`timeout`), narzędzie bez schematu;
strumień: podgląd pokazuje surową wartość, gotowe wywołanie jest naprawione.

Odtworzenie na prawdziwych danych: wszystkie 27 zapisanych wejść przepuszczone przez `recoverGluedToolArgs`
dają poprawną ścieżkę i `diff` kończący się na `>>>>>>> REPLACE` (27/27). Żadna inna wartość w historiach nie
zawiera `</arg_key>`, więc fałszywych napraw na tych danych być nie może.
