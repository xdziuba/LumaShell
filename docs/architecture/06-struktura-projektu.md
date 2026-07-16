# Struktura projektu

```text
/src
  /main
    main.ts
    window-manager.ts
    ipc/
    security/
    updater/

  /preload
    index.ts
    api.ts

  /renderer
    /components
    /features
    /layouts
    /terminal
    /settings
    /themes
    /workspace
    /store

  /core
    /sessions
    /profiles
    /transports
    /commands
    /events

  /services
    /pty
    /ssh
    /serial
    /tcp
    /sftp

  /plugins
    /api
    /host
    /manager
    /permissions
    /registry

  /shared
    /types
    /schemas
    /constants
    /utils

/tests
  /unit
  /integration
  /e2e
  /performance

/resources
  /icons
  /themes
  /fonts

/docs
  /architecture
  /plugin-api
  /security
```

## Uwagi

Katalogi są utworzone w repozytorium i oznaczone plikami `.gitkeep`, ponieważ Git nie
śledzi pustych katalogów. Pliki `.gitkeep` należy usuwać w miarę wypełniania katalogów
właściwym kodem.

Pliki wymienione powyżej z nazwami (`main.ts`, `window-manager.ts`, `index.ts`, `api.ts`)
są docelowymi punktami wejścia poszczególnych warstw — nie zostały jeszcze utworzone.

## Odpowiedzialność katalogów

| Katalog | Zakres |
| --- | --- |
| `src/main` | Proces główny Electrona: okna, IPC, bezpieczeństwo, aktualizacje |
| `src/preload` | Ograniczone API wystawiane rendererowi przez context bridge |
| `src/renderer` | Interfejs React, terminal, ustawienia, motywy, workspace, store |
| `src/core` | Logika niezależna od procesu: sesje, profile, transporty, komendy, zdarzenia |
| `src/services` | Implementacje transportów: PTY, SSH, serial, TCP, SFTP |
| `src/plugins` | System wtyczek: API, host, manager, uprawnienia, rejestr |
| `src/shared` | Typy, schematy walidacji, stałe i narzędzia współdzielone między warstwami |
