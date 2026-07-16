# Plugin API — przegląd i manifest

Wtyczki są pisane w **JavaScript** lub **TypeScript**.

Mogą być dostarczane jako:

* katalog,
* paczka ZIP,
* paczka `.terminal-plugin`,
* paczka npm,
* repozytorium Git.

## Struktura wtyczki

```text
my-plugin/
  package.json
  plugin.json
  dist/
    index.js
  assets/
    icon.svg
  README.md
```

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
