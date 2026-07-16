# Plugin API — uprawnienia i izolacja

## 1. Izolacja wtyczek

> **Wtyczki nie działają bezpośrednio w głównym rendererze.**

Zalecany model:

```text
Electron Main Process
    │
    ├── Plugin Host Worker
    ├── Plugin Host Worker
    └── Plugin Host Worker
```

Do uruchamiania wtyczek można wykorzystać:

* Worker Threads,
* UtilityProcess,
* osobne procesy Node.js.

Każda wtyczka działa w odizolowanym środowisku i komunikuje się z aplikacją przez
ograniczone API.

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
