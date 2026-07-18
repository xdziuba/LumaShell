# Roadmapa

Projekt ma dwie równoległe ścieżki: **terminal** (Etap 0–8) i **integrację AI** (Etap AI-0–AI-7).

## Ścieżka terminala

### Etap 0 — prototyp techniczny

* podstawowe okno Electron,
* prototyp stylu glassmorphism,
* terminal xterm.js,
* lokalny PowerShell przez node-pty,
* prototyp portu COM,
* prototyp połączenia SSH,
* pomiary czasu startu,
* pomiary pamięci,
* test intensywnego wyjścia terminala.

Celem jest sprawdzenie, czy aplikacja zachowuje płynność przy dużej ilości danych.

### Etap 1 — podstawowy terminal

* ✔ Electron, TypeScript, React,
* ✔ `@xterm/xterm` z rendererem WebGL,
* ✔ node-pty,
* ✔ PowerShell, CMD, WSL — dodatkowo Git Bash; wykrywane, nie zaszyte na sztywno,
* ✔ kopiowanie i wklejanie,
* ✔ zmiana rozmiaru,
* ✔ pierwszy motyw ciemno-zielony,
* ✔ podstawowe ustawienia — czcionka, rozmiar, odstępy, kursor, historia; trwałe
  i stosowane na żywo bez restartu sesji.

**Etap 1 zamknięty.**

> **Pułapki wykrywania powłok**, wszystkie potwierdzone na żywym systemie:
>
> * `wsl.exe -l -q` wypisuje wynik w **UTF-16LE**, nie w UTF-8,
> * rejestr **nie odróżnia** dystrybucji systemowych (`docker-desktop`) od użytkownika —
>   mają identyczne `Flags`, więc jedynym sitem jest nazwa,
> * Git Bash **nie leży w stałym miejscu względem `git.exe`** — PATH potrafi zawierać
>   `Git\cmd\git.exe` i `Git\mingw64\bin\git.exe` naraz, więc sztywne „dwa poziomy w górę"
>   trafia w próżnię.

### Etap 2 — workspace

* ✔ zakładki — wiele żywych sesji naraz, nieaktywne działają w tle,
* ✔ wiele sesji — powłoki lokalne i porty COM równolegle,
* ✔ profile — zapis i odtwarzanie sparametryzowanej sesji, trwałe w `profiles.json`,
* ✔ command palette (Ctrl+Shift+P) z wyszukiwaniem,
* ✔ skróty — Ctrl+T/W, Ctrl+Tab, Ctrl+1..9, Ctrl+, oraz Ctrl+Shift+E/O (podział),
* ✔ przywracanie sesji po restarcie — **tylko powłoki**, patrz niżej,
* ✔ podziały (pionowe/poziome) — pełne drzewo binarne, dowolne zagnieżdżenie,
  przeciągane granice, fokus panelu; logika drzewa w `core`, przetestowana jednostkowo,
* ✔ przeciąganie zakładek — zmiana kolejności drag & drop ze wskaźnikiem miejsca upuszczenia.

**Etap 2 zamknięty.** Poza zakresem świadomie zostały: wyszukiwanie w buforze terminala
(dochodzi z resztą funkcji terminala) oraz przenoszenie zakładek między oknami (wiele okien
to osobny temat). Podziały międzyokienne i quake mode należą do dalszych etapów UI.

> Profile Etapu 2 to podzbiór modelu z sekcji 10: powłoka + katalog roboczy albo port COM
> z prędkością. Pełny zestaw pól (zmienne środowiskowe, motyw, tagi, SSH) i graficzny
> edytor dochodzą w Etapach 3 i 5. Nazwa profilu to na razie etykieta zakładki — Electron
> nie ma `window.prompt`, a osobne okno dialogowe należy do edytora z Etapu 5.

