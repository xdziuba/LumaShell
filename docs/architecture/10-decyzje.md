# Rejestr decyzji

Decyzje architektoniczne, które odbiegają od pierwotnego planu albo rozstrzygają jego
niejednoznaczności. Każdy wpis notuje **kontekst, decyzję, konsekwencje i odrzucone
warianty** — żeby nie wracać do rozstrzygniętych tematów bez nowych argumentów.

---

## D1 — Własna rama okna i acrylic

**Data:** 2026-07-16 · **Status:** przyjęta

### Kontekst

Plan zakładał glassmorphism z `backdrop-filter: blur(20px)` na panelach oraz
półprzezroczyste powierzchnie. Kryło się w tym nieporozumienie: **`backdrop-filter` nie
rozmywa pulpitu** — rozmywa wyłącznie treść strony pod elementem. Rozmycie tego, co jest
*za oknem*, może wykonać tylko system.

Dodatkowo cel „nie obciążać za bardzo” stoi w sprzeczności z rozległymi powierzchniami
`backdrop-filter`, których koszt ponosi kompozytor Chromium i rośnie z powierzchnią.

### Decyzja

Własna rama okna (`frame: false`) + systemowe rozmycie tła
(`backgroundMaterial: 'acrylic'`), przy `backgroundColor: '#00000000'`.

Rozmycie pulpitu wykonuje **DWM**, nie aplikacja. Panele potrzebują wyłącznie alfy —
`backdrop-filter` znika z pasków i paneli bocznych.

`backdrop-filter` zostaje **tylko** dla nakładek nad nieprzezroczystym terminalem
(command palette, menu, dialogi), gdzie rozmywana jest treść aplikacji, a nie pulpit.

### Weryfikacja

Sprawdzone empirycznie na Electron 43.1.1 / Windows 11 build 26200, prototypem
z kolorowym tłem pod oknem:

* `frame: false` i `backgroundMaterial: 'acrylic'` **działają razem**,
* rozmycie tła jest widoczne pod półprzezroczystymi obszarami okna **bez ani jednego
  `backdrop-filter` w CSS**,
* obszar terminala z pełnym kryciem pozostaje nieprzezroczysty w tym samym oknie.

### Konsekwencje

Pozytywne:

* rozmycie pulpitu **za darmo** z punktu widzenia wydajności aplikacji,
* mniej pracy dla kompozytora niż w pierwotnym planie,
* spójny z Windows 11 wygląd wraz z obszarem nieklienckim.

Koszty:

* aplikacja rysuje treść paska tytułu i wyznacza obszary przeciągania,
* `backgroundMaterial` wymaga **Windows 11 22H2+**; na starszych systemach efekt nie
  zadziała i konieczna jest degradacja do jednolitego tła `#07110D`.

### Aktualizacja po Etapie 0: `titleBarStyle: 'hidden'` zamiast `frame: false`

Pierwotnie decyzja zakładała `frame: false` i pełne przejęcie ramy, z Snap Layouts
i resize jako kosztem do samodzielnego opłacenia. **Implementacja pokazała, że to był zły
szacunek.**

Ustalenia z testów na Electron 43.1.1 / Windows 11 build 26200:

| Sprawdzone | Wynik |
| --- | --- |
| Resize krawędziami przy `frame: false` | **działa** — `thickFrame` domyślnie `true` (zweryfikowane przeciągnięciem myszy: 1196 → 1316 px) |
| Snap Layouts przy `frame: false` + własne przyciski HTML | **nie działa** — Windows nie wie, gdzie jest przycisk maksymalizacji |
| Snap Layouts przy `titleBarStyle: 'hidden'` + `titleBarOverlay` | **działa** — flyout pojawia się po najechaniu |
| `titleBarOverlay` z `color: '#00000000'` + acrylic | **działa** — rozmycie przebija pod natywnymi przyciskami |

Dlatego okno używa `titleBarStyle: 'hidden'` + `titleBarOverlay` zamiast `frame: false`.
Aplikacja rysuje treść paska, system daje przyciski, Snap Layouts i resize.

Utracona jest wyłącznie możliwość dowolnego stylowania samych przycisków — zostaje
`color` i `symbolColor`. To dobra cena za działający Snap Layouts, poprawny hover
i dostępność. Konsekwencja uboczna: kanały IPC do sterowania oknem stały się zbędne
i zostały usunięte.

