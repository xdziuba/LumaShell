# Plugin API — uprawnienia i izolacja

## 1. Izolacja wtyczek

> **Decyzja:** wtyczki działają w procesie **bez integracji Node.js**, a jedynym kanałem
> komunikacji jest **RPC**. Uzasadnienie i odrzucone warianty:
> [architecture/10 — Decyzje](../architecture/10-decyzje.md#d2--izolacja-wtyczek-rpc-bez-node).

### Izolacja awarii to nie izolacja bezpieczeństwa

Rozróżnienie, od którego zależy sens całego systemu uprawnień:

| Model | Chroni przed awarią | Egzekwuje uprawnienia |
| --- | --- | --- |
| Worker Threads / `UtilityProcess` **z Node** | tak | **nie** |
| Proces **bez Node** + wyłącznie RPC | tak | **tak** |

Kod uruchomiony w `UtilityProcess` lub Worker Thread z dostępem do Node ma `require('fs')`,
`require('net')` i `require('child_process')`. W takim modelu manifest deklarujący
`filesystem.read` jest **wyłącznie deklaracją** — wtyczka może zignorować API aplikacji
i sięgnąć do dysku bezpośrednio, a nic jej nie zatrzyma.

Ponieważ uprawnienia są pokazywane użytkownikowi przy instalacji, byłaby to obietnica
bezpieczeństwa, której architektura nie dotrzymuje. Dlatego wybrano model bez Node.

### Model docelowy

```text
Electron Main Process
    │  (jedyne przejście: RPC + walidacja + sprawdzenie uprawnień)
    ├── Plugin Host — bez Node, bez fs/net/child_process
    ├── Plugin Host — bez Node, bez fs/net/child_process
    └── Plugin Host — bez Node, bez fs/net/child_process
```

Zasady:

* wtyczka **nie ma** dostępu do modułów Node.js ani do zasobów systemowych,
* każdy dostęp do zasobu przechodzi przez RPC do procesu głównego,
* proces główny **waliduje każde wywołanie** i sprawdza uprawnienia z manifestu,
* punktem egzekucji jest granica RPC — nie dobra wola wtyczki,
* wtyczka nie może rozszerzyć swoich uprawnień w czasie działania.

### Konsekwencja: brak wtyczek jako paczek npm

Wtyczka bez dostępu do modułów Node **nie może korzystać z zależności npm**, które tych
modułów wymagają. To zaakceptowany koszt tej decyzji:

* wtyczki muszą być **zbundlowane do samodzielnego pliku** (`dist/index.js`),
* zależności czysto obliczeniowe (bez I/O) mogą być wbudowane w bundle,
* biblioteka wymagająca `fs`, `net` czy `child_process` **nie zadziała** — jej
  funkcjonalność musi zostać wystawiona jako API aplikacji przez RPC,
* dostarczanie wtyczki jako paczki npm zostało **usunięte** z obsługiwanych formatów —
  patrz [01 — Przegląd i manifest](01-przeglad-i-manifest.md).

Jeżeli wtyczka potrzebuje możliwości, której nie ma w API, właściwą drogą jest
**rozszerzenie API aplikacji**, a nie obejście izolacji.

## 2. Uprawnienia

Uprawnienia deklarowane są w manifeście
([01 — Przegląd i manifest](01-przeglad-i-manifest.md)).

Przykładowe uprawnienia:

| Uprawnienie | Zakres |
| --- | --- |
| `terminal.read` | Odczyt wyjścia terminala |
| `terminal.write` | Zapis do terminala |
| `terminal.create` | Tworzenie sesji |
| `serial.listPorts` | Lista portów COM |
| `serial.connect` | Otwieranie portu COM |
| `ssh.connect` | Nawiązywanie połączeń SSH |
| `network.access` | Dostęp sieciowy |
| `filesystem.read` | Odczyt plików |
| `filesystem.write` | Zapis plików |
| `clipboard.read` | Odczyt schowka |
| `clipboard.write` | Zapis do schowka |
| `workspace.modify` | Modyfikacja workspace’u |
| `ui.createPanel` | Tworzenie paneli UI |

**Podczas instalacji użytkownik widzi listę wymaganych uprawnień.**

## 3. Rozdzielenie uprawnień wtyczki i agenta

Wtyczka **nie otrzymuje automatycznie** wszystkich uprawnień agenta.

> Uprawnienia wtyczki i uprawnienia agenta należy sprawdzać **niezależnie**.

Rejestracja narzędzi agenta przez wtyczki wymaga osobnego uprawnienia
`agent.registerTools` — patrz [03 — Narzędzia agenta](03-narzedzia-agenta.md).
