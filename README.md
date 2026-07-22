# LumaShell

Szybki, konfigurowalny terminal dla Windows oparty na Electronie — z SSH, portami
szeregowymi, protokołami sieciowymi, menedżerem plików SFTP, agentem AI i systemem wtyczek,
które naprawdę rozszerzają aplikację.

> **Status:** wydanie 1.0.0 (instalator NSIS + wersja portable, niepodpisane). Gałąź `main`
> zawiera prace po 1.0 — poprawki z użytkowania i **Plugin API v2**.

## Co potrafi

### Terminal

* powłoki wykrywane automatycznie: Windows PowerShell, Wiersz polecenia, Git Bash, WSL,
* renderowanie xterm.js na **WebGL** (z cichym zejściem na canvas, gdy GPU nie współpracuje),
* podział paneli w pionie i poziomie z przeciąganą granicą — **sesje przeżywają podział**
  i zamknięcie sąsiada (decyzja D6),
* zakładki z przeciąganiem, odtwarzanie układu po restarcie, paleta komend (Ctrl+Shift+P),
* otwieranie terminala **w wybranym katalogu** (także dla Codex CLI i Claude Code),
* zapis sesji do pliku, makra portu szeregowego, podgląd hex i znaczniki czasu.

### Połączenia

| Rodzaj | Szczegóły |
| --- | --- |
| SSH | hasło / klucz / agent, host pośredniczący (jump), przekierowanie portów, known_hosts z TOFU, automatyczne wznawianie |
| SFTP | pełny menedżer plików: zaznaczanie wielu, kopiowanie, przenoszenie, usuwanie rekurencyjne, uprawnienia, transfery katalogów z postępem, przeciąganie plików z pulpitu |
| Porty COM | konfiguracja ramki, monitor hex, znaczniki czasu, makra |
| Sieć | TCP, TLS, Telnet (z negocjacją IAC), WebSocket, UDP |
| Kontenery | Docker i Kubernetes przez owijkę `exec` w PTY |

### Wygląd

Ciemno-zielony styl glass z acryliciem, edytor motywów (kolory, zaokrąglenia, rozmycie,
tapeta), motywy wrzucane jako pliki `.json` do katalogu użytkownika.

### Agent AI

* dostawcy: OpenAI, Anthropic, model lokalny (Ollama / LM Studio) i własny endpoint,
* czat ze strumieniowaniem, kontekst z terminala (zaznaczenie, ostatnie wyjście, plik),
* narzędzia: odczyt bez pytania, **akcje dopiero po Twojej zgodzie**, pełny dziennik działań,
* limity autonomii: kroki, akcje, czas i budżet tokenów,
* Codex CLI i Claude Code uruchamiane jako sesja terminala — na Twoje konto, bez klucza API
  (aplikacja nie dotyka ich tokenów).

**Klucz API nigdy nie wraca do interfejsu** — mieszka w procesie głównym, zaszyfrowany
przez DPAPI (`safeStorage`); renderer dostaje wyłącznie informację, czy klucz jest ustawiony.

## Wtyczki (Plugin API v2)

Wtyczka **rozszerza aplikację**, a nie tylko dokłada wpis do palety:

* działa we **własnym procesie** z pełnym Node — `fs`, `net`, `child_process`, własne
  `node_modules` i paczki npm,
* dokłada komendy, powiadomienia, **elementy paska statusu**, **widoki-drzewa jako zakładki**
  i **własne strony (webview)** z dowolnym interfejsem,
* czyta i zapisuje terminal, otwiera sesje w wybranym katalogu, ma trwały magazyn,
* `kill()` daje realne wyłączenie, awaria jednej wtyczki nie dotyka pozostałych,
  a przeładowanie nie wymaga restartu aplikacji.

**Uczciwie o bezpieczeństwie.** Wtyczka `runtime: "node"` to program uruchomiony na Twoim
koncie: pliki, sieć i uruchamianie procesów **nie są** i nie mogą być przez LumaShell
ograniczone (zmierzone: model uprawnień Node w `utilityProcess` nie działa). Dlatego takich
uprawnień świadomie **nie ma** w katalogu — lista uprawnień ma nie kłamać. Egzekwowane jest
to, co należy do aplikacji: terminal, zakładki, widoki, magazyn, narzędzia AI — wszystko
przez bramkę w procesie głównym. Wtyczka nie startuje bez Twojej świadomej zgody, a jej
narzędzia są niewidoczne dla agenta AI, dopóki nie włączysz osobnego przełącznika.

