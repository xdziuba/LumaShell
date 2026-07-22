# Szablon wtyczki LumaShella

Gotowy szkielet wtyczki Plugin API v2. **Nie wymaga kroku budowania** — to zwykły CommonJS,
a typy i podpowiadanie wchodzą przez JSDoc z `@lumashell/plugin-api`.

## Start w trzech krokach

1. Skopiuj katalog `szablon` do katalogu wtyczek LumaShella:

   ```
   %APPDATA%\lumashell\plugins\moja-wtyczka
   ```

   Ścieżkę pokazuje panel **Wtyczki → Katalog wtyczek** (jest tam też przycisk „Otwórz katalog").

2. Zmień w `plugin.json` pola `id`, `name` i `description`. Identyfikator musi być unikalny —
   wtyczka o tym samym `id` z katalogu użytkownika przesłania wbudowaną.

3. W LumaShellu: **Wtyczki → Odśwież**, potem włącz wtyczkę przełącznikiem.

   Wtyczka z `runtime: "node"` startuje dopiero po świadomym włączeniu — bo dostaje pełny
   dostęp do komputera. Panel mówi wprost, czego LumaShell nie ogranicza.

## Co jest w szablonie

| Element | Gdzie to widać |
| --- | --- |
| komenda | paleta (Ctrl+Shift+P) |
| element paska statusu | prawy dolny róg okna |
| widok-drzewo | zakładka otwierana z palety |
| trwały magazyn | `%APPDATA%\lumashell\plugins-data\<id>.json` |

## Praca nad wtyczką

* **Przeładowanie bez restartu aplikacji**: Wtyczki → wybierz wtyczkę → **Przeładuj**.
* **Log wtyczki**: Wtyczki → **Log wtyczki** (albo `userData/logs/plugins/<id>.log`).
  Trafia tam wszystko, co wypiszesz przez `ctx.log()` i `console.log()`, oraz każdy
  nieobsłużony wyjątek.
* **Błędy uprawnień** są jawne: wywołanie bez uprawnienia odrzuca obietnicę z `code: 'EPERM'`
  i wpisem w logu — nie ma cichego „nic się nie stało".

## Własny interfejs (webview)

Gdy drzewo nie wystarcza, widok może być własną stroną wtyczki:

```json
"views": [{ "id": "edytor", "title": "Edytor", "type": "webview", "entry": "edytor.html" }]
```

Pliki strony leżą w podkatalogu `media/` wtyczki. Strona działa na własnym pochodzeniu,
bez Node i bez sieci; rozmawia z wtyczką przez `acquireLumaApi()` (most dostarcza aplikacja).
Kompletny przykład: wbudowana wtyczka `file-explorer`.

## Paczki npm

Wtyczka `runtime: "node"` ma własne `node_modules` — możesz zrobić `npm i` w jej katalogu
i normalnie `require('cokolwiek')`. Nie ma znaczenia, czy paczka używa `fs` czy `net`.