> **Windows 10 — rozstrzygnięte: pozostaje platformą wspieraną.** Mimo że Windows 10
> zakończył wsparcie 14 października 2025, nie wypada z zakresu. Aplikacja działa tam
> **w pełni funkcjonalnie, tylko bez rozmycia** — okno degraduje się do jednolitego
> `#07110D`.
>
> Wniosek wiążący dla implementacji: **brak acrylicu nie może blokować żadnej funkcji ani
> zmieniać układu interfejsu**. Szkło jest wyłącznie warstwą wizualną. Jeśli kiedykolwiek
> pojawi się funkcja działająca tylko przy włączonym acrylicu, będzie to naruszenie tej
> decyzji.

### Odrzucone warianty

| Wariant | Powód odrzucenia |
| --- | --- |
| `transparent: true` | Daje przezroczystość, **nie rozmycie** — pulpit byłby ostry. Na Windows i tak wymaga `frame: false`. Nie łączyć z `backgroundMaterial`. |
| `backdrop-filter` na panelach | Nie rozmywa pulpitu. Kosztowny przy dużych powierzchniach. Nad canvasem WebGL wymusza drogie kompozytowanie. |
| Systemowa rama okna | Wyklucza wygląd zakładany przez projekt. |
| `frame: false` + własne przyciski HTML | Zabija Snap Layouts, a zysk to wyłącznie stylowanie trzech przycisków. Odrzucone po testach — patrz aktualizacja powyżej. |

---

## D2 — Izolacja wtyczek: RPC bez Node

**Data:** 2026-07-16 · **Status:** przyjęta

### Kontekst

Plan przewidywał Plugin Host oparty na Worker Threads lub `UtilityProcess` i manifest
z listą uprawnień pokazywaną użytkownikowi przy instalacji.

To dawało **izolację awarii, ale nie izolację bezpieczeństwa**. Kod z dostępem do Node ma
`require('fs')`, `require('net')` i `require('child_process')`, więc uprawnienia z manifestu
byłyby wyłącznie deklaracją — wtyczka mogłaby zignorować API i sięgnąć do zasobów wprost.
Pokazywanie takiej listy użytkownikowi to obietnica bezpieczeństwa, której architektura
nie dotrzymuje.

### Decyzja

Wtyczki działają w procesie **bez integracji Node.js**. Jedynym kanałem komunikacji jest
**RPC** do procesu głównego, który waliduje każde wywołanie i sprawdza uprawnienia
z manifestu. **Punktem egzekucji jest granica RPC**, a nie dobra wola wtyczki.

### Konsekwencje

Pozytywne:

* lista uprawnień staje się **rzeczywistą gwarancją**, a nie deklaracją,
* wtyczka nie może rozszerzyć uprawnień w czasie działania,
* powierzchnia ataku ogranicza się do jawnie zdefiniowanego API.

Koszty — **zaakceptowane świadomie**:

* **brak wtyczek jako paczek npm** — usunięte z obsługiwanych formatów dostarczania,
* wtyczka musi być zbundlowana do jednego samowystarczalnego pliku,
* biblioteki wymagające `fs`, `net` czy `child_process` nie zadziałają; ich
  funkcjonalność trzeba wystawić jako API aplikacji,
* każde nowe zapotrzebowanie wtyczek oznacza **rozszerzenie API**, a nie poluzowanie
  izolacji — API rośnie wolniej i pod kontrolą.

### Odrzucone warianty

| Wariant | Powód odrzucenia |
| --- | --- |
| Model VS Code — wtyczki zaufane, uprawnienia informacyjne | Prostsze, ale rezygnuje z egzekwowania. Świadomie odrzucone na rzecz realnej gwarancji. |
| `UtilityProcess` z Node + odbieranie globali / hardened JS | Nieszczelne. Daje złudzenie bezpieczeństwa przy realnej złożoności — najgorszy z obu światów. |

### Uwaga: agent AI a wtyczki

Agent AI **nie ma tego problemu**, mimo podobnej konstrukcji. Agenta pisze zespół
aplikacji, więc Tool Router jest realnym punktem egzekucji — agent nie ma motywu, by go
obchodzić. Przy wtyczkach kod jest cudzy, więc egzekucja musi być wymuszona
architektonicznie. Stąd różnica w podejściu.

Rejestracja narzędzi agenta przez wtyczki przechodzi przez to samo RPC i wymaga osobnego
uprawnienia `agent.registerTools` — patrz
[plugin-api/03 — Narzędzia agenta](../plugin-api/03-narzedzia-agenta.md).

---

## D3 — Poprawki nazewnictwa i wersji

