# Plugin API — przegląd i manifest

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
