# Pakowanie, aktualizacje i raportowanie błędów (Etap 8)

Jak z kodu powstaje aplikacja do rozdania i co się dzieje po wydaniu.

## Potok budowania

Dwa kroki, rozdzielone świadomie:

1. **`npm run build`** — electron-vite kompiluje `main`, `preload` i `renderer` do `out/`.
2. **`electron-builder`** — bierze `out/` + `resources/` + produkcyjne `node_modules` i tworzy
   instalator/portable w `release/`.

Skróty: `npm run dist` (pełne artefakty), `npm run dist:dir` (rozpakowana aplikacja do
szybkiej weryfikacji, bez instalatora).

Konfiguracja: `electron-builder.yml`. Cele dla Windows x64:

* **NSIS** — instalator z wyborem katalogu, skrótami na pulpicie i w menu Start,
* **portable** — pojedynczy `LumaShell-<wersja>-portable.exe`.

Ikona bierze się z `resources/icon.png` (electron-builder generuje z niego `.ico`).

## Moduły natywne

`node-pty`, `serialport` i `ssh2` dostarczają **prebuildy N-API**, które działają pod
Electronem bez przebudowy. Dlatego:

* `npmRebuild: false` — NIE uruchamiamy electron-rebuild/node-gyp (a ten i tak padał na
  spacji w ścieżce projektu i na skrypcie budowania winpty),
* `asarUnpack` wyciąga te moduły z archiwum asar — ładują pliki `.node` i uruchamiają procesy
  pomocnicze (ConPTY/winpty, pagent), których nie da się wczytać z wnętrza asara.

Zweryfikowane: spakowany `LumaShell.exe` startuje i tworzy sesję PTY (node-pty z
`app.asar.unpacked`).

## Automatyczne aktualizacje

`src/main/updater/auto-updater.ts` używa `electron-updater` (provider `github` z
`electron-builder.yml`). Działa **tylko w spakowanej aplikacji** (`app.isPackaged`) — w dev nie
ma pliku `app-update.yml`. Po starcie z krótką zwłoką sprawdza wydania, pobiera w tle i proponuje
restart.

Do pełnego działania trzeba **publikować wydania** na GitHub Releases
(`electron-builder --publish always` z `GH_TOKEN`) i najlepiej **podpisywać kod** — inaczej
Windows blokuje ciche aktualizacje. Bez wydań updater po prostu nic nie znajduje (bez błędu).

## Podpisywanie kodu — TODO wydania

Świadomie nieskonfigurowane, bo wymaga certyfikatu. Bez podpisu SmartScreen ostrzega przy
pierwszym uruchomieniu. Dodanie: `win.certificateFile` + hasło albo zmienne środowiskowe
`CSC_LINK` / `CSC_KEY_PASSWORD`.

## Raportowanie błędów

* **Proces główny** (`src/main/error-reporter.ts`) — handlery `uncaughtException` i
  `unhandledRejection` zapisują błąd ze stosem do `userData/logs/errors.log` (z rotacją) i nie
  pozwalają mu wywrócić aplikacji.
* **Renderer** (`src/renderer/components/ErrorBoundary.tsx`) — łapie błędy renderowania,
  zgłasza je do logu przez IPC i pokazuje bezpieczny ekran zamiast białej strony.
* **Menu Pomoc** — „Zgłoś problem" (otwiera formularz issue na GitHubie z wersją i systemem),
  „Otwórz logi" (odsłania katalog logów).

Wszystko lokalnie — **żadnej telemetrii bez zgody** (docs/security).

## Testy wydania

* `npm run test:security` — inwarianty bezpieczeństwa (izolacja, CSP, sekrety, walidacja),
* `npm run test:soak` — długa sesja/przepustowość transportu (stabilność pod obciążeniem),
* `npm run test:perf` — przepustowość PTY.
