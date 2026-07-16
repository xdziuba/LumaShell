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

### Efekt szkła

```css
.glass-panel {
  background:
    linear-gradient(
      135deg,
      rgba(20, 55, 40, 0.72),
      rgba(5, 18, 13, 0.58)
    );

  backdrop-filter: blur(20px) saturate(140%);
  border: 1px solid rgba(110, 255, 180, 0.15);
  box-shadow:
    0 16px 40px rgba(0, 0, 0, 0.35),
    inset 0 1px 0 rgba(255, 255, 255, 0.05);
}
```

Efekty przezroczystości powinny znajdować się przede wszystkim na:

* panelach bocznych,
* menu,
* pasku zakładek,
* command palette,
* oknach dialogowych,
* kartach ustawień.

**Sam obszar terminala powinien mieć bardziej jednolite tło, aby tekst pozostał czytelny.**

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