> **Przywracanie sesji obejmuje wyłącznie sesje powłok.** Porty szeregowe są świadomie
> pomijane: automatyczne otwarcie portu przy każdym starcie przestawiłoby linie DTR/RTS
> i mogło zresetować podłączone urządzenie (docs/security/03-polityka-agenta.md), a samo
> urządzenie może być odpięte. Filtr działa przy zapisie — plik `workspace.json` nigdy nie
> zawiera zakładek COM. Port otwiera się ponownie świadomym kliknięciem lub z profilu.

### Etap 3 — SSH

* ✔ hasło,
* ✔ klucz prywatny (plik + hasło klucza),
* ✔ known hosts — model TOFU, wykrywanie zmiany klucza (MITM), pytanie użytkownika,
* ✔ SSH agent (obsługiwany; na maszynie testowej wyłączony, więc bez próby na żywo),
* ✔ keep-alive,
* ✔ magazyn poświadczeń przez safeStorage (DPAPI),
* ✔ reconnect — automatyczne wznawianie po zerwaniu, backoff wykładniczy, komunikat w terminalu,
* ✔ SFTP — przeglądarka plików na sesji SSH: listowanie, nawigacja, pobieranie, wysyłanie,
* ✔ port forwarding — lokalne przekierowania (-L) przez tunel SSH,
* ✔ jump host — łączenie przez bastion (ProxyJump), z osobną weryfikacją klucza bastionu.

**Etap 3 zamknięty.**

> SFTP działa na istniejącej sesji SSH (jedna sesja SFTP na połączenie, otwierana leniwie).
> Jump host i host docelowy mają **osobną** weryfikację klucza — dwa różne hosty, dwa
> odciski. Zdalne przekierowania (-R) i pełny menedżer tuneli to możliwe rozszerzenia
> w kolejnych etapach lub jako wtyczka.

> **Bezpieczeństwo poświadczeń.** Hasła i hasła kluczy nigdy nie przechodzą przez
> `SessionSpec` ani snapshot workspace'u — deskryptor połączenia z sekretami żyje ulotnie
> w procesie głównym, renderer dostaje tylko `connectionId`. Sesje SSH nie są przywracane
> po restarcie (jak porty COM). Zapis połączeń SSH jako trwałych profili (z sekretami w
> safeStorage) to kolejny krok tego etapu.

### Etap 4 — port szeregowy

* ✔ lista portów (z Etapu 0/2),
* ✔ konfiguracja transmisji — prędkość, bity danych/stopu, parzystość, RTS/CTS,
* ✔ widok tekstowy,
* ✔ widok hex — zrzut `hexdump -C` z wyrównaniem między porcjami,
* ✔ timestampy — prefiks `[HH:MM:SS.mmm]` na porcji,
* ✔ makra — gotowe komendy z wyborem zakończenia linii, trwałe,
* ✔ logowanie — zapis surowych bajtów sesji do pliku,
* wysyłanie plików,
* automatyczne ponowne połączenie.

> **Do potwierdzenia na żywym porcie.** Formater hex ma testy jednostkowe (10/10), a
> konfiguracja i wysyłanie — walidację i wpięcie przez typy. Renderowanie hex na żywym
> strumieniu szeregowym oraz wysłanie makra do urządzenia wymagają realnego portu i
> zostały świadomie pozostawione do ręcznej weryfikacji (bezpieczeństwo sprzętu:
> otwarcie portu przestawia DTR/RTS, makra wysyłają dane do urządzenia).
> Wysyłanie plików (XMODEM/raw) i auto-reconnect portu to pozostałe elementy etapu.

### Etap 5 — system motywów

* ✔ motywy JSON — model w `core`, mapowany na zmienne CSS na żywo,
* ✔ wbudowane motywy (Dark Green Glass, Midnight Blue, Amber CRT) + przełączanie,
* ✔ edytor motywów — kolory z podglądem na żywo, promień zaokrągleń, zapis jako własny,
* ✔ import i eksport (pliki JSON),
* ✔ zmiana akcentu (część edytora),
* ✔ ustawienia czcionek (z Etapu 1),
* konfiguracja szkła (blur/opacity),
* gradienty,
* tapety.

