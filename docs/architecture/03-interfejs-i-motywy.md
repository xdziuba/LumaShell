# Interfejs i motywy

## 1. Główny układ

Aplikacja zawiera:

* pasek zakładek,
* możliwość dzielenia terminala pionowo i poziomo,
* panel zapisanych połączeń,
* pasek boczny,
* command palette,
* pasek statusu,
* panel ustawień,
* panel wtyczek,
* panel historii,
* opcjonalny menedżer plików SFTP,
* panel makr i snippetów.

## 2. Obsługa okien

* wiele okien,
* przenoszenie zakładek między oknami,
* przeciąganie paneli,
* tryb pełnoekranowy,
* tryb skupienia,
* tryb quake,
* opcja „zawsze na wierzchu”,
* zapamiętywanie pozycji i wielkości okna.

## 3. Styl wizualny

Główny styl aplikacji łączy:

* ciemne tło,
* zielone akcenty,
* półprzezroczyste powierzchnie,
* gradienty,
* efekt szkła,
* subtelne obramowania,
* delikatne światło wokół aktywnych elementów.

### Główna paleta

```text
Tło główne:          #07110D
Tło paneli:          #0B1913
Zieleń główna:       #21E68A
Zieleń ciemna:       #0B8F58
Zieleń neonowa:      #66FFB3
Tekst główny:        #E7FFF3
Tekst drugorzędny:   #8CB8A3
Obramowania:         rgba(90, 255, 170, 0.18)
```

### Rama okna i efekt szkła — decyzja

