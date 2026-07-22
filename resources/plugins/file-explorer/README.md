# LumaShell File Explorer

Samodzielny plugin zgodny z aktualnym Plugin API v1. Plugin rejestruje dwie komendy:

* `Pliki: Otwórz eksplorator`,
* `Pliki: Sprawdź wymagania API`.

## Stan implementacji

Drzewo katalogów i edytor nie mogą obecnie zostać uruchomione wyłącznie z kodu pluginu.
LumaShell wykonuje pluginy w sandboxie bez Node.js, a aktualny host przekazuje do
`activate(context)` tylko:

* `context.commands`,
* `context.notifications`,
* `context.tools`.

To celowe zabezpieczenie: plugin nie ma dostępu do `fs`, DOM-u głównego okna ani
wewnętrznego store zakładek. Nie należy go obchodzić przez `require`, `window.open` lub
prywatne kanały IPC.

## API wymagane przez pełną wersję

Pełna funkcja wymaga publicznego, egzekwowanego na granicy RPC kontraktu obejmującego:

```text
filesystem.listDirectory(path)
filesystem.readFile(path)
filesystem.writeFile(path, content)
ui.createPanel(...)
workspace.openTab(...)
```

oraz odpowiadających mu uprawnień `filesystem.read`, `filesystem.write`,
`ui.createPanel` i `workspace.modify`. Dokumentacja projektowa wymienia te zdolności, ale
walidator manifestu i runtime Plugin Hosta jeszcze ich nie implementują.

Po udostępnieniu i opisaniu sygnatur tych metod plugin może dostać właściwy widok drzewa,
otwieranie pliku w osobnej zakładce, edycję tekstu, zapis oraz ostrzeżenie o niezapisanych
zmianach. Do tego czasu komendy pokazują stan możliwości zamiast udawać działającą funkcję
lub naruszać izolację bezpieczeństwa LumaShell.

## Instalacja deweloperska

Katalog znajduje się w `resources/plugins`, więc LumaShell wykrywa go tak samo jak
wbudowane przykłady `hello` i `toolbox`. Bundle `dist/index.js` jest samowystarczalnym
CommonJS bez zależności rozwiązywanych w czasie działania.