> Motyw jest stosowany przez zmienne CSS na `:root`, więc zmienia cały interfejs bez
> przeładowania; kolory terminala idą osobno do xterm (nie czyta CSS). Kolory z importu są
> **odkażane** przed wstawieniem do CSS (usuwane znaki składni), a motywów wbudowanych nie
> da się nadpisać. Konfiguracja szkła, gradienty i tapety to możliwe rozszerzenia edytora.

### Etap 6 — system wtyczek

* ✔ Plugin API v1 — komendy i powiadomienia przez most RPC,
* ✔ Plugin Host — izolowane, ukryte okno `sandbox:true` bez integracji Node (decyzja D2),
* ✔ manifest — walidacja niezaufanego manifestu, odsiewanie nieznanych uprawnień,
  ochrona ścieżki `main` przed wyjściem z katalogu wtyczki,
* ✔ system uprawnień — egzekwowany na granicy RPC w procesie głównym, nie w hoście,
* ✔ przykładowe rozszerzenia — wtyczka `hello` ładowana z `resources/plugins`,
* ✔ dokumentacja SDK — `docs/plugin-api/` (przegląd, uprawnienia i izolacja, narzędzia),
* instalowanie z pliku,
* włączanie i wyłączanie,
* automatyczne aktualizacje wtyczek.

**Etap 6 zamknięty w zakresie rdzenia.** Świadomie poza zakresem na teraz: menedżer wtyczek
(instalacja z pliku, włączanie/wyłączanie, aktualizacje) — to warstwa UI nad działającym już
runtime'em, dochodzi razem z resztą menedżera. Uprawnienia `terminal.read`/`terminal.write`
są w modelu i walidacji, a ich realne wpięcie w sesje przyjdzie z narzędziami agenta (ścieżka AI).

> **Izolacja D2 udowodniona end-to-end.** Test E2E przez DevTools Protocol sprawdza na
> żywym oknie hosta, że `require`, `module` i `process` są **niedostępne**, a jedynym oknem
> na świat jest most `window.pluginHost`. Kod wtyczki uruchamia się przez `new Function`
> (stąd `unsafe-eval` w CSP hosta), ale bez Node nie wyjdzie z piaskownicy. Każdą realną
> zdolność host deleguje przez RPC do procesu głównego, który dopiero tam sprawdza, czy
> wtyczka zadeklarowała stosowne uprawnienie i czy komenda jest w `contributes.commands`.

### Etap 7 — dodatkowe protokoły

* ✔ TCP i UDP — surowe gniazda (`net`, `dgram`); UDP w trybie skojarzonym z peerem,
* ✔ TLS — TCP z szyfrowaniem, z opcją akceptacji certyfikatu self-signed,
* ✔ Telnet — TCP z odsiewaniem negocjacji IAC i minimalną, ale poprawną polityką opcji,
* ✔ WebSocket (ws/wss) — na globalnym `WebSocket` z Node 24, bez dodatkowej zależności,
* ✔ Docker — dołączanie przez `docker exec -it` owinięte w PTY, z wykrywaniem kontenerów,
* ✔ Kubernetes — dołączanie przez `kubectl exec -it`, z namespace i wykrywaniem podów,
* dodatkowe protokoły jako wtyczki.

**Etap 7 zamknięty w zakresie rdzenia.** Rodzina transportów sieciowych i owijki kontenerów
działają jako pełnoprawne `TerminalTransport`, spójnie z SSH i portem szeregowym. Otwarte
świadomie: publiczne API rejestracji własnych protokołów przez wtyczki — to nakładka nad
istniejącym już kontraktem transportu, dochodzi z dojrzewaniem Plugin API (Etap 6/AI-6).