Pełne uzasadnienie z pomiarami: **[decyzja D7](docs/architecture/10-decyzje.md)**.

### Wtyczki w repozytorium

| Wtyczka | Co pokazuje |
| --- | --- |
| `discord-rpc` | Discord Rich Presence — nazwa zakładki i czas sesji w statusie; cały transport to `node:net`, zero API „do gniazd" po stronie aplikacji |
| `file-explorer` | drzewo plików jako zakładka + edytor tekstu w webview, terminal w wybranym folderze |
| `toolbox` | narzędzie dla agenta AI |
| `hello`, `probe-node` | minimalne przykłady i sonda diagnostyczna środowiska |

### Pisanie własnej wtyczki

1. Skopiuj `packages/create-luma-plugin/szablon` do `%APPDATA%\lumashell\plugins\`
2. Zmień `id` w `plugin.json`
3. **Wtyczki → Odśwież**, włącz przełącznikiem

Żadnego kroku budowania — to zwykły CommonJS, a podpowiadanie w edytorze daje
`packages/plugin-api`. Szczegóły: [Plugin API](docs/plugin-api/).

## Uruchomienie

```bash
npm install
npm run dev            # tryb deweloperski
npm run build          # zbudowanie do out/
npm run dist           # instalator NSIS + wersja portable w release/
```

Sprawdzone na Node 24 i Windows 11. Moduły natywne (node-pty, serialport, ssh2) korzystają
z prebuildów N-API — `npmRebuild` jest wyłączony celowo.

> Aplikacja jest **niepodpisana**: przy pierwszym uruchomieniu SmartScreen pokaże
> ostrzeżenie („Więcej informacji" → „Uruchom mimo to").

## Testy

```bash
npm run test:unit          # drzewo paneli
npm run test:manifest      # walidacja manifestu wtyczek
npm run test:security      # granice IPC, sekrety, walidacja ładunków
npm run test:agent         # pętla agenta AI: limity, przerwanie, budżet
npm run test:integration   # SSH na serwerze w pamięci procesu
npm run test:net           # TCP/TLS/Telnet/WebSocket/UDP
```

Testy E2E (`tests/e2e/`) sterują **działającą aplikacją** przez DevTools Protocol — także
w wersji spakowanej. Uruchom aplikację z `--remote-debugging-port=9222`, potem np.:

```bash
node tests/e2e/plugin-views.e2e.mjs
node tests/e2e/discord-rpc.e2e.mjs     # stawia własny serwer na potoku Discorda
node tests/e2e/sftp.e2e.mjs            # serwer SFTP w pamięci procesu testu
```

Testy nie udają, że sprawdziły: gdy warunek jest niespełniony (np. potok Discorda zajęty
przez prawdziwego Discorda), test mówi o tym i kończy się bez wyniku.

## Dokumentacja

Pełny plan i decyzje: **[docs/README.md](docs/README.md)**

* [Architektura](docs/architecture/) — założenia, warstwy, transporty, UI, wydajność,
  pakowanie, **rejestr decyzji** (z pomiarami i odrzuconymi wariantami)
* [Plugin API](docs/plugin-api/) — manifest v2, uprawnienia, izolacja, narzędzia agenta
* [Bezpieczeństwo](docs/security/) — model procesów, sekrety, polityka agenta, audyt

## Stos

Electron 43 · TypeScript 7 · React 19 · Vite 7 · Zustand 5 · SCSS · xterm.js (WebGL) ·
node-pty · ssh2 · serialport

## Priorytety

1. Szybkość działania terminala
2. Stabilność połączeń
3. Bezpieczeństwo procesu Electron — i **mówienie wprost**, gdzie kończą się gwarancje
4. Ograniczenie zużycia pamięci
5. Pełna personalizacja
6. Spójny ciemno-zielony styl glass
7. System wtyczek, który realnie rozszerza aplikację

## Licencja

MIT
