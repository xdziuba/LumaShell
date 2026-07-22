# LumaShell File Explorer 2.0

Drzewo plików jako zakładka LumaShella: przeglądanie katalogów, rozmiary plików i otwarcie
terminala w wybranym folderze.

## Dlaczego wersja 2.0 wygląda inaczej niż 1.0

Wersja 1.0 tej wtyczki **nie mogła istnieć**. Plugin API v1 dawało wyłącznie komendy,
powiadomienia i narzędzia AI — bez dostępu do plików i bez możliwości narysowania czegokolwiek
w interfejsie. Zamiast eksploratora był w niej więc wykrywacz brakujących zdolności, który
uczciwie mówił, czego brakuje, zamiast udawać działającą funkcję.

W Plugin API v2 wtyczka działa we **własnym procesie z pełnym Node**, więc katalogi czyta
wprost przez `node:fs` — bez żadnego pośredniczącego API do plików (decyzja D7 w
`docs/architecture/10-decyzje.md`).

## Jak to działa

Wtyczka **nie rysuje niczego**. Oddaje węzły drzewa (nazwa, rozmiar, czy da się rozwinąć),
a rysuje je LumaShell — w swoim motywie, ze swoim zaznaczaniem i nawigacją klawiaturą.
Dlatego widok wygląda jak reszta aplikacji, a w tej wtyczce nie ma ani linii HTML-a i CSS-a.

```js
await ctx.ui.registerTreeDataProvider('pliki', {
  getChildren: (nodeId) => /* nodeId to ścieżka katalogu albo null dla korzenia */
});
```

Dzieci są pobierane **leniwie**, dopiero przy rozwinięciu węzła — drzewo katalogów potrafi
mieć dziesiątki tysięcy pozycji i budowanie go z góry nie miałoby sensu.

## Obsługa

| Czynność | Efekt |
| --- | --- |
| paleta → **Pliki (File Explorer)** | otwiera drzewo jako zakładkę |
| klik na katalogu | rozwija/zwija |
| **dwuklik** na katalogu | otwiera terminal w tym katalogu |
| `F5` albo **Odśwież** | wczytuje drzewo od nowa |
| paleta → **Pliki: ustaw katalog główny** | ustawia korzeń drzewa |

Katalog główny to domyślnie katalog domowy. Można go zmienić polem `katalogGlowny` w pliku
`%APPDATA%\lumashell\plugins-data\com.lumashell.file-explorer.json`.

## Uprawnienia

`ui.views` (własny widok), `ui.statusBar` (wskaźnik katalogu), `terminal.write` (otwarcie
terminala), `commands.register`, `notifications.show`.

Wtyczka działa z `runtime: "node"`, więc ma pełny dostęp do plików — i dlatego jej włączenie
wymaga świadomej zgody w menedżerze wtyczek. Nic nie wysyła na zewnątrz: czyta katalogi
i tyle.

## Czego jeszcze nie ma

Edycji plików — do tego potrzebny jest webview (dowolny komponent wtyczki w zakładce), który
jest kolejnym etapem Plugin API. Wtedy dwuklik na PLIKU otworzy edytor, a nie tylko dwuklik
na katalogu otworzy terminal.