> **Bez sekretów — spec idzie wprost.** Sesje sieciowe i kontenerowe nie niosą poświadczeń,
> więc — inaczej niż SSH — parametry lecą w `SessionSpec` bez pośrednictwa deskryptora w
> procesie głównym. Wszystko jest jednak walidowane: protokół z listy, host o dozwolonym
> zestawie znaków, port w zakresie, a **nazwa kontenera/poda musi zaczynać się od znaku
> alfanumerycznego** — to odcina podszycie się pod flagę CLI (np. `--privileged`). Proces
> `docker`/`kubectl` jest uruchamiany z tablicą argumentów (bez powłoki), a `kubectl` dostaje
> `--` przed powłoką, więc nie ma wstrzyknięcia komend.

> **Telnet naprawdę negocjuje.** Serwer wysyła sekwencje IAC (WILL/DO…), a klient je odsiewa
> ze strumienia do terminala i odpowiada: przyjmuje echo oraz „suppress go-ahead", resztę
> odrzuca, i celowo nie odpowiada na potwierdzenia (WONT/DONT), żeby nie wpaść w pętlę.
> Sprawdzone testem integracyjnym na żywym gnieździe (odpowiedzi DO ECHO i WILL SGA).

> **Wykrywanie kontenerów jest miękkie.** `docker ps` / `kubectl get pods` z krótkim limitem
> czasu; brak CLI albo niedziałający demon dają pustą listę, nigdy błąd — interfejs się nie
> wywraca. Ręczne wpisanie celu zawsze działa niezależnie od wykrywania.

### Etap 8 — przygotowanie wersji 1.0

* ✔ testy bezpieczeństwa — inwarianty izolacji (contextIsolation/nodeIntegration/sandbox),
  CSP, sekrety nieobecne w snapshot'cie, odrzucanie wstrzyknięć/przerostów (`npm run test:security`),
* ✔ testy wydajnościowe i długich sesji — soak transportu (`npm run test:soak`) i przepustowość PTY,
* ✔ instalator — electron-builder, NSIS z wyborem katalogu i skrótami,
* ✔ wersja portable — pojedynczy plik `.exe`,
* ✔ automatyczne aktualizacje — electron-updater przez GitHub Releases (tylko w spakowanej wersji),
* ✔ system raportowania błędów — globalne handlery + log w userData, ErrorBoundary renderera,
  „Zgłoś problem"/„Otwórz logi" w menu Pomoc,
