# Settings — statyczny indeks wyszukiwania

Follow-up itemu 3 z [2026-09-27_p4-webview-lazy-loading.md](2026-09-27_p4-webview-lazy-loading.md):
P4 (PR #544) przeniosło zakładki Modes i MCP w SettingsView za bariery
`React.lazy`, ale samo otwarcie ustawień nadal pobierało oba chunki. Ten branch
usuwa tę regresję laziness i jednocześnie naprawia pozostałą po P4 duplikację
speców TelemetryClient.

## Kontekst i motywacja

Wyszukiwarka ustawień (`SettingsSearch`) potrzebuje indeksu etykiet sekcji i
pojedynczych settingów, po którym działa fzf. Do tej pory indeks powstawał
w runtime przez **cykliczne montowanie wszystkich zakładek** przy otwarciu
ustawień: w `SettingsView.tsx` stan `indexingTabIndex` w `useLayoutEffect`
przechodził przez `sectionNames` i ustawiał `renderTab = sectionNames[i]`,
przez co każda zakładka montowała się raz, jej komponenty `SearchableSetting`
rejestrowały się w registry (batchowane po rAF w `useSettingsSearch`), po czym
widok wracał do zakładki początkowej i renderował `SettingsSearch`.

Po P4 to miało dwie konsekwencje:

1. **Lazy loading Modes/MCP był martwy w praktyce** — cykl indeksowania
   montował obie zakładki od razu, więc chunki `ModesView` i `McpView`
   pobierały się przy każdym otwarciu ustawień. Spec
   `SettingsView.lazy-tabs.spec.tsx` musiał wtedy twierdzić tylko „co najwyżej
   raz", bo dokładnie jedno pobranie pochodziło z cyklu indeksowania.
2. **Wyszukiwarka była niedostępna w trakcie indeksowania** —
   `isIndexingComplete` bramkował render `SettingsSearch`, więc przez kilka
   renderów od otwarcia ustawień inputa po prostu nie było.

Statyczne treści (tytuły zakładek, nagłówki Modes/MCP, flagi eksperymentalne)
nie potrzebują montowania komponentów, żeby je zindeksować — ich klucze i18n są
znane w czasie kompilacji.

## Zmiana

### Nowy moduł `webview-ui/src/components/settings/settingsSearchIndex.ts`

Statyczny, deklaratywny indeks: tablica `STATIC_SEARCH_INDEX` wpisów
`{ settingId, section, labelKey, options? }` plus czysta funkcja
`resolveStaticSearchIndex(t, getSectionLabel)`, która rozwija klucze i18n do
etykiet (tania rekomputacja przy zmianie języka, trywialnie testowalna).
**47 wpisów** w trzech grupach:

- **19 tytułów zakładek** (`tab-*`) — po jednym na każdą sekcję z
  `sections`, klucze `settings:sections.<id>`;
- **12 nagłówków zakładki Modes** (`modes-*`) — nagłówki z realnych kluczy
  i18n samego `ModesView` (namespace `prompts:`): createNewMode, importMode,
  editModesConfig, editGlobalModes, editProjectModes, apiConfiguration,
  tools, roleDefinition, whenToUse, customInstructions, exportMode,
  globalCustomInstructions, systemPrompt.preview;
- **7 nagłówków zakładki MCP** (`mcp-*`) — klucze namespace `mcp:`:
  enableToggle, editGlobalMCP, editProjectMCP, refreshMCP, marketplace,
  networkTimeout, learnMoreEditingSettings;
- **5 flag eksperymentalnych** (`experimental-*`) — `ExperimentalSettings`
  mapuje je dynamicznie w runtime, ale id-y są stabilne (ExperimentKey), więc
  deklaratywne wpisy z kluczami `settings:experimental.<KEY>.name` są bezpieczne.

### `SettingsView.tsx` — koniec cyklu indeksowania

- Usunięte: `indexingTabIndex`, `initialTab`, `isIndexing`,
  `isIndexingComplete`, `tabTitlesRegistered` oraz `useLayoutEffect`
  przechodzący przez zakładki i blok `isIndexingComplete &&` przy
  `SettingsSearch`.
- `renderTab = activeTab` — montowana jest wyłącznie aktywna zakładka; tryb
  indeksujący nie istnieje, więc lazy chunki Modes/MCP nie pobierają się przy
  otwarciu ustawień.
- Wyszukiwarka renderuje się od pierwszego renderu (input dostępny od razu).
- Indeks finalny = **merge po `settingId`**: `Map` zbudowana z
  `resolveStaticSearchIndex(...)` (memoizowana na `t`/`getSectionLabel`),
  do której runtime wpis z registry nadpisuje wpis statyczny o tym samym id.
  Wpisy statyczne używają własnych prefixowanych id (`tab-*`, `modes-*`,
  `mcp-*`, `experimental-*`), runtime — setting-id przekazywanych przez
  komponenty; zbiory się nie kolizjonują, a ponieważ lazy zakładki Modes/MCP
  nigdy nie rejestrują się w runtime, nic się nie dubluje. Zakładki eager
  zachowują rejestrację `SearchableSetting` bez zmian.

### Spece

- `SettingsView.lazy-tabs.spec.tsx` — twierdzenia wzmocnione z „co najwyżej
  raz" do **0 wywołań fabryk przy starcie** (nic poza aktywną zakładką się
  nie montuje), dokładnie 1 po faktycznym otwarciu zakładki, nadal nigdy w
  module scope `SettingsView`; trzeci test (fallback `tab-loading` dla
  wiszącego chunka) bez zmian.
