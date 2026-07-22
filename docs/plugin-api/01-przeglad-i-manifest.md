# Plugin API — przegląd i manifest

> **Plugin API v2 (`apiVersion: "2"`).** Wtyczka może działać w jednym z dwóch środowisk,
> a wybór deklaruje w manifeście polem `runtime`:
>
> | `runtime` | Gdzie działa | Co dostaje | Cena |
> | --- | --- | --- | --- |
> | `sandbox` (domyślne) | ukryte okno bez Node, wspólne dla wtyczek | komendy, powiadomienia, narzędzia AI | bezpieczne, ale nie narysuje przycisku ani nie dotknie pliku |
> | `node` | **własny proces** (`utilityProcess`) z pełnym Node 24 | `fs`, `net`, `child_process`, własne `node_modules` | pełny dostęp do komputera — wymaga świadomej zgody użytkownika |
>
> Wtyczki `apiVersion: "1"` działają dalej bez żadnych zmian — dokumentacja poniżej opisuje
> właśnie ten, starszy tryb. Model zaufania i pomiary, na których oparto tę decyzję, są
> w [D7](../architecture/10-decyzje.md#d7--wtyczki-dostaja-wlasny-proces-z-node).

## Manifest v2 — przykład

```json
{
  "id": "com.przyklad.wtyczka",
  "name": "Przykładowa wtyczka",
  "version": "1.0.0",
  "apiVersion": "2",
  "runtime": "node",
  "main": "dist/index.js",
  "description": "Zdanie pokazywane w menedżerze wtyczek i przy pytaniu o zgodę.",
  "permissions": ["commands.register", "notifications.show"],
  "contributes": {
    "commands": [{ "id": "przyklad.zrob", "title": "Przykład: zrób coś" }]
  }
}
```

`apiVersion` jest **sprawdzana** — manifest z nieznaną wersją jest odrzucany z czytelnym
komunikatem, zamiast ładować się w połowie.

## `context` w `runtime: "node"`

```ts
context.pluginId: string
context.permissions: string[]
context.log(...args): void                      // trafia do userData/logs/plugins/<id>.log

context.app.getInfo(): Promise<{ name, version, startedAt }>
context.commands.registerCommand(id, handler): Promise<void>
context.notifications.show(message, level?): Promise<void>
context.workspace.getActiveTab(): Promise<{ title, kind } | null>
context.workspace.onDidChangeActiveTab(cb): () => void
context.storage.get<T>(key): Promise<T | undefined>
context.storage.set(key, value): Promise<void>
context.storage.path(): Promise<string>
```

Każde wywołanie idzie przez bramkę uprawnień w procesie głównym i **ma odpowiedź**: brak
uprawnienia to czytelny błąd `EPERM`, a nie ciche nic. Komenda musi być zadeklarowana
w `contributes.commands`, inaczej zostanie odrzucona.

Wtyczka `runtime: "node"` może używać paczek npm — ma własne `node_modules` i `require`
rozwiązywany z jej katalogu. Przykład kompletnej integracji: `resources/plugins/discord-rpc`
(nazwany potok Discorda w czystym `node:net`, bez żadnego API „do gniazd" po stronie
aplikacji).

---

## Tryb `sandbox` (Plugin API v1)

Wtyczki są pisane w **JavaScript** lub **TypeScript**.

Mogą być dostarczane jako:

* katalog,
* paczka ZIP,
* paczka `.terminal-plugin`,
* repozytorium Git.

> **Paczki npm nie są obsługiwane.** Wtyczki działają w procesie bez integracji Node.js,
> więc nie mają dostępu do modułów npm wymagających `fs`, `net` czy `child_process`.
> Każda wtyczka musi być **zbundlowana do samodzielnego pliku**. Uzasadnienie:
> [02 — Uprawnienia i izolacja](02-uprawnienia-i-izolacja.md#konsekwencja-brak-wtyczek-jako-paczek-npm).

## Struktura wtyczki

```text
my-plugin/
  package.json      → tylko metadane i skrypt budowania (nie jest środowiskiem uruchomienia)
  plugin.json       → manifest czytany przez aplikację
  dist/
    index.js        → JEDEN zbundlowany plik, bez zależności rozwiązywanych w czasie działania
  assets/
    icon.svg
  README.md
```

`dist/index.js` musi być samowystarczalny — aplikacja nie rozwiązuje `node_modules`
wtyczki w czasie działania.

## Manifest

```json
{
  "id": "com.example.serial-tools",
  "name": "Serial Tools",
  "version": "1.0.0",
  "apiVersion": "1",
  "main": "dist/index.js",
  "permissions": [
    "terminal.read",
    "terminal.write",
    "serial.listPorts"
  ],
  "contributes": {
    "commands": [
      {
        "id": "serial.sendTestFrame",
        "title": "Send Test Frame"
      }
    ],
    "panels": [
      {
        "id": "serial.analyzer",
        "title": "Serial Analyzer"
      }
    ]
  }
}
```

## API

```ts
export interface TerminalPluginContext {
  commands: CommandsApi;
  terminal: TerminalApi;
  workspace: WorkspaceApi;
  storage: StorageApi;
  notifications: NotificationsApi;
  ui: UiApi;
  serial?: SerialApi;
  ssh?: SshApi;
}
```

### Przykładowa wtyczka

```ts
export function activate(context: TerminalPluginContext) {
  context.commands.registerCommand(
    "example.sayHello",
    async () => {
      context.notifications.showInfo("Hello from plugin!");
    }
  );
}

export function deactivate() {
  // Czyszczenie zasobów
}
```

## Możliwości rozszerzeń

Wtyczki mogą dodawać:

* własne komendy,
* skróty klawiaturowe,
* panele boczne,
* przyciski na pasku statusu,
* dodatkowe protokoły,
* filtry danych,
* analizatory portu COM,
* makra,
* snippet manager,
* integracje z Dockerem,
* integracje z Kubernetesem,
* integracje z Git,
* generatory profili,
* motywy,
* ikony,
* rozszerzenia command palette.

## Wersjonowanie

Pole `apiVersion` w manifeście określa wersję Plugin API, z którą wtyczka jest zgodna.

Publiczne API najlepiej udostępnić dopiero po ustabilizowaniu sesji, profili, transportów
i interfejsu — patrz [architecture/08 — Roadmapa](../architecture/08-roadmapa.md).