* ✔ dokumentacja — docs/architecture/11-pakowanie.md,
* podpisywanie aplikacji — **świadomie wydajemy bez podpisu w tej fazie**; akceptujemy
  ostrzeżenie SmartScreen (użytkownik klika „Uruchom mimo to"). Dodanie podpisu opisane niżej.

**Etap 8 zamknięty w zakresie autonomicznym.** Paczka jest zweryfikowana: `npm run dist:dir`
buduje działającą aplikację, a spakowany `LumaShell.exe` uruchamia się i tworzy sesję PTY
(node-pty ładuje się z `app.asar.unpacked`). Do pełnego wydania 1.0 pozostają dwie rzeczy
wymagające Twojej infrastruktury/decyzji:

> **Podpisywanie kodu** — bez certyfikatu Windows SmartScreen ostrzega przy pierwszym
> uruchomieniu, a ciche auto-aktualizacje bywają blokowane. Dodanie: `win.certificateFile` +
> hasło (lub zmienne `CSC_LINK`/`CSC_KEY_PASSWORD`) w electron-builder.yml.
>
> **Publikacja wydań** — auto-aktualizacje ciągną z GitHub Releases (`publish: github` w
> konfiguracji). Trzeba opublikować wydanie: `electron-builder --publish always` z tokenem
> `GH_TOKEN`. Dopóki nie ma wydań, updater po prostu nic nie znajduje (bez błędu dla użytkownika).

## Ścieżka integracji AI

| Etap | Zakres |
| --- | --- |
| **AI-0** ✔ — interfejs dostawców | `AiProvider` (core) + `OpenAiCompatibleProvider` (OpenAI API / lokalny / własny endpoint, streaming SSE) **oraz `AnthropicProvider`** (Claude Messages API: x-api-key, `system`, `content_block_delta`); klucz w safeStorage (nie wraca do renderera); konfiguracja, test połączenia i wybór modelu w panelu „Agent AI". |
| **AI-1** ✔ — czat bez wykonywania działań | panel „Czat AI" (osobna zakładka), odpowiedź strumieniowana z przyciskiem stop, dołączanie zaznaczenia i ostatniego wyjścia terminala jako kontekstu, komendy jako bloki kodu z „Kopiuj", brak automatycznego wykonania. IPC `ai:chat`/`ai:chatDelta` + AbortController per żądanie w main |
| **AI-2** ✔ — narzędzia tylko do odczytu | pętla agenta z narzędziami read-only: model SAM wywołuje `read_active_terminal`, `read_terminal_selection`, `list_sessions` (wykonanie w rendererze przez terminal-context), a użytkownik może ręcznie dołączyć wybrany plik. Provider tłumaczy narzędzia na format OpenAI (`tools`/`tool_calls`) i Anthropic (`tools`/`tool_use`/`tool_result`, `input_json_delta`). Wciąż zero akcji — pisanie do terminala i zapisy dochodzą w AI-3 |
| **AI-3** — zatwierdzane wykonywanie | wysyłanie komend do terminala, wykonywanie procesów, zapis plików, wysyłanie danych przez UART, system potwierdzeń, dziennik audytowy |
| **AI-4** (częściowo ✔) — integracja z CLI subskrypcji | **zrobione: wykrywanie i uruchamianie oficjalnego Codex CLI oraz Claude Code w panelu terminala (sesja `ai-cli`, logowanie kontem, bez przejmowania tokenów).** Głębsza integracja sesji z UI i statusem — dalej |
| **AI-5** — agent wieloetapowy | planowanie zadań, wykonywanie sekwencji narzędzi, kontrola czasu, limity operacji, przerywanie, retry i obsługa błędów |
| **AI-6** — narzędzia wtyczek | rejestracja narzędzi przez wtyczki, schematy wejścia i wyjścia, klasyfikacja ryzyka, osobne uprawnienia, dokumentacja SDK |
| **AI-7** — kontrolowana autonomia | uprawnienia dla workspace’u, zaufane sesje, profile ryzyka urządzeń, limity kosztów, limity liczby operacji, pełny rejestr działań |

## Zakres MVP

### Terminal

* aplikacja Electron dla Windows,
* instalator `.exe`,
* PowerShell, CMD i WSL,
* xterm.js z WebGL,
* zakładki,
* podziały,
* profile,
* SSH,
* port COM,
* ciemno-zielony motyw glass,
* podstawowa personalizacja,
* command palette,
* konfigurowalne skróty,
* zapisywanie workspace’u.

System wtyczek można projektować od początku, ale **publiczne API najlepiej udostępnić
dopiero po ustabilizowaniu sesji, profili, transportów i interfejsu**.

### AI

* panel czatu,
* obsługa OpenAI API,
* opcjonalny lokalny endpoint,
* analiza zaznaczonego fragmentu terminala,
* generowanie poleceń,
* wykonywanie poleceń po zatwierdzeniu,
* odczyt aktywnego terminala,
* odczyt danych z portu COM,
* wysyłanie danych do portu COM po potwierdzeniu,
* dziennik wszystkich działań,
* przycisk natychmiastowego zatrzymania agenta.

Integrację z oficjalnym Codex CLI można dodać jako drugi oficjalny tryb działania.

## Zakres wersji 1.0

Wersja 1.0 dodatkowo zawiera:

* stabilne Plugin API,
* wtyczki JavaScript i TypeScript,
* izolowany Plugin Host,
* system uprawnień,
* menedżer wtyczek,
* edytor motywów,
* SFTP,
* makra,
* snippet manager,
* nagrywanie sesji,
* eksport logów,
* automatyczne aktualizacje,
* wersję portable,
* przywracanie aplikacji po awarii.