> **Decyzja:** własna rama okna (`frame: false`) + systemowe rozmycie pulpitu przez
> `backgroundMaterial: 'acrylic'`. Uzasadnienie i alternatywy:
> [10 — Decyzje](10-decyzje.md#d1--własna-rama-okna-i-acrylic).

Kluczowe rozróżnienie, od którego zależy cała warstwa wizualna:

| Technika | Co rozmywa | Kto liczy | Koszt |
| --- | --- | --- | --- |
| `backgroundMaterial: 'acrylic'` | **pulpit i okna pod aplikacją** | DWM (system) | znikomy dla aplikacji |
| `backdrop-filter: blur()` | **wyłącznie treść strony pod elementem** | kompozytor Chromium | wysoki, rośnie z powierzchnią |

**`backdrop-filter` nigdy nie rozmywa pulpitu.** To najczęstsze nieporozumienie przy tego
typu interfejsach. Rozmycie pulpitu daje wyłącznie warstwa systemowa.

### Konfiguracja okna

```ts
const win = new BrowserWindow({
  frame: false,                    // własna rama — warunek wymagany przez projekt
  backgroundColor: '#00000000',    // alpha 00 — warunek konieczny, żeby acrylic był widoczny
  backgroundMaterial: 'acrylic'    // systemowe rozmycie tła (@platform win32)
});
```

`transparent: true` **nie jest potrzebne** i nie należy go łączyć z `backgroundMaterial`.
Wystarczy `backgroundColor` z zerową alfą.

Zweryfikowane empirycznie na Electron 43.1.1 / Windows 11 build 26200: `frame: false`
i `backgroundMaterial: 'acrylic'` działają razem, a rozmycie pulpitu jest widoczne pod
półprzezroczystymi obszarami okna **bez użycia `backdrop-filter`**.

### Panel glass

Przy włączonym acrylicu panele potrzebują **wyłącznie alfy** — rozmycie dokłada system:

```css
.glass-panel {
  background:
    linear-gradient(
      135deg,
      rgba(20, 55, 40, 0.42),
      rgba(5, 18, 13, 0.30)
    );

  /* Brak backdrop-filter — rozmycie pulpitu robi backgroundMaterial: 'acrylic'. */
  border: 1px solid rgba(110, 255, 180, 0.15);
  box-shadow:
    0 16px 40px rgba(0, 0, 0, 0.35),
    inset 0 1px 0 rgba(255, 255, 255, 0.05);
}
```

### Kiedy mimo wszystko użyć `backdrop-filter`

Acrylic działa **per okno** i rozmywa to, co jest *za oknem*. Nie rozmyje treści samej
aplikacji. Dlatego do nakładek nad nieprzezroczystym terminalem — command palette, menu
kontekstowe, okna dialogowe — nadal potrzebny jest `backdrop-filter`, bo tam rozmywana jest
treść strony, a nie pulpit.

Podział ról:

| Element | Technika |
| --- | --- |
| Pasek zakładek, pasek boczny, pasek statusu | alfa + acrylic (rozmyty pulpit) |
| Command palette, menu, dialogi nad terminalem | `backdrop-filter` (rozmyta treść aplikacji) |
| **Obszar terminala** | **pełne krycie `#06100C`, bez efektów** |

**Obszar terminala pozostaje nieprzezroczysty** — dla czytelności tekstu i dlatego, że
`backdrop-filter` nad canvasem WebGL wymusza kosztowne kompozytowanie.

### Degradacja na Windows 10

`backgroundMaterial` wymaga **Windows 11 22H2+** (build 22621). Na starszych systemach
wywołanie jest bezpieczne, ale nie daje efektu.

**Windows 10 pozostaje platformą wspieraną** — aplikacja działa tam w pełni, tylko bez
rozmycia, degradując się do jednolitego tła. Szkło jest warstwą wizualną: **brak acrylicu
nie może blokować żadnej funkcji ani zmieniać układu interfejsu**
([10 — Decyzje](10-decyzje.md#d1--własna-rama-okna-i-acrylic)).

```ts
const build = parseInt(os.release().split('.')[2], 10);   // "10.0.26200" → 26200
const acrylic = process.platform === 'win32' && build >= 22621;

const win = new BrowserWindow({
  frame: false,
  backgroundColor: acrylic ? '#00000000' : '#07110D',
  ...(acrylic && { backgroundMaterial: 'acrylic' })
});
```

`backgroundColor` musi być **jednolity, gdy acrylic jest wyłączony** — zerowa alfa bez
rozmycia dałaby okno przezroczyste na ostry pulpit, czyli efekt gorszy niż jego brak.

Renderer potrzebuje tej informacji, żeby wyłączyć alfę na panelach (przy nieprzezroczystym
oknie półprzezroczyste panele odsłoniłyby czarne tło zamiast rozmycia). Flagę należy podać
z procesu głównego przez preload — **nie wykrywać wersji systemu w rendererze**.

Zweryfikowane na Windows 11 build 26200: `os.release()` i `process.getSystemVersion()`
zwracają prawdziwy numer builda. Electron ma poprawny manifest zgodności, więc nie dotyczy
go raportowanie zaniżonej wersji systemu.

### Własna rama: Window Controls Overlay, nie `frame: false`

Rysujemy **treść** paska tytułu. Przyciski okna zostają natywne.

```ts
titleBarStyle: 'hidden',
titleBarOverlay: {
  color: acrylic ? '#00000000' : '#0B1913',  // zerowa alfa → acrylic przebija pod przyciskami
  symbolColor: '#8CB8A3',
  height: 38
}
```

Powód jest twardy: przy `frame: false` przyciski są zwykłymi elementami HTML, więc Windows
nie wie, gdzie jest przycisk maksymalizacji, i **Snap Layouts nie działa** — potwierdzone
testem (najechanie na własny przycisk nie wywołuje flyoutu, na natywny wywołuje).

Podział obowiązków przy tym wariancie:

| Element | Kto obsługuje |
| --- | --- |
| Przyciski minimalizuj / maksymalizuj / zamknij | **system** (WCO) |
| Snap Layouts (Windows 11) | **system** — działa dzięki natywnym przyciskom |
| Zmiana rozmiaru przy krawędziach | **system** — `thickFrame` domyślnie `true` |
| Podwójne kliknięcie w pasek = maksymalizacja | **system** — przez obszar `drag` |
| Treść paska: tytuł, ikony, wskaźniki | **aplikacja** |
| Obszar przeciągania | **aplikacja** — `-webkit-app-region: drag` |
| Układ treści wolny od przycisków | **aplikacja** — `env(titlebar-area-width)` |

Koszt własnej ramy okazał się **znacznie niższy** niż zakładano przy podejmowaniu decyzji
D1: system oddaje przyciski, Snap Layouts i resize za darmo.

### Geometria paska

WCO wystawia zmienne CSS z geometrią wolnego obszaru:

```scss
.titlebar {
  height: env(titlebar-area-height, 38px);   // pełna szerokość — tło sięga pod przyciski

  &__content {
    width: env(titlebar-area-width, 100%);   // treść kończy się przed przyciskami
  }
}
```

Sam pasek musi mieć **pełną szerokość**, żeby tło i obramowanie sięgały także pod natywne
przyciski — mają zerową alfę, więc prześwituje przez nie glass i acrylic. Ograniczana jest
wyłącznie szerokość treści, inaczej długi tytuł wjechałby pod przyciski.

### Personalizacja wyglądu

Użytkownik może zmienić:

* główny kolor akcentu,
* kolory terminala,
* gradienty,
* przezroczystość,
* rozmycie,
* promień zaokrągleń,
* intensywność cieni,
* animacje,
* czcionkę,
* wielkość czcionki,
* odstępy między znakami,
* odstępy między liniami,
* tapetę terminala,
* obraz tła,
* poziom przyciemnienia tła.

## 4. System motywów

Motywy są przechowywane jako pliki JSON.

```json
{
  "id": "dark-green-glass",
  "name": "Dark Green Glass",
  "version": "1.0.0",
  "colors": {
    "background": "#07110D",
    "surface": "rgba(11, 25, 19, 0.78)",
    "accent": "#21E68A",
    "accentSecondary": "#0B8F58",
    "text": "#E7FFF3",
    "textMuted": "#8CB8A3",
    "border": "rgba(90, 255, 170, 0.18)"
  },
  "effects": {
    "blur": 20,
    "opacity": 0.82,
    "borderRadius": 12,
    "animations": true
  },
  "terminal": {
    "background": "#06100C",
    "foreground": "#DFFFF0",
    "cursor": "#21E68A",
    "selection": "rgba(33, 230, 138, 0.25)"
  }
}
```

Motywy mogą być:

* wbudowane,
* importowane z pliku,
* instalowane jako wtyczki,
* tworzone w graficznym edytorze,
* eksportowane i udostępniane innym użytkownikom.