**Data:** 2026-07-16 · **Status:** przyjęta

### Paczki xterm

Paczka `xterm` jest **wycofana** (5.3.0, deprecated). Obowiązują `@xterm/xterm`
i `@xterm/addon-webgl`.

### Moduły natywne — wycofane ostrzeżenie

Pierwotnie zakładano, że `node-pty` będzie wymagał kompilacji i `electron-rebuild`, co
czyniło z niego ryzyko Etapu 0. **To ostrzeżenie było nieaktualne.**

`node-pty` 1.1.0 i `serialport` 13.x są oparte na **N-API** i dostarczają prebuildy dla
`win32-x64`. Instalacja nie uruchamia kompilacji, a N-API jest stabilne między ABI — ta
sama binarka działa w Node (ABI 137) i w Electronie 43 (ABI 148) **bez `electron-rebuild`**.
Zweryfikowane empirycznie: uruchomienie PowerShella przez ConPTY oraz listowanie portów COM
pod Electronem.

Realne ryzyko przenosi się na **Etap 8**: binaria natywne wymagają `asarUnpack`
w electron-builderze, inaczej działają w trybie deweloperskim, a nie działają
w zainstalowanej aplikacji.

### Granica `core` / `services`

`core` definiuje kontrakty, `services` je implementuje, zależność idzie wyłącznie
`services` → `core`. `core` musi importować się bez zależności natywnych — patrz
[06 — Struktura projektu](06-struktura-projektu.md#granica-core--services).

---

## D4 — Transport oddaje bajty, nie tekst

**Data:** 2026-07-16 · **Status:** przyjęta

### Kontekst

Pierwsza implementacja `TerminalTransport` deklarowała `onData(data: string)`, mimo że
plan od początku mówił o `Uint8Array`. Przy jednym transporcie (PTY) różnica była
niewidoczna. Przy dokładaniu portu szeregowego okazała się blokująca:

* UART bywa **z natury binarny** — protokoły ramkowe, dane spoza ASCII,
* widok szesnastkowy z Etapu 4 wymaga dostępu do bajtów,
* dekodowanie w transporcie nieodwracalnie niszczyłoby dane binarne.

### Decyzja

Kontrakt oddaje `Uint8Array`. Dekodowanie należy do warstwy prezentacji — xterm przyjmuje
`Uint8Array` i sam składa sekwencje UTF-8 rozjechane między porcjami.

### Ograniczenie ConPTY

**node-pty na Windows nie ma trybu binarnego.** Opcja `encoding` jest ignorowana, a
biblioteka wypisuje ostrzeżenie *„Setting encoding on Windows is not supported"*.
Sprawdzone dla `null`, `undefined` i `'utf8'` — `onData` **zawsze** oddaje `string`.

Dlatego `LocalPtyTransport` koduje tekst z powrotem do UTF-8. To nie jest strata: node-pty
zdekodował wyjście na swoim poziomie, więc bajty spoza UTF-8 przepadły, zanim dotarły do
nas. Ponowne kodowanie niczego do tego nie dokłada, a jednolity kontrakt zostaje
zachowany i port szeregowy oraz SSH są naprawdę binarne.

> Pułapka do zapamiętania: typings node-pty deklarują `onData: IEvent<string>` **także**
> wtedy, gdy dokumentacja obiecuje `Buffer`. Rzutowanie na `Buffer` przechodzi typecheck
> i wywala aplikację dopiero w czasie działania, na `Buffer.concat`.

### Konsekwencje

* jeden kanał danych dla wszystkich transportów, bez rozgałęzień w IPC i rendererze,
* grupowanie porcji to `Buffer.concat` zamiast sklejania tekstu,
* `resize` pozostaje **opcjonalne** w kontrakcie — port szeregowy nie ma rozmiaru okna,
* kod wyjścia to pojęcie wyłącznie PTY; koniec sesji rozgłasza wspólny stan `closed`,
  a kod dokłada tylko ten transport, który go ma.

### Weryfikacja

| Sprawdzone | Jak |
| --- | --- |
| SSH: handshake, powitanie, echo, resize, rozłączenie, ścieżka błędu | serwer ssh2 w pamięci procesu — `npm run test:integration`, 11/11 |
| Kontrakt oddaje `Uint8Array`, nie string | jawna asercja w obu testach transportów |
| Port szeregowy: listowanie, otwarcie, zamknięcie, brak `resize` | `npm run test:serial COM9 115200` na realnym CP210x, 5/5 |