- Nowy `SettingsView.static-search-index.spec.tsx` (6 testów):
    1. input wyszukiwarki dostępny natychmiast (brak cyklu indeksowania);
    2. wynik z sekcji Modes znajdowany **bez montowania zakładki Modes**
       (`importCounts.modes === 0`);
    3. analogicznie dla MCP (`importCounts.mcp === 0`);
    4. nawigacja wynikiem Modes przełącza zakładkę i dopiero wtedy ładuje
       chunk (`importCounts.modes === 1`);
    5. analogicznie dla MCP;
    6. wpisy sekcji eager nadal trafiają do wyników (rejestracja runtime
       nietknięta).

## Usunięcie duplikatu TelemetryClient.spec

`webview-ui/src/utils/__tests__/TelemetryClient.spec.ts` (4 testy) był
podzbiorem kanonicznego `webview-ui/src/__tests__/TelemetryClient.spec.ts`
(11 testów). Plan P4 zapisał wtedy „both get updated, no deletions in this
scope" — deduplikacja została świadomie odroczona poza scope P4 i jest tu
wykonana: plik podzbioru usunięty, kanoniczny spec pozostaje jedynym źródłem.

## Weryfikacja (wyniki faktyczne)

- `cd webview-ui && npx vitest run src/components/settings` →
  **501 testów / 43 pliki pass** (w tym wzmocniony lazy-tabs i nowy
  static-search-index).
- `npx vitest run src/__tests__/TelemetryClient.spec.ts` → **11 pass**
  (kanoniczny spec pokrywa usunięty podzbiór).
- `npx tsc --noEmit` → 0 błędów.
- eslint + turbo lint (pre-commit) → pass.

## Resztki i znane pułapki

1. **Nagłówki Modes/MCP są indeksowane statycznie** — nowy nagłówek dodany w
   `ModesView`/`McpView` NIE pojawi się w wyszukiwarce, dopóki ktoś nie doda
   wpisu w `settingsSearchIndex.ts`. To świadomy trade: cena za to, że
   chunki nie pobierają się przy otwarciu ustawień.
2. **jsdom w webview-ui nie ma `requestAnimationFrame`** — registry
   (`useSettingsSearch`) batchuje rejestracje po rAF; w specach, które renderują
   prawdziwy registry (static-search-index.spec), trzeba stubować rAF na
   `setTimeout`, inaczej batch nigdy się nie spłukuje i runtime wpisy nie
   trafiają do indeksu.
3. **fzf highlight rozbija etykiety wyników na segmenty `<mark>`** —
   dostępna nazwa opcji traci whitespace między segmentami, więc
   `getByRole("option", { name })` wymaga regexów z `\s*` między słowami
   (np. `/Enable\s*auto-approval/` zamiast pełnego stringa).
4. **Scroll do `data-setting-id` w niemontowanej zakładce degraduje
   gracefully** — nawigacja wynikiem z sekcji Modes/MCP przełącza zakładkę i
   ładuje chunk; jeżeli element docelowy jeszcze nie istnieje (chunk w loc),
   scroll jest po prostu pomijany, zostaje samo przełączenie zakładki.

## Branche

`feature/settings-search-index` (56c11b527), off main — jedyny produktowy
przecięty plik to `SettingsView.tsx`, ale dotykamy dokładnie bloku
indeksowania usuniętego tutaj, więc branch nie koliduje z niczym na main.
