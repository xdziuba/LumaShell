# Plugin API — narzędzia AI (AI-6)

Wtyczki mogą udostępniać modelowi AI własne narzędzia. Model wywołuje je sam w pętli agenta
(jak wbudowane `read_active_terminal` itd.), a wynik wraca do rozmowy. Wykonanie dzieje się w
**izolowanym hoście wtyczek** (sandbox, bez Node — decyzja D2); main pośredniczy i egzekwuje
uprawnienia.

## 1. Uprawnienie

Rejestracja narzędzi wymaga uprawnienia **`ai.tools`** w manifeście. Bez niego zgłoszenia
narzędzi i ich wywołania są odrzucane na granicy RPC (proces główny), niezależnie od tego, co
robi kod wtyczki.

## 2. Manifest: `contributes.tools`

```json
{
  "id": "com.lumashell.toolbox",
  "name": "Toolbox AI",
  "version": "1.0.0",
  "apiVersion": "1",
  "main": "dist/index.js",
  "permissions": ["ai.tools"],
  "contributes": {
    "tools": [
      {
        "id": "current_time",
        "description": "Zwraca aktualny czas lokalny komputera.",
        "parameters": { "type": "object", "properties": {} }
      },
      {
        "id": "flash_firmware",
        "description": "Wgrywa firmware na podłączone urządzenie.",
        "parameters": { "type": "object", "properties": { "path": { "type": "string" } }, "required": ["path"] },
        "risky": true
      }
    ]
  }
}
```

* `id` — identyfikator narzędzia (unikalny w obrębie wtyczki). Modelowi jest ono pokazywane
  pod nazwą znamespace'owaną (`p_<pluginId>_<id>`), więc nie koliduje z wbudowanymi ani z
  innymi wtyczkami.
* `description` — opis dla modelu (kiedy użyć narzędzia).
* `parameters` — **JSON Schema** wejścia, przekazywany wprost do API modelu.
* `risky` — gdy `true`, narzędzie jest **akcją**: pętla agenta poprosi użytkownika o zgodę
  przed wykonaniem, a decyzja trafi do dziennika audytowego (jak wbudowane akcje z AI-3).
  Domyślnie `false` (tylko-do-odczytu, bez pytania).

Narzędzie musi być zadeklarowane w manifeście — wtyczka nie może zarejestrować w runtime
narzędzia, którego manifest nie zapowiada.

## 3. Rejestracja handlera

W `activate(context)` wtyczka podpina handler przez `context.tools.registerTool`. Handler
może być asynchroniczny i **zwraca tekst** — to on trafia do modelu jako wynik narzędzia.

```js
function activate(context) {
  context.tools.registerTool('current_time', function (args) {
    return 'Aktualny czas lokalny: ' + new Date().toString();
  });
}

module.exports = { activate, deactivate() {} };
```

Handler dostaje argumenty jako obiekt (zwalidowany kształtem, ale sama logika należy do
wtyczki). Rzucenie błędu jest bezpieczne — zostanie przekazane modelowi jako komunikat błędu,
nie wywróci hosta.

## 4. Przepływ wywołania (request/response)

W przeciwieństwie do komend (jednokierunkowych) narzędzia mają odpowiedź korelowaną `callId`:

```
model → renderer (pętla agenta) → main (ai:chat zwraca tool_call)
renderer → main: plugin:runTool(pluginId, toolId, args)
main → host: { invoke-tool, callId, ... }   (po sprawdzeniu: aktywna, ai.tools, zadeklarowane)
host → main: { tool-result, callId, result } albo { tool-error, callId, message }
main → renderer: wynik (tekst) → dopięty do rozmowy jako wiadomość roli `tool`
```

Limit czasu na odpowiedź narzędzia to 30 s — po nim wywołanie kończy się błędem.

## 5. Zasady bezpieczeństwa

* Bez `ai.tools` — zero narzędzi (egzekwowane w main, nie po dobrej woli wtyczki).
* Narzędzie musi być w manifeście **i** zarejestrowane w runtime, żeby dało się je wywołać.
* `risky: true` ⇒ zgoda użytkownika + wpis w [dzienniku audytowym](../security/04-audyt.md)
  (`logs/ai-audit.log`), tak samo jak wbudowane akcje (AI-3).
* Handler działa w sandboxie bez Node — realne zdolności (sieć, pliki) i tak muszą iść przez
  RPC do procesu głównego.

> Uwaga: na tym etapie ryzyko jest binarne (`risky`). Wielopoziomowa klasyfikacja ryzyka i
> osobne profile zaufania to zakres AI-7.
