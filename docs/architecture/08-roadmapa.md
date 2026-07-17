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
* forwarding,
* jump host,
* SFTP.

> **Bezpieczeństwo poświadczeń.** Hasła i hasła kluczy nigdy nie przechodzą przez
> `SessionSpec` ani snapshot workspace'u — deskryptor połączenia z sekretami żyje ulotnie
> w procesie głównym, renderer dostaje tylko `connectionId`. Sesje SSH nie są przywracane
> po restarcie (jak porty COM). Zapis połączeń SSH jako trwałych profili (z sekretami w
> safeStorage) to kolejny krok tego etapu.

### Etap 4 — port szeregowy

* lista portów,
* konfiguracja transmisji,
* widok tekstowy,
* widok hex,
* timestampy,
* makra,
* logowanie,
* wysyłanie plików,
* automatyczne ponowne połączenie.

### Etap 5 — system motywów

* motywy JSON,
* edytor motywów,
* import i eksport,
* zmiana akcentu,
* konfiguracja szkła,
* gradienty,
* tapety,
* ustawienia czcionek.

### Etap 6 — system wtyczek

* Plugin API v1,
* Plugin Host,
* manifest,
* system uprawnień,
* instalowanie z pliku,
* włączanie i wyłączanie,
* automatyczne aktualizacje wtyczek,
* przykładowe rozszerzenia,
* dokumentacja SDK.

### Etap 7 — dodatkowe protokoły

* TCP, UDP, TLS,
* Telnet,
* WebSocket,
* Docker,
* Kubernetes,
* dodatkowe protokoły jako wtyczki.

### Etap 8 — przygotowanie wersji 1.0

* testy bezpieczeństwa,
* testy wydajnościowe,
* testy długich sesji,
* podpisywanie aplikacji,
* instalator,
* wersja portable,
* automatyczne aktualizacje,
* dokumentacja,
* system raportowania błędów.

## Ścieżka integracji AI

| Etap | Zakres |
| --- | --- |
| **AI-0** — interfejs dostawców | `AiProvider`, konfiguracja OpenAI API, obsługa lokalnego endpointu, bezpieczne przechowywanie kluczy, wybór modelu |
| **AI-1** — czat bez wykonywania działań | panel czatu, analiza zaznaczonego tekstu, analiza wyjścia terminala, generowanie komend, brak automatycznego wykonania |
| **AI-2** — narzędzia tylko do odczytu | odczyt aktywnego terminala, odczyt wybranych plików, lista sesji, odczyt UART, analiza logów |
| **AI-3** — zatwierdzane wykonywanie | wysyłanie komend do terminala, wykonywanie procesów, zapis plików, wysyłanie danych przez UART, system potwierdzeń, dziennik audytowy |
| **AI-4** — integracja z Codex CLI | wykrywanie oficjalnej instalacji, uruchamianie procesu Codex, obsługa oficjalnego logowania, integracja sesji z UI, brak przejmowania tokenów |
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
